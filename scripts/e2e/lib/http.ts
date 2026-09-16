import { Buffer } from "node:buffer";

/**
 * fetch-based HTTP client with a per-user cookie jar. Redirects are never followed automatically, so
 * checks can inspect 3xx responses. Every response is reported to a recorder (used for leak scans).
 */

export interface RecordedResponse {
  client: string;
  method: string;
  path: string;
  status: number;
  contentType: string;
  /** Body for textual responses (JSON, HTML, CSV, ...); null for binary downloads. */
  text: string | null;
}

export type ResponseRecorder = (response: RecordedResponse) => void;

const TEXTUAL_CONTENT_TYPE = /json|text\/|html|xml|javascript|x-component/i;

export class HttpResponse {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly headers: Headers,
    readonly bytes: Buffer,
  ) {}

  get contentType(): string {
    return this.headers.get("content-type") ?? "";
  }

  get isTextual(): boolean {
    return TEXTUAL_CONTENT_TYPE.test(this.contentType);
  }

  get text(): string {
    return this.bytes.toString("utf8");
  }

  get location(): string | null {
    return this.headers.get("location");
  }

  get setCookies(): string[] {
    return this.headers.getSetCookie();
  }

  json<T>(): T {
    try {
      return JSON.parse(this.text) as T;
    } catch {
      throw new Error(`Expected a JSON body from ${this.describe()}`);
    }
  }

  /** One-line description for failure messages. */
  describe(max = 400): string {
    const body = this.isTextual ? this.text.replace(/\s+/g, " ").slice(0, max) : `<${this.bytes.length} bytes ${this.contentType}>`;
    const location = this.location ? ` Location: ${this.location}` : "";
    return `${this.method} ${this.path} -> ${this.status}${location} ${body}`;
  }
}

export interface RequestOptions {
  json?: unknown;
  form?: FormData;
  body?: string | Uint8Array<ArrayBuffer>;
  headers?: Record<string, string>;
  /** Origin header. Default: the app origin on unsafe methods, none on GET/HEAD. null = never send. */
  origin?: string | null;
  redirect?: RequestRedirect;
  timeoutMs?: number;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class HttpClient {
  private readonly cookies = new Map<string, string>();

  constructor(
    readonly label: string,
    private readonly baseUrl: string,
    private readonly recorder: ResponseRecorder,
    /** Simulated client address (the app's per-IP limiter keys on X-Forwarded-For). */
    readonly forwardedFor?: string,
  ) {}

  get origin(): string {
    return new URL(this.baseUrl).origin;
  }

  /** A copy of this client with the same cookies. */
  clone(label: string, forwardedFor = this.forwardedFor): HttpClient {
    const copy = new HttpClient(label, this.baseUrl, this.recorder, forwardedFor);
    for (const [name, value] of this.cookies) copy.setCookie(name, value);
    return copy;
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  deleteCookie(name: string): void {
    this.cookies.delete(name);
  }

  private absorbSetCookies(setCookies: string[]): void {
    for (const header of setCookies) {
      const [pair, ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const lower = attributes.map((attribute) => attribute.trim().toLowerCase());
      const maxAge = lower.find((attribute) => attribute.startsWith("max-age="));
      const expires = lower.find((attribute) => attribute.startsWith("expires="));
      const expired =
        value === "" ||
        (maxAge !== undefined && Number(maxAge.slice("max-age=".length)) <= 0) ||
        (expires !== undefined && Date.parse(expires.slice("expires=".length)) <= Date.now());
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request(method: string, path: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const headers: Record<string, string> = {};
    if (this.forwardedFor) headers["X-Forwarded-For"] = this.forwardedFor;
    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    const origin = options.origin === undefined ? (SAFE_METHODS.has(method) ? null : this.origin) : options.origin;
    if (origin) headers.Origin = origin;

    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form;
    } else if (options.body !== undefined) {
      body = options.body;
    }
    Object.assign(headers, options.headers);

    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      body,
      redirect: options.redirect ?? "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const result = new HttpResponse(method, path, response.status, response.headers, bytes);
    this.absorbSetCookies(result.setCookies);
    this.recorder({
      client: this.label,
      method,
      path,
      status: result.status,
      contentType: result.contentType,
      text: result.isTextual ? result.text : null,
    });
    return result;
  }

  get(path: string, options?: RequestOptions): Promise<HttpResponse> {
    return this.request("GET", path, options);
  }

  post(path: string, json?: unknown, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.request("POST", path, json === undefined ? options : { ...options, json });
  }

  patch(path: string, json?: unknown, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.request("PATCH", path, json === undefined ? options : { ...options, json });
  }

  delete(path: string, options?: RequestOptions): Promise<HttpResponse> {
    return this.request("DELETE", path, options);
  }
}
