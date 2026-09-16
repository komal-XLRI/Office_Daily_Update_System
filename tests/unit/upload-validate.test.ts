import { beforeAll, describe, expect, it } from "vitest";

import { AppError, FileTooLargeError, UnsupportedFileError, ValidationError } from "@/lib/errors";
import {
  acceptAttribute,
  getFileExtension,
  MAX_FILES_PER_UPLOAD,
  UPLOAD_RULES,
  type UploadKind,
} from "@/lib/uploads/constants";
import { sniffFileFormat } from "@/lib/uploads/sniff";
import {
  isUploadKind,
  MAX_SAFE_FILE_NAME_LENGTH,
  sanitizeFileName,
  toStorageFileName,
  validateUploadFile,
  type UploadFileInput,
} from "@/lib/uploads/validate";

import {
  bareOle2HeaderBytes,
  compoundFileBytes,
  docBytes,
  docxBytes,
  exeBytes,
  gifBytes,
  jpegBytes,
  MIME,
  pdfBytes,
  plainZipBytes,
  pngBytes,
  webpBytes,
  xlsBytes,
  xlsxBytes,
  zipBytes,
  zipWithoutWordPartBytes,
} from "../setup/upload-fixtures";

// Spec §9 (upload requirements) and §60 (upload testing): JPG, JPEG, PNG, WEBP, PDF, DOC, DOCX, XLS, XLSX;
// validate MIME type, size and extension, and never trust the extension alone.

const MB = 1024 * 1024;
const MAX_BYTES = 10 * MB;

let xlsx: Buffer;

beforeAll(async () => {
  xlsx = await xlsxBytes();
});

function input(name: string, type: string, bytes: Uint8Array, size?: number): UploadFileInput {
  return { name, type, bytes, size: size ?? bytes.byteLength };
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the validation to fail");
}

function expectRejected(
  file: UploadFileInput,
  kind: UploadKind,
  expected: {
    errorClass: abstract new (...args: never[]) => AppError;
    status: number;
    code: string;
    message?: string | RegExp;
  },
  maxBytes = MAX_BYTES,
): AppError {
  const error = captureError(() => validateUploadFile(file, kind, maxBytes));
  expect(error).toBeInstanceOf(expected.errorClass);
  const appError = error as AppError;
  expect(appError.status).toBe(expected.status);
  expect(appError.code).toBe(expected.code);
  if (typeof expected.message === "string") expect(appError.message).toBe(expected.message);
  else if (expected.message) expect(appError.message).toMatch(expected.message);
  return appError;
}

const unsupported = (message?: string | RegExp) => ({
  errorClass: UnsupportedFileError,
  status: 415,
  code: "UNSUPPORTED_FILE",
  message,
});

