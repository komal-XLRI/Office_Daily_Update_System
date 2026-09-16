/**
 * Dependency-free content sniffing for uploads (spec §9: "Do not blindly trust file extensions").
 * Detects the real format from magic numbers and, for container formats, from the container structure:
 *   - OLE2 compound files (legacy .doc / .xls): streams at the root of the directory tree
 *   - ZIP packages (.docx / .xlsx): central-directory entry names
 * Pure and synchronous — no Node or Next imports, so it is safe to unit test anywhere.
 */

export type SniffedFormat = "jpeg" | "png" | "webp" | "pdf" | "doc" | "xls" | "docx" | "xlsx";

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_LOCAL_FILE_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function asciiBytes(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

function matchesAt(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[offset + index] !== signature[index]) return false;
  }
  return true;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function isPng(bytes: Uint8Array): boolean {
  // The IHDR chunk must come first in every valid PNG.
  return matchesAt(bytes, PNG_SIGNATURE) && matchesAt(bytes, asciiBytes("IHDR"), 12);
}

function isWebp(bytes: Uint8Array): boolean {
  // "RIFF" <size> "WEBP" followed by a VP8 / VP8L / VP8X chunk.
  return (
    matchesAt(bytes, asciiBytes("RIFF")) &&
    matchesAt(bytes, asciiBytes("WEBP"), 8) &&
    (matchesAt(bytes, asciiBytes("VP8 "), 12) ||
      matchesAt(bytes, asciiBytes("VP8L"), 12) ||
      matchesAt(bytes, asciiBytes("VP8X"), 12))
  );
}

// ---------------------------------------------------------------------------------------------------
// OLE2 / Compound File Binary (MS-CFB)
// ---------------------------------------------------------------------------------------------------

const CFB_HEADER_SIZE = 512;
const CFB_MAX_REGULAR_SECTOR = 0xfffffffa;
const CFB_END_OF_CHAIN = 0xfffffffe;
const CFB_NO_STREAM = 0xffffffff;
const CFB_HEADER_DIFAT_ENTRIES = 109;
const CFB_DIRECTORY_ENTRY_SIZE = 128;
const CFB_TYPE_STORAGE = 1;
const CFB_TYPE_STREAM = 2;
const CFB_TYPE_ROOT = 5;

/** Names of the storages/streams directly under the root storage, or null if the structure is invalid. */
function readCompoundFileRootNames(bytes: Uint8Array): string[] | null {
  if (bytes.length < CFB_HEADER_SIZE || !matchesAt(bytes, OLE2_SIGNATURE)) return null;
  const view = dataView(bytes);

  if (view.getUint16(0x1c, true) !== 0xfffe) return null; // byte order mark
  const sectorShift = view.getUint16(0x1e, true);
  if (sectorShift !== 9 && sectorShift !== 12) return null; // 512 (v3) or 4096 (v4) byte sectors
  const sectorSize = 2 ** sectorShift;
  const entriesPerSector = sectorSize / 4;
  const maxSectors = Math.ceil(bytes.length / sectorSize);

  const sectorStart = (sector: number): number | null => {
    if (sector > CFB_MAX_REGULAR_SECTOR) return null;
    const start = (sector + 1) * sectorSize;
    return start < bytes.length ? start : null;
  };

  // Locations of the FAT sectors: the first 109 are in the header, the rest in the DIFAT chain.
  const fatSectorCount = view.getUint32(0x2c, true);
  if (fatSectorCount > maxSectors) return null;
  const fatSectors: number[] = [];
  for (let index = 0; index < CFB_HEADER_DIFAT_ENTRIES && fatSectors.length < fatSectorCount; index += 1) {
    fatSectors.push(view.getUint32(0x4c + index * 4, true));
  }
  let difatSector = view.getUint32(0x44, true);
  const visitedDifat = new Set<number>();
  while (fatSectors.length < fatSectorCount) {
    const start = sectorStart(difatSector);
    if (start === null || visitedDifat.has(difatSector) || start + sectorSize > bytes.length) return null;
    visitedDifat.add(difatSector);
    for (let index = 0; index < entriesPerSector - 1 && fatSectors.length < fatSectorCount; index += 1) {
      fatSectors.push(view.getUint32(start + index * 4, true));
    }
    difatSector = view.getUint32(start + (entriesPerSector - 1) * 4, true);
  }

  const nextSector = (sector: number): number | null => {
    const fatSector = fatSectors[Math.floor(sector / entriesPerSector)];
    if (fatSector === undefined) return null;
    const start = sectorStart(fatSector);
    if (start === null) return null;
    const position = start + (sector % entriesPerSector) * 4;
    return position + 4 <= bytes.length ? view.getUint32(position, true) : null;
  };

  // Directory entries live in the chain that starts at the header's first directory sector.
  const entryOffsets: number[] = [];
  const visitedDirectory = new Set<number>();
  let directorySector = view.getUint32(0x30, true);
  while (directorySector !== CFB_END_OF_CHAIN) {
    const start = sectorStart(directorySector);
    if (start === null || visitedDirectory.has(directorySector) || visitedDirectory.size >= maxSectors) return null;
    visitedDirectory.add(directorySector);
    for (let offset = 0; offset < sectorSize; offset += CFB_DIRECTORY_ENTRY_SIZE) {
      if (start + offset + CFB_DIRECTORY_ENTRY_SIZE > bytes.length) break;
      entryOffsets.push(start + offset);
    }
    const next = nextSector(directorySector);
    if (next === null) return null;
    directorySector = next;
  }

  const root = entryOffsets[0];
  if (root === undefined || view.getUint8(root + 0x42) !== CFB_TYPE_ROOT) return null;

  const readName = (offset: number): string => {
    const length = view.getUint16(offset + 0x40, true); // bytes, including the UTF-16 terminator
    if (length < 2 || length > 64 || length % 2 !== 0) return "";
    let name = "";
    for (let index = 0; index < length - 2; index += 2) {
      name += String.fromCharCode(view.getUint16(offset + index, true));
    }
    return name;
  };

  // The root's children form a tree linked through left/right sibling ids.
  const names: string[] = [];
  const visitedEntries = new Set<number>();
  const pending = [view.getUint32(root + 0x4c, true)];
  while (pending.length > 0) {
    const id = pending.pop() as number;
    if (id === CFB_NO_STREAM || visitedEntries.has(id)) continue;
    const offset = entryOffsets[id];
    if (offset === undefined) return null;
    visitedEntries.add(id);
    const type = view.getUint8(offset + 0x42);
    if (type === CFB_TYPE_STREAM || type === CFB_TYPE_STORAGE) names.push(readName(offset));
    pending.push(view.getUint32(offset + 0x44, true), view.getUint32(offset + 0x48, true));
  }
  return names;
}

