import { Buffer } from "node:buffer";

/**
 * Tiny but structurally valid upload fixtures (magic numbers / containers the app's content sniffer checks),
 * built in memory so the runner needs no binary files.
 */

export const MIME = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  exe: "application/x-msdownload",
} as const;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Uncompressed ("stored") ZIP archive. */
export function makeZip(entries: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
}

const CONTENT_TYPES_XML = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>';

export const fixtures = {
  /** JPEG SOI + JFIF APP0 header, padded to `size` bytes, then EOI. */
  jpg(size = 256): Buffer {
    const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const end = Buffer.from([0xff, 0xd9]);
    return Buffer.concat([header, Buffer.alloc(Math.max(0, size - header.length - end.length), 0x20), end]);
  },
  png(): Buffer {
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x0d]),
      Buffer.from("IHDR", "ascii"),
      Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00]),
      Buffer.from([0x90, 0x77, 0x53, 0xde]),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("IEND", "ascii"),
      Buffer.from([0xae, 0x42, 0x60, 0x82]),
    ]);
  },
  webp(): Buffer {
    const payload = Buffer.alloc(16, 0);
    const chunk = Buffer.concat([Buffer.from("VP8 ", "ascii"), Buffer.from([16, 0, 0, 0]), payload]);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(4 + chunk.length, 0);
    return Buffer.concat([Buffer.from("RIFF", "ascii"), size, Buffer.from("WEBP", "ascii"), chunk]);
  },
  gif(): Buffer {
    return Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.from([1, 0, 1, 0, 0, 0, 0, 0x3b])]);
  },
  exe(): Buffer {
    return Buffer.concat([Buffer.from("MZ", "ascii"), Buffer.alloc(126, 0)]);
  },
  pdf(): Buffer {
    return Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1");
  },
  docx(): Buffer {
    return makeZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "word/document.xml", content: "<w:document/>" },
    ]);
  },
  xlsx(): Buffer {
    return makeZip([
      { name: "[Content_Types].xml", content: CONTENT_TYPES_XML },
      { name: "xl/workbook.xml", content: "<workbook/>" },
    ]);
  },
};

/** A Blob for FormData (copied into a plain ArrayBuffer-backed view). */
export function toBlob(bytes: Buffer, type: string): Blob {
  return new Blob([Uint8Array.from(bytes)], { type });
}