describe("test fixtures are real files of their format", () => {
  it("sniffs every hand-built sample as the intended format", () => {
    expect(sniffFileFormat(jpegBytes())).toBe("jpeg");
    expect(sniffFileFormat(pngBytes())).toBe("png");
    expect(sniffFileFormat(webpBytes("VP8L"))).toBe("webp");
    expect(sniffFileFormat(webpBytes("VP8 "))).toBe("webp");
    expect(sniffFileFormat(webpBytes("VP8X"))).toBe("webp");
    expect(sniffFileFormat(pdfBytes())).toBe("pdf");
    expect(sniffFileFormat(docBytes())).toBe("doc");
    expect(sniffFileFormat(xlsBytes())).toBe("xls");
    expect(sniffFileFormat(docxBytes())).toBe("docx");
    expect(sniffFileFormat(xlsx)).toBe("xlsx");
  });

  it("recognises nothing in unsupported or malformed content", () => {
    expect(sniffFileFormat(gifBytes())).toBeNull();
    expect(sniffFileFormat(exeBytes())).toBeNull();
    expect(sniffFileFormat(Buffer.from("plain text notes"))).toBeNull();
    expect(sniffFileFormat(new Uint8Array(0))).toBeNull();
    expect(sniffFileFormat(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffFileFormat(bareOle2HeaderBytes())).toBeNull();
    expect(sniffFileFormat(plainZipBytes())).toBeNull();
    expect(sniffFileFormat(zipWithoutWordPartBytes())).toBeNull();
    // A PowerPoint compound file is neither .doc nor .xls.
    expect(sniffFileFormat(compoundFileBytes([{ name: "PowerPoint Document", type: 2 }]))).toBeNull();
    // A truncated package loses its central directory.
    const docx = docxBytes();
    expect(sniffFileFormat(docx.subarray(0, docx.length - 30))).toBeNull();
    // RIFF but not WEBP (e.g. WAV audio).
    expect(sniffFileFormat(Buffer.concat([Buffer.from("RIFF\u0024\u0000\u0000\u0000WAVEfmt ", "latin1"), Buffer.alloc(40)]))).toBeNull();
  });

  it("finds the real end record even when the ZIP comment contains a fake one", () => {
    const entries = zipBytes(
      [
        { name: "[Content_Types].xml", content: "<Types/>" },
        { name: "word/document.xml", content: "<w:document/>" },
      ],
      "PK\u0005\u0006 fake end-of-central-directory inside the comment",
    );
    expect(sniffFileFormat(entries)).toBe("docx");
  });
});

describe("validateUploadFile: accepted types (spec §9, §60)", () => {
  const photoCases: [string, string, () => Buffer, string][] = [
    ["JPG", "meeting-photo.jpg", () => jpegBytes(), MIME.jpeg],
    ["JPEG", "Campus Visit.JPEG", () => jpegBytes(), MIME.jpeg],
    ["PNG", "chart.png", pngBytes, MIME.png],
    ["WEBP (lossless)", "site.webp", () => webpBytes("VP8L"), MIME.webp],
    ["WEBP (lossy)", "site-lossy.webp", () => webpBytes("VP8 "), MIME.webp],
    ["WEBP (extended)", "site-extended.webp", () => webpBytes("VP8X"), MIME.webp],
  ];

  it.each(photoCases)("accepts %s photos as Cloudinary image uploads", (_label, name, bytes, type) => {
    const result = validateUploadFile(input(name, type, bytes()), "photos", MAX_BYTES);
    expect(result.resourceType).toBe("image");
    expect(result.extension).toBe(getFileExtension(name));
    expect(result.safeFileName).toBe(name.replace(/\.[^.]+$/, `.${getFileExtension(name)}`));
  });

  const documentCases: [string, string, () => Buffer, string][] = [
    ["PDF", "Minutes 08-Sep.pdf", () => pdfBytes(), MIME.pdf],
    ["DOC", "letter.doc", docBytes, MIME.doc],
    ["DOCX", "report.docx", docxBytes, MIME.docx],
    ["XLS", "budget.xls", xlsBytes, MIME.xls],
    ["XLSX", "visitors.xlsx", () => xlsx, MIME.xlsx],
  ];

  it.each(documentCases)("accepts %s documents as Cloudinary raw uploads", (_label, name, bytes, type) => {
    const result = validateUploadFile(input(name, type, bytes()), "documents", MAX_BYTES);
    expect(result).toEqual({ safeFileName: name, extension: getFileExtension(name), resourceType: "raw" });
  });

  it("accepts files whose browser could not determine a MIME type (the content decides)", () => {
    expect(validateUploadFile(input("a.xlsx", "", xlsx), "documents", MAX_BYTES).extension).toBe("xlsx");
    expect(validateUploadFile(input("a.docx", "application/octet-stream", docxBytes()), "documents", MAX_BYTES).extension).toBe(
      "docx",
    );
    expect(validateUploadFile(input("a.doc", "", docBytes()), "documents", MAX_BYTES).extension).toBe("doc");
  });

  it("normalises declared MIME case and parameters", () => {
    const result = validateUploadFile(input("a.png", "IMAGE/PNG; charset=binary", pngBytes()), "photos", MAX_BYTES);
    expect(result.resourceType).toBe("image");
  });

  it("accepts a file of exactly the configured maximum size", () => {
    const bytes = pdfBytes(MAX_BYTES);
    expect(bytes.byteLength).toBe(MAX_BYTES);
    expect(validateUploadFile(input("max.pdf", MIME.pdf, bytes), "documents", MAX_BYTES).safeFileName).toBe("max.pdf");
  });

  it("strips directory parts from client-supplied names", () => {
    const result = validateUploadFile(
      input("C:\\Users\\clerk\\Desktop\\Report.PDF", MIME.pdf, pdfBytes()),
      "documents",
      MAX_BYTES,
    );
    expect(result.safeFileName).toBe("Report.pdf");
  });
});

describe("validateUploadFile: size and empty files", () => {
  it("rejects a file whose declared size exceeds the limit (413)", () => {
    expectRejected(input("huge.jpg", MIME.jpeg, jpegBytes(), MAX_BYTES + 1), "photos", {
      errorClass: FileTooLargeError,
      status: 413,
      code: "FILE_TOO_LARGE",
      message: '"huge.jpg" exceeds the 10 MB limit.',
    });
  });

  it("rejects a file whose content exceeds the limit even if the declared size is small (413)", () => {
    expectRejected(input("huge.pdf", MIME.pdf, pdfBytes(MAX_BYTES + 1), 128), "documents", {
      errorClass: FileTooLargeError,
      status: 413,
      code: "FILE_TOO_LARGE",
    });
  });

  it("formats fractional limits in the message", () => {
    expectRejected(
      input("scan.png", MIME.png, pngBytes(), Math.floor(1.5 * MB) + 1),
      "photos",
      { errorClass: FileTooLargeError, status: 413, code: "FILE_TOO_LARGE", message: '"scan.png" exceeds the 1.5 MB limit.' },
      Math.floor(1.5 * MB),
    );
  });

  it("checks size before type, so an oversized unsupported file is still a 413", () => {
    expectRejected(input("setup.exe", MIME.exe, exeBytes(), MAX_BYTES + 1), "documents", {
      errorClass: FileTooLargeError,
      status: 413,
      code: "FILE_TOO_LARGE",
    });
  });

  it("rejects empty files (400)", () => {
    expectRejected(input("empty.pdf", MIME.pdf, new Uint8Array(0)), "documents", {
      errorClass: ValidationError,
      status: 400,
      code: "INVALID_INPUT",
      message: '"empty.pdf" is empty.',
    });
  });
});

describe("validateUploadFile: unsupported extensions (415)", () => {
  it.each([
    ["setup.exe", MIME.exe, exeBytes, "documents"],
    ["setup.exe", MIME.exe, exeBytes, "photos"],
    ["animation.gif", MIME.gif, gifBytes, "photos"],
    ["notes.txt", MIME.text, () => Buffer.from("meeting notes"), "documents"],
    ["logo.svg", "image/svg+xml", () => Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "photos"],
    ["slides.pptx", "", plainZipBytes, "documents"],
  ] as const)("rejects %s for %s", (name, type, bytes, kind) => {
    expectRejected(input(name, type, bytes()), kind, unsupported(`"${name}" is not a supported file. Allowed: ${UPLOAD_RULES[kind].description}.`));
  });

  it("rejects files without an extension, dot-files and trailing dots", () => {
    expectRejected(input("README", "", pdfBytes()), "documents", unsupported(/is not a supported file/));
    expectRejected(input(".pdf", MIME.pdf, pdfBytes()), "documents", unsupported(/is not a supported file/));
    expectRejected(input("report.pdf.", MIME.pdf, pdfBytes()), "documents", unsupported(/is not a supported file/));
    expectRejected(input("", MIME.pdf, pdfBytes()), "documents", unsupported('"File" is not a supported file. Allowed: PDF, DOC, DOCX, XLS or XLSX.'));
  });

  it("does not treat Object prototype keys as allowed extensions", () => {
    for (const name of ["x.constructor", "x.__proto__", "x.toString", "x.hasOwnProperty"]) {
      expectRejected(input(name, "", pdfBytes()), "documents", unsupported(/is not a supported file/));
    }
  });

  it("rejects the executable behind a right-to-left override that displays as .pdf", () => {
    // "invoice<RLO>fdp.exe" renders as "invoiceexe.pdf" in bidi-aware UIs.
    expectRejected(input("invoice\u202Efdp.exe", MIME.pdf, exeBytes()), "documents", unsupported(/is not a supported file/));
  });

  it("rejects photo types under documents and document types under photos", () => {
    for (const [name, type, bytes] of [
      ["photo.jpg", MIME.jpeg, jpegBytes()],
      ["photo.png", MIME.png, pngBytes()],
      ["photo.webp", MIME.webp, webpBytes()],
    ] as const) {
      expectRejected(input(name, type, bytes), "documents", unsupported(/Allowed: PDF, DOC, DOCX, XLS or XLSX\.$/));
    }
    for (const [name, type, bytes] of [
      ["file.pdf", MIME.pdf, pdfBytes()],
      ["file.doc", MIME.doc, docBytes()],
      ["file.docx", MIME.docx, docxBytes()],
      ["file.xls", MIME.xls, xlsBytes()],
      ["file.xlsx", MIME.xlsx, xlsx],
    ] as const) {
      expectRejected(input(name, type, bytes), "photos", unsupported(/Allowed: JPG, JPEG, PNG or WEBP\.$/));
    }
  });

  it("rejects an unknown upload kind (400)", () => {
    expectRejected(input("a.png", MIME.png, pngBytes()), "videos" as UploadKind, {
      errorClass: ValidationError,
      status: 400,
      code: "INVALID_INPUT",
      message: "Select a valid upload type.",
    });
  });
});

describe("validateUploadFile: wrong declared MIME type (415)", () => {
  it.each([
    ["photo.png", "application/pdf", pngBytes, "photos"],
    ["photo.jpg", MIME.png, () => jpegBytes(), "photos"],
    ["photo.webp", MIME.jpeg, () => webpBytes(), "photos"],
    ["minutes.pdf", "text/html", () => pdfBytes(), "documents"],
    ["report.docx", MIME.xlsx, docxBytes, "documents"],
    ["sheet.xlsx", MIME.docx, () => xlsx, "documents"],
    ["letter.doc", MIME.xls, docBytes, "documents"],
    ["budget.xls", "application/x-msdownload", xlsBytes, "documents"],
  ] as const)("rejects %s declared as %s", (name, type, bytes, kind) => {
    expectRejected(input(name, type, bytes()), kind, unsupported(`${name}: file type does not match its extension.`));
  });
});

describe("validateUploadFile: spoofed content (415)", () => {
  it.each([
    ["PDF bytes named .png", "fake.png", MIME.png, () => pdfBytes(), "photos"],
    ["PNG bytes named .jpg", "fake.jpg", MIME.jpeg, pngBytes, "photos"],
    ["JPEG bytes named .webp", "fake.webp", MIME.webp, () => jpegBytes(), "photos"],
    ["GIF bytes named .png", "fake.png", MIME.png, gifBytes, "photos"],
    ["executable named .pdf", "fake.pdf", MIME.pdf, exeBytes, "documents"],
    ["HTML named .pdf", "fake.pdf", "", () => Buffer.from("<!doctype html><script>alert(1)</script>"), "documents"],
    ["ZIP without word/ named .docx", "fake.docx", MIME.docx, zipWithoutWordPartBytes, "documents"],
    ["plain ZIP named .docx", "fake.docx", MIME.docx, plainZipBytes, "documents"],
    ["XLSX named .docx", "fake.docx", "", () => xlsx, "documents"],
    ["DOCX named .xlsx", "fake.xlsx", "", docxBytes, "documents"],
    ["DOCX named .doc", "fake.doc", MIME.doc, docxBytes, "documents"],
    ["bare OLE2 header named .doc", "fake.doc", MIME.doc, bareOle2HeaderBytes, "documents"],
    ["bare OLE2 header named .xls", "fake.xls", MIME.xls, bareOle2HeaderBytes, "documents"],
    ["DOC compound file named .xls", "fake.xls", MIME.xls, docBytes, "documents"],
    ["XLS compound file named .doc", "fake.doc", MIME.doc, xlsBytes, "documents"],
    ["HTML table exported as .xls", "export.xls", MIME.xls, () => Buffer.from("<table><tr><td>1</td></tr></table>"), "documents"],
  ] as const)("rejects %s", (_label, name, type, bytes, kind) => {
    expectRejected(input(name, type, bytes()), kind, unsupported(`${name}: file content does not match its extension.`));
  });

  it("keeps error messages short and free of invisible characters", () => {
    const longName = `${"a".repeat(500)}\u202E\u0007.pdf`;
    const error = expectRejected(input(longName, "", exeBytes()), "documents", unsupported());
    expect(error.message.length).toBeLessThan(150);
    expect(error.message).not.toMatch(/[\u202E\u0007]/);
    expect(error.message).toContain("...");
  });
});

describe("sanitizeFileName", () => {
  it.each([
    // Paths
    ["../../etc/passwd.pdf", "pdf", "passwd.pdf"],
    ["C:\\Users\\clerk\\Desktop\\report.PDF", "pdf", "report.pdf"],
    ["folder/sub\\mixed/photo.jpg", "jpg", "photo.jpg"],
    ["\\\\server\\share\\minutes.docx", "docx", "minutes.docx"],
    ["uploads/", "png", "file.png"],
    // Whitespace, control characters and reserved characters
    ["  Weekly   report  (final).pdf", "pdf", "Weekly report (final).pdf"],
    // Tabs are control characters: removed (not turned into spaces) like every other \p{Cc}.
    ["tab\there.pdf", "pdf", "tabhere.pdf"],
    ["my\u0000file\u0007.pdf", "pdf", "myfile.pdf"],
    ['a<b>c:d"e|f?g*h.pdf', "pdf", "a_b_c_d_e_f_g_h.pdf"],
    ["50% done #2.xlsx", "xlsx", "50_ done _2.xlsx"],
    // Hidden files, dots and empty names
    [".pdf", "pdf", "file.pdf"],
    ["....", "pdf", "file.pdf"],
    ["", "pdf", "file.pdf"],
    [".htaccess.jpg", "jpg", "htaccess.jpg"],
    // Extensions
    ["photo", "jpg", "photo.jpg"],
    ["SCAN.JPEG", "JPEG", "SCAN.jpeg"],
    ["archive.tar.gz", "pdf", "archive.tar.gz.pdf"],
    ["report.pdf.exe", "exe", "report.pdf.exe"],
    ["notes", "", "notes"],
    ["notes.pdf", ".P/D\\F", "notes.pdf"],
    // Unicode
    ["प्रगति रिपोर्ट.pdf", "pdf", "प्रगति रिपोर्ट.pdf"],
    ["Café Menu.JPG", "jpg", "Café Menu.jpg"],
    ["会議の議事録.docx", "docx", "会議の議事録.docx"],
    ["تقرير الزوار.xlsx", "xlsx", "تقرير الزوار.xlsx"],
    ["report 😀.pdf", "pdf", "report.pdf"],
    ["😀😀😀.png", "png", "file.png"],
    // Leading characters that could start a spreadsheet formula
    ["=cmd|' /C calc'!A0.xlsx", "xlsx", "C calc'!A0.xlsx"],
    ['=HYPERLINK("x").xlsx', "xlsx", "HYPERLINK(_x_).xlsx"],
    ["+SUM(A1).xlsx", "xlsx", "SUM(A1).xlsx"],
    ["-2+3.csv.xls", "xls", "2+3.csv.xls"],
    ["@SUM(A1).xls", "xls", "SUM(A1).xls"],
  ])("sanitizeFileName(%j, %j) → %j", (name, extension, expected) => {
    expect(sanitizeFileName(name, extension)).toBe(expected);
  });

  it("composes decomposed Unicode (NFC) so equal names compare equal", () => {
    const decomposed = "Cafe\u0301 Menu.jpg";
    expect(sanitizeFileName(decomposed, "jpg")).toBe("Caf\u00e9 Menu.jpg");
  });

  it("strips bidi overrides, isolates, zero-width and separator characters", () => {
    expect(sanitizeFileName("invoice\u202Egpj.pdf", "pdf")).toBe("invoicegpj.pdf");
    expect(sanitizeFileName("\u2067report\u2069\u200B\u200D\uFEFF.pdf", "pdf")).toBe("report.pdf");
    expect(sanitizeFileName("line\u2028break\u2029para.pdf", "pdf")).toBe("linebreakpara.pdf");
    expect(sanitizeFileName("\u202Dleft-to-right\u202C.docx", "docx")).toBe("left-to-right.docx");
  });

  it("never returns directory separators, control characters or a formula prefix", () => {
    const hostile = [
      "<script>alert(1)</script>.png",
      "..\\..\\windows\\system32\\evil.pdf",
      "=1+2\u0000\r\n.xlsx",
      "\t=SUM(A1)",
      " @import.pdf",
      "~$lock.docx",
      "!important.pdf",
      "'quoted'.pdf",
    ];
    for (const name of hostile) {
      const result = sanitizeFileName(name, getFileExtension(name) || "pdf");
      expect(result).not.toMatch(/[/\\\p{Cc}\p{Cf}]/u);
      expect(result).not.toMatch(/^[=+\-@\s.'~!_]/);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("caps very long ASCII names at MAX_SAFE_FILE_NAME_LENGTH including the extension", () => {
    const result = sanitizeFileName(`${"x".repeat(300)}.pdf`, "pdf");
    expect(MAX_SAFE_FILE_NAME_LENGTH).toBe(120);
    expect(result).toHaveLength(MAX_SAFE_FILE_NAME_LENGTH);
    expect(result.endsWith("x.pdf")).toBe(true);
  });

  it("removes separators left dangling at the cut point", () => {
    const result = sanitizeFileName(`${"a".repeat(115)} ${"b".repeat(20)}.docx`, "docx");
    // Base is cut to 115 characters ("a"×115 + " "); the trailing space is then removed.
    expect(result).toBe(`${"a".repeat(115)}.docx`);
  });

  it("counts code points (not UTF-16 units) and never splits a surrogate pair", () => {
    const cjk = sanitizeFileName(`${"日本語".repeat(100)}.xlsx`, "xlsx");
    expect(Array.from(cjk)).toHaveLength(MAX_SAFE_FILE_NAME_LENGTH);
    expect(cjk.endsWith(".xlsx")).toBe(true);

    const astral = sanitizeFileName(`${"𝒜".repeat(200)}.pdf`, "pdf"); // U+1D49C is a letter outside the BMP
    expect(Array.from(astral).length).toBeLessThanOrEqual(MAX_SAFE_FILE_NAME_LENGTH);
    expect(astral.isWellFormed()).toBe(true);
    expect(astral.endsWith(".pdf")).toBe(true);
  });
});

describe("toStorageFileName", () => {
  it.each([
    ["Café Menu (v2).jpg", "jpg", "Cafe_Menu_v2.jpg"],
    ["Weekly report (final).pdf", "pdf", "Weekly_report_final.pdf"],
    ["प्रगति रिपोर्ट.pdf", "pdf", "file.pdf"],
    ["minutes.docx", "docx", "minutes.docx"],
    ["---.png", "png", "file.png"],
  ])("toStorageFileName(%j) → %j", (safeName, extension, expected) => {
    expect(toStorageFileName(safeName, extension)).toBe(expected);
  });

  it("produces ASCII-only public ids of bounded length", () => {
    const result = toStorageFileName(`${"b".repeat(200)} ü 日本.pdf`, "pdf");
    expect(result).toMatch(/^[A-Za-z0-9_-]+\.pdf$/);
    expect(result.length).toBeLessThanOrEqual(64);
  });
});

describe("upload constants", () => {
  it("allows exactly the spec §9 types per kind", () => {
    expect(Object.keys(UPLOAD_RULES.photos.mimeTypesByExtension).sort()).toEqual(["jpeg", "jpg", "png", "webp"]);
    expect(Object.keys(UPLOAD_RULES.documents.mimeTypesByExtension).sort()).toEqual(["doc", "docx", "pdf", "xls", "xlsx"]);
    expect(MAX_FILES_PER_UPLOAD).toBe(10);
  });

  it("builds accept attributes from the same rules", () => {
    expect(acceptAttribute("photos").split(",")).toEqual([".jpg", ".jpeg", ".png", ".webp", "image/jpeg", "image/png", "image/webp"]);
    expect(acceptAttribute("documents")).toContain(".docx");
    expect(acceptAttribute("documents")).toContain(MIME.xlsx);
  });

  it("recognises only the two upload kinds", () => {
    expect(isUploadKind("photos")).toBe(true);
    expect(isUploadKind("documents")).toBe(true);
    expect(isUploadKind("videos")).toBe(false);
    expect(isUploadKind(null)).toBe(false);
  });

  it("extracts lowercase extensions", () => {
    expect(getFileExtension("A.B.PDF")).toBe("pdf");
    expect(getFileExtension(".env")).toBe("");
    expect(getFileExtension("trailing.")).toBe("");
    expect(getFileExtension("none")).toBe("");
  });
});
