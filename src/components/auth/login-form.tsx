"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { AlertCircleIcon, InfoIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";
import { ApiClientError, apiRequest, getErrorMessage } from "@/lib/api/client";
import { OTP_LENGTH, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS } from "@/lib/auth/constants";
import { safeRedirectPath } from "@/lib/utils/safe-redirect";
import {
  requestOtpSchema,
  verifyOtpSchema,
  type RequestOtpInput,
  type VerifyOtpInput,
} from "@/lib/validation/auth";

interface RequestOtpResponse {
  message: string;
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
}

interface LoginFormProps {
  /** Already sanitized post-login path. */
  nextPath: string;
  sessionExpired?: boolean;
}

type Step = "email" | "otp";

const OTP_SLOTS = Array.from({ length: OTP_LENGTH }, (_, index) => index);

function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiClientError)) return null;
  const value = error.details?.retryAfterSeconds;
  return typeof value === "number" && value > 0 ? Math.ceil(value) : null;
}

export function LoginForm({ nextPath, sessionExpired = false }: LoginFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [sentTo, setSentTo] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<{ seconds: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [resending, setResending] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Focus the email field when the user returns to step 1 (not on first page load).
  const [focusEmail, setFocusEmail] = useState(false);

  const emailForm = useForm<RequestOtpInput>({
    resolver: zodResolver(requestOtpSchema),
    defaultValues: { email: "" },
  });

  const otpForm = useForm<VerifyOtpInput>({
    resolver: zodResolver(verifyOtpSchema),
    defaultValues: { email: "", otp: "" },
  });

  // Live resend countdown, derived from a deadline so it stays accurate in throttled background tabs.
  useEffect(() => {
    if (!countdown) return;
    const deadline = Date.now() + countdown.seconds * 1000;
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        window.clearInterval(timer);
        setAnnouncement("You can now resend the OTP.");
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [countdown]);

  function startCountdown(seconds: number) {
    setSecondsLeft(seconds);
    setCountdown({ seconds });
  }

  async function sendOtp(email: string): Promise<boolean> {
    setFormError(null);
    try {
      const result = await apiRequest<RequestOtpResponse>("/api/auth/request-otp", {
        method: "POST",
        body: { email },
      });
      toast.success(result.message);
      startCountdown(result.resendAvailableInSeconds || OTP_RESEND_COOLDOWN_SECONDS);
      setAnnouncement(
        `${result.message} You can request a new code in ${result.resendAvailableInSeconds} seconds.`,
      );
      return true;
    } catch (error) {
      const retryAfter = retryAfterSeconds(error);
      if (
        retryAfter !== null &&
        error instanceof ApiClientError &&
        error.code === "RATE_LIMITED" &&
        step === "otp"
      ) {
        startCountdown(retryAfter);
      }
      if (error instanceof ApiClientError && error.fieldErrors?.email?.[0] && step === "email") {
        emailForm.setError("email", { type: "server", message: error.fieldErrors.email[0] });
      } else {
        setFormError(getErrorMessage(error));
      }
      // Inputs are read-only (not disabled) while submitting, so focus can return to the field.
      if (step === "email") emailForm.setFocus("email");
      return false;
    }
  }

  async function onRequestOtp(values: RequestOtpInput) {
    // Same email as the code already sent (e.g. after "Change Email"): if the server is still in its resend
    // cooldown, return to the code entry step instead of stranding the user on a rate-limit error.
    if (sentTo && values.email.trim().toLowerCase() === sentTo.trim().toLowerCase()) {
      setFormError(null);
      try {
        const result = await apiRequest<RequestOtpResponse>("/api/auth/request-otp", {
          method: "POST",
          body: { email: values.email },
        });
        toast.success(result.message);
        startCountdown(result.resendAvailableInSeconds || OTP_RESEND_COOLDOWN_SECONDS);
        setAnnouncement(
          `${result.message} You can request a new code in ${result.resendAvailableInSeconds} seconds.`,
        );
      } catch (error) {
        const retryAfter = retryAfterSeconds(error);
        if (!(error instanceof ApiClientError && error.code === "RATE_LIMITED" && retryAfter !== null)) {
          setFormError(getErrorMessage(error));
          emailForm.setFocus("email");
          return;
        }
        startCountdown(retryAfter);
        const message = "A code was already sent to this email. Enter it below.";
        toast.info(message);
        setAnnouncement(`${message} You can request a new code in ${retryAfter} seconds.`);
      }
      otpForm.reset({ email: sentTo, otp: "" });
      setStep("otp");
      return;
    }

    const sent = await sendOtp(values.email);
    if (!sent) return;
    setSentTo(values.email);
    otpForm.reset({ email: values.email, otp: "" });
    setStep("otp");
  }

  async function onResend() {
    if (!sentTo || secondsLeft > 0 || resending) return;
    setResending(true);
    const sent = await sendOtp(sentTo);
    if (sent) otpForm.reset({ email: sentTo, otp: "" });
    setResending(false);
    if (sent) otpForm.setFocus("otp");
  }

  async function onVerifyOtp(values: VerifyOtpInput) {
    setFormError(null);
    try {
      await apiRequest<{ redirectTo: string }>("/api/auth/verify-otp", {
        method: "POST",
        body: { email: values.email, otp: values.otp },
      });
      // Keep the form in its loading state while the destination page loads.
      setRedirecting(true);
      router.replace(safeRedirectPath(nextPath));
      router.refresh();
    } catch (error) {
      const fieldMessage = error instanceof ApiClientError ? error.fieldErrors?.otp?.[0] : undefined;
      if (fieldMessage) {
        otpForm.setError("otp", { type: "server", message: fieldMessage });
      } else {
        setFormError(getErrorMessage(error));
      }
      otpForm.setValue("otp", "");
      otpForm.setFocus("otp");
    }
  }

  function onChangeEmail() {
    setFormError(null);
    setCountdown(null);
    setSecondsLeft(0);
    setAnnouncement("");
    otpForm.reset({ email: "", otp: "" });
    setFocusEmail(true);
    setStep("email");
  }

  const emailError = emailForm.formState.errors.email;
  const otpError = otpForm.formState.errors.otp;
  const sendingOtp = emailForm.formState.isSubmitting;
  const verifying = otpForm.formState.isSubmitting || redirecting;
  const expiryMinutes = Math.round(OTP_TTL_SECONDS / 60);

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {formError ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : sessionExpired && step === "email" ? (
        <Alert role="status">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>Your session has ended. Please sign in again.</AlertDescription>
        </Alert>
      ) : null}

      {step === "email" ? (
        <form onSubmit={emailForm.handleSubmit(onRequestOtp)} noValidate aria-label="Request a sign-in code">
          <FieldGroup>
            <Field data-invalid={emailError ? true : undefined}>
              <FieldLabel htmlFor="login-email">Email</FieldLabel>
              <Input
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus={focusEmail}
                placeholder="name@example.com"
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "login-email-error" : "login-email-description"}
                readOnly={sendingOtp}
                {...emailForm.register("email")}
              />
              {emailError ? (
                <FieldError id="login-email-error" errors={[emailError]} />
              ) : (
                <FieldDescription id="login-email-description">
                  Use the email address registered with your office.
                </FieldDescription>
              )}
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={sendingOtp}>
              {sendingOtp ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                  Sending OTP...
                </>
              ) : (
                "Send OTP"
              )}
            </Button>
          </FieldGroup>
        </form>
      ) : (
        <form onSubmit={otpForm.handleSubmit(onVerifyOtp)} noValidate aria-label="Verify your sign-in code">
          <FieldGroup>
            <Field data-invalid={otpError ? true : undefined}>
              <FieldLabel htmlFor="login-otp">Enter OTP</FieldLabel>
              <FieldDescription id="login-otp-description">
                We sent a {OTP_LENGTH}-digit code to{" "}
                <span className="text-foreground font-medium break-all">{sentTo}</span>. It expires in{" "}
                {expiryMinutes} minutes.
              </FieldDescription>
              <Controller
                control={otpForm.control}
                name="otp"
                render={({ field }) => (
                  <InputOTP
                    id="login-otp"
                    ref={field.ref}
                    name={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    maxLength={OTP_LENGTH}
                    pattern={REGEXP_ONLY_DIGITS}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    readOnly={verifying}
                    aria-invalid={otpError ? true : undefined}
                    aria-describedby={
                      otpError ? "login-otp-description login-otp-error" : "login-otp-description"
                    }
                    containerClassName="justify-center"
                  >
                    <InputOTPGroup>
                      {OTP_SLOTS.map((index) => (
                        <InputOTPSlot
                          key={index}
                          index={index}
                          className="size-11 text-lg"
                          aria-invalid={otpError ? true : undefined}
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                )}
              />
              {otpError ? (
                <FieldError id="login-otp-error" errors={[otpError]} className="text-center" />
              ) : null}
            </Field>

            <Button type="submit" size="lg" className="w-full" disabled={verifying}>
              {verifying ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                  Verifying...
                </>
              ) : (
                "Verify OTP"
              )}
            </Button>

            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                onClick={onResend}
                disabled={secondsLeft > 0 || resending || verifying}
                className="tabular-nums"
              >
                {resending ? (
                  <>
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                    Sending OTP...
                  </>
                ) : secondsLeft > 0 ? (
                  `Resend OTP (${secondsLeft}s)`
                ) : (
                  "Resend OTP"
                )}
              </Button>
              <Button type="button" variant="ghost" onClick={onChangeEmail} disabled={verifying || resending}>
                Change Email
              </Button>
            </div>
            {secondsLeft > 0 ? (
              <p
                className="text-muted-foreground text-center text-xs tabular-nums"
                role="timer"
                aria-live="off"
              >
                You can request a new code in {secondsLeft} second{secondsLeft === 1 ? "" : "s"}.
              </p>
            ) : (
              <p className="text-muted-foreground text-center text-xs">
                Did not receive the code? You can resend it now.
              </p>
            )}
          </FieldGroup>
        </form>
      )}
    </div>
  );
}