function sniffCompoundFile(bytes: Uint8Array): "doc" | "xls" | null {
  const names = readCompoundFileRootNames(bytes);
  if (!names) return null;
  const lowerNames = new Set(names.map((name) => name.toLowerCase()));
  const isDoc = lowerNames.has("worddocument");
  // BIFF8 workbooks use "Workbook"; BIFF5/BIFF7 workbooks use "Book".
  const isXls = lowerNames.has("workbook") || lowerNames.has("book");
  if (isDoc === isXls) return null;
  return isDoc ? "doc" : "xls";
}

// ---------------------------------------------------------------------------------------------------
// ZIP / Office Open XML packages
// ---------------------------------------------------------------------------------------------------

const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP_EOCD_SIZE = 22;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;

function readUint64(view: DataView, offset: number): number {
  return view.getUint32(offset + 4, true) * 2 ** 32 + view.getUint32(offset, true);
}

/**
 * Entry names from the ZIP central directory, or null if the archive structure is invalid. The end record is
 * searched backwards and a candidate is only trusted when the central directory it points to is valid, so an
 * end-record signature inside the archive comment or trailing bytes cannot hide the real one.
 */
function readZipEntryNames(bytes: Uint8Array): string[] | null {
  if (bytes.length < ZIP_EOCD_SIZE) return null;
  const view = dataView(bytes);

  const lowestOffset = Math.max(0, bytes.length - ZIP_EOCD_SIZE - ZIP_MAX_COMMENT_LENGTH);
  for (let offset = bytes.length - ZIP_EOCD_SIZE; offset >= lowestOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const names = readCentralDirectoryNames(bytes, view, offset);
    if (names && names.length > 0) return names;
  }
  return null;
}

/** Names listed by the central directory that the end record at `eocd` points to, or null if it is invalid. */
function readCentralDirectoryNames(bytes: Uint8Array, view: DataView, eocd: number): string[] | null {
  let entryCount = view.getUint16(eocd + 10, true);
  let directoryOffset = view.getUint32(eocd + 16, true);

  const locator = eocd - 20;
  if (
    (entryCount === 0xffff || directoryOffset === 0xffffffff) &&
    locator >= 0 &&
    view.getUint32(locator, true) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR
  ) {
    const zip64Eocd = readUint64(view, locator + 8);
    if (zip64Eocd + 56 > bytes.length || view.getUint32(zip64Eocd, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY) {
      return null;
    }
    entryCount = readUint64(view, zip64Eocd + 32);
    directoryOffset = readUint64(view, zip64Eocd + 48);
  }

  const names: string[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_ENTRY) return null;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameEnd = offset + 46 + nameLength;
    if (nameEnd > bytes.length) return null;
    // Only ASCII prefixes are compared, so a byte-wise decode is sufficient.
    names.push(String.fromCharCode(...bytes.subarray(offset + 46, nameEnd)));
    offset = nameEnd + extraLength + commentLength;
  }
  return names;
}

function sniffOfficeOpenXml(bytes: Uint8Array): "docx" | "xlsx" | null {
  const names = readZipEntryNames(bytes);
  if (!names) return null;
  const lowerNames = names.map((name) => name.replace(/\\/g, "/").toLowerCase());
  if (!lowerNames.includes("[content_types].xml")) return null;
  const isDocx = lowerNames.some((name) => name.startsWith("word/"));
  const isXlsx = lowerNames.some((name) => name.startsWith("xl/"));
  if (isDocx === isXlsx) return null;
  return isDocx ? "docx" : "xlsx";
}

/** Detect the real format of a file from its content. Returns null for anything unrecognised. */
export function sniffFileFormat(bytes: Uint8Array): SniffedFormat | null {
  if (matchesAt(bytes, JPEG_SIGNATURE)) return "jpeg";
  if (isPng(bytes)) return "png";
  if (isWebp(bytes)) return "webp";
  if (matchesAt(bytes, asciiBytes("%PDF-"))) return "pdf";

  try {
    if (matchesAt(bytes, OLE2_SIGNATURE)) return sniffCompoundFile(bytes);
    if (matchesAt(bytes, ZIP_LOCAL_FILE_SIGNATURE)) return sniffOfficeOpenXml(bytes);
  } catch {
    // A malformed container can make a read run past the end of the buffer.
    return null;
  }
  return null;
}
