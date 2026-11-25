import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

export const RAYU_ICON_CODEPOINT = 0xea01;

// ---------------------------------------------------------------------------
// Zero-Dependency Spec-Compliant TrueType -> WOFF 1.0 Rayu Fox Icon Font
// ---------------------------------------------------------------------------
// Generates a crisp, OpenType-Sanitizer (OTS) compliant WOFF 1.0 font
// containing `.notdef` (glyph 0) and the RayuCode Fox silhouette at U+EA01
// (glyph 1) for VS Code Status Bar (`$(rayucode)`), where VS Code always tints
// icon font glyphs to `--vscode-statusBar-foreground`.

const UPM = 1000;
const ASCENDER = 850;
const DESCENDER = -150;

function svgToFontPt(sx, sy) {
  return [
    Math.round((sx / 24) * UPM),
    Math.round(((24 - sy) / 24) * UPM + DESCENDER),
  ];
}

function signedArea2(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

function ensureWinding(pts, dir) {
  const area = signedArea2(pts);
  // In math coordinates (+Y up), CW has area < 0 (solid in TrueType),
  // CCW has area > 0 (hole in TrueType).
  const isCw = area < 0;
  if ((dir === "cw" && !isCw) || (dir === "ccw" && isCw)) {
    return [...pts].reverse();
  }
  return pts;
}

function buildRayuFoxContours() {
  // Bold curled Rayu Fox silhouette matching rayu-fox.png:
  // two pointed fox ears at top, sleek snout pointing right, curled crescent
  // body wrapping around a hollow inner circle containing a crisp `</>` mark.
  const outerFox = ensureWinding(
    [
      // Left ear tip & outer head sweep
      [11.3, 1.5],
      [9.4, 4.4],
      [8.6, 6.4],
      [6.4, 7.6],
      [4.5, 9.7],
      [3.4, 12.4],
      [3.3, 15.2],
      [4.2, 18.0],
      [6.1, 20.3],
      [8.8, 21.9],
      [12.0, 22.5],
      [15.4, 22.0],
      [18.1, 20.4],
      [19.9, 18.0],
      [20.6, 15.6],
      [20.0, 13.5],
      [18.2, 12.2],
      [15.6, 12.1],
      [14.2, 12.6],
      // Inner curl cavity edge (sweeping around center `</>` space)
      [16.1, 13.4],
      [17.2, 14.8],
      [17.1, 16.6],
      [15.9, 18.2],
      [13.9, 19.2],
      [11.4, 19.2],
      [9.2, 18.2],
      [7.8, 16.4],
      [7.6, 14.2],
      [8.5, 12.2],
      [10.4, 10.9],
      [12.9, 10.7],
      // Fox snout & chin pointing right
      [16.4, 11.4],
      [19.2, 10.2],
      [17.5, 8.6],
      [16.3, 6.9],
      // Right ear tip
      [15.8, 2.4],
      [13.5, 4.6],
      [12.8, 4.8],
    ].map(([x, y]) => svgToFontPt(x, y)),
    "cw",
  );

  // Subtle eye cutout on fox face (CCW = hole)
  const foxEyeCutout = ensureWinding(
    [
      [13.4, 7.7],
      [15.5, 8.2],
      [14.8, 9.1],
      [13.5, 8.6],
    ].map(([x, y]) => svgToFontPt(x, y)),
    "ccw",
  );

  // Crisp `<` chevron inside the fox curl (CW = solid)
  const codeLeft = ensureWinding(
    [
      [11.1, 13.4],
      [11.8, 14.1],
      [10.6, 15.1],
      [11.8, 16.1],
      [11.1, 16.8],
      [9.1, 15.1],
    ].map(([x, y]) => svgToFontPt(x, y)),
    "cw",
  );

  // Crisp `/` slash inside the fox curl (CW = solid)
  const codeSlash = ensureWinding(
    [
      [13.2, 13.0],
      [14.1, 13.2],
      [12.9, 17.3],
      [12.0, 17.1],
    ].map(([x, y]) => svgToFontPt(x, y)),
    "cw",
  );

  // Crisp `>` chevron inside the fox curl (CW = solid)
  const codeRight = ensureWinding(
    [
      [14.5, 13.4],
      [16.5, 15.1],
      [14.5, 16.8],
      [13.8, 16.1],
      [15.0, 15.1],
      [13.8, 14.1],
    ].map(([x, y]) => svgToFontPt(x, y)),
    "cw",
  );

  return [outerFox, foxEyeCutout, codeLeft, codeSlash, codeRight];
}

function pad4(buf) {
  const rem = buf.length % 4;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}

function calcTableChecksum(buf) {
  const padded = pad4(buf);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) {
    sum = (sum + padded.readUInt32BE(i)) >>> 0;
  }
  return sum;
}

function encodeSimpleGlyph(contours) {
  const endPtsOfContours = [];
  const allPts = [];
  for (const contour of contours) {
    for (const pt of contour) {
      allPts.push(pt);
    }
    endPtsOfContours.push(allPts.length - 1);
  }

  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const [x, y] of allPts) {
    if (x < xMin) xMin = x;
    if (y < yMin) yMin = y;
    if (x > xMax) xMax = x;
    if (y > yMax) yMax = y;
  }

  const flags = [];
  const xBytes = [];
  const yBytes = [];
  let prevX = 0;
  let prevY = 0;

  for (const [x, y] of allPts) {
    const dx = x - prevX;
    const dy = y - prevY;
    prevX = x;
    prevY = y;

    let flag = 0x01; // ON_CURVE_POINT

    if (dx === 0) {
      flag |= 0x10;
    } else if (dx >= -255 && dx <= 255) {
      flag |= 0x02;
      if (dx > 0) flag |= 0x10;
      xBytes.push(Math.abs(dx));
    } else {
      xBytes.push((dx >> 8) & 0xff, dx & 0xff);
    }

    if (dy === 0) {
      flag |= 0x20;
    } else if (dy >= -255 && dy <= 255) {
      flag |= 0x04;
      if (dy > 0) flag |= 0x20;
      yBytes.push(Math.abs(dy));
    } else {
      yBytes.push((dy >> 8) & 0xff, dy & 0xff);
    }

    flags.push(flag);
  }

  const headerSize = 10 + endPtsOfContours.length * 2 + 2;
  const raw = Buffer.alloc(
    headerSize + flags.length + xBytes.length + yBytes.length,
  );
  let off = 0;
  raw.writeInt16BE(contours.length, off);
  off += 2;
  raw.writeInt16BE(xMin, off);
  off += 2;
  raw.writeInt16BE(yMin, off);
  off += 2;
  raw.writeInt16BE(xMax, off);
  off += 2;
  raw.writeInt16BE(yMax, off);
  off += 2;

  for (const endPt of endPtsOfContours) {
    raw.writeUInt16BE(endPt, off);
    off += 2;
  }
  raw.writeUInt16BE(0, off); // instructionLength
  off += 2;

  Buffer.from(flags).copy(raw, off);
  off += flags.length;
  Buffer.from(xBytes).copy(raw, off);
  off += xBytes.length;
  Buffer.from(yBytes).copy(raw, off);

  return {
    buf: pad4(raw),
    bbox: { xMin, yMin, xMax, yMax },
    pointCount: allPts.length,
    contourCount: contours.length,
  };
}

function buildCmapTable(codePoint, glyphId) {
  const segCount = 2;
  const segCountX2 = segCount * 2;
  const searchRange = 4;
  const entrySelector = 1;
  const rangeShift = segCountX2 - searchRange;

  const format4Len = 14 + segCount * 8 + 2;
  const subtable = Buffer.alloc(format4Len);
  let off = 0;
  subtable.writeUInt16BE(4, off);
  off += 2;
  subtable.writeUInt16BE(format4Len, off);
  off += 2;
  subtable.writeUInt16BE(0, off);
  off += 2;
  subtable.writeUInt16BE(segCountX2, off);
  off += 2;
  subtable.writeUInt16BE(searchRange, off);
  off += 2;
  subtable.writeUInt16BE(entrySelector, off);
  off += 2;
  subtable.writeUInt16BE(rangeShift, off);
  off += 2;
  subtable.writeUInt16BE(codePoint, off);
  off += 2;
  subtable.writeUInt16BE(0xffff, off);
  off += 2;
  subtable.writeUInt16BE(0, off);
  off += 2;
  subtable.writeUInt16BE(codePoint, off);
  off += 2;
  subtable.writeUInt16BE(0xffff, off);
  off += 2;
  const idDelta = (glyphId - codePoint) & 0xffff;
  subtable.writeUInt16BE(idDelta, off);
  off += 2;
  subtable.writeUInt16BE(1, off);
  off += 2;
  subtable.writeUInt16BE(0, off);
  off += 2;
  subtable.writeUInt16BE(0, off);

  const headerLen = 4 + 2 * 8;
  const header = Buffer.alloc(headerLen);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(2, 2);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(3, 6);
  header.writeUInt32BE(headerLen, 8);
  header.writeUInt16BE(3, 12);
  header.writeUInt16BE(1, 14);
  header.writeUInt32BE(headerLen, 16);

  return Buffer.concat([header, subtable]);
}

function encodeUtf16Be(str) {
  const buf = Buffer.alloc(str.length * 2);
  for (let i = 0; i < str.length; i += 1) {
    buf.writeUInt16BE(str.charCodeAt(i), i * 2);
  }
  return buf;
}

function buildNameTable() {
  const records = [
    { id: 1, value: "RayuCode Icons" },
    { id: 2, value: "Regular" },
    { id: 3, value: "RayuCodeIcons-2.0-Fox" },
    { id: 4, value: "RayuCode Icons" },
    { id: 5, value: "Version 2.0" },
    { id: 6, value: "RayuCodeIcons" },
  ];

  const encodedStrings = records.map((r) => ({
    id: r.id,
    buf: encodeUtf16Be(r.value),
  }));

  const headerSize = 6 + encodedStrings.length * 12;
  const stringBlob = Buffer.concat(encodedStrings.map((s) => s.buf));
  const table = Buffer.alloc(headerSize + stringBlob.length);

  table.writeUInt16BE(0, 0);
  table.writeUInt16BE(encodedStrings.length, 2);
  table.writeUInt16BE(headerSize, 4);

  let recOff = 6;
  let strOff = 0;
  for (const item of encodedStrings) {
    table.writeUInt16BE(3, recOff);
    table.writeUInt16BE(1, recOff + 2);
    table.writeUInt16BE(0x0409, recOff + 4);
    table.writeUInt16BE(item.id, recOff + 6);
    table.writeUInt16BE(item.buf.length, recOff + 8);
    table.writeUInt16BE(strOff, recOff + 10);
    recOff += 12;
    strOff += item.buf.length;
  }
  stringBlob.copy(table, headerSize);
  return table;
}

export function buildRayuIconTtf() {
  const contours = buildRayuFoxContours();
  const iconGlyph = encodeSimpleGlyph(contours);
  const { xMin, yMin, xMax, yMax } = iconGlyph.bbox;

  const glyf = iconGlyph.buf;
  const loca = Buffer.alloc(3 * 4);
  loca.writeUInt32BE(0, 0);
  loca.writeUInt32BE(0, 4);
  loca.writeUInt32BE(glyf.length, 8);

  const head = Buffer.alloc(54);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt32BE(0x00020000, 4);
  head.writeUInt32BE(0, 8);
  head.writeUInt32BE(0x5f0f3cf5, 12);
  head.writeUInt16BE(0x000b, 16);
  head.writeUInt16BE(UPM, 18);
  head.writeInt16BE(xMin, 36);
  head.writeInt16BE(yMin, 38);
  head.writeInt16BE(xMax, 40);
  head.writeInt16BE(yMax, 42);
  head.writeUInt16BE(0, 44);
  head.writeUInt16BE(8, 46);
  head.writeInt16BE(2, 48);
  head.writeInt16BE(1, 50);
  head.writeInt16BE(0, 52);

  const hhea = Buffer.alloc(36);
  hhea.writeUInt32BE(0x00010000, 0);
  hhea.writeInt16BE(ASCENDER, 4);
  hhea.writeInt16BE(DESCENDER, 6);
  hhea.writeInt16BE(0, 8);
  hhea.writeUInt16BE(UPM, 10);
  hhea.writeInt16BE(Math.min(0, xMin), 12);
  hhea.writeInt16BE(Math.min(0, UPM - xMax), 14);
  hhea.writeInt16BE(xMax, 16);
  hhea.writeInt16BE(1, 18);
  hhea.writeInt16BE(0, 20);
  hhea.writeInt16BE(0, 22);
  hhea.writeInt16BE(0, 32);
  hhea.writeUInt16BE(2, 34);

  const hmtx = Buffer.alloc(8);
  hmtx.writeUInt16BE(UPM, 0);
  hmtx.writeInt16BE(0, 2);
  hmtx.writeUInt16BE(UPM, 4);
  hmtx.writeInt16BE(xMin, 6);

  const maxp = Buffer.alloc(32);
  maxp.writeUInt32BE(0x00010000, 0);
  maxp.writeUInt16BE(2, 4);
  maxp.writeUInt16BE(iconGlyph.pointCount, 6);
  maxp.writeUInt16BE(iconGlyph.contourCount, 8);
  maxp.writeUInt16BE(0, 10);
  maxp.writeUInt16BE(0, 12);
  maxp.writeUInt16BE(2, 14);

  const os2 = Buffer.alloc(96);
  os2.writeUInt16BE(4, 0);
  os2.writeInt16BE(UPM, 2);
  os2.writeUInt16BE(400, 4);
  os2.writeUInt16BE(5, 6);
  os2.writeUInt16BE(0, 8);
  os2.writeInt16BE(650, 10);
  os2.writeInt16BE(600, 12);
  os2.writeInt16BE(0, 14);
  os2.writeInt16BE(75, 16);
  os2.writeInt16BE(650, 18);
  os2.writeInt16BE(600, 20);
  os2.writeInt16BE(0, 22);
  os2.writeInt16BE(350, 24);
  os2.writeInt16BE(50, 26);
  os2.writeInt16BE(300, 28);
  os2.writeInt16BE(0, 30);
  os2.write("RAYU", 58, 4, "ascii");
  os2.writeUInt16BE(0x0040, 62);
  os2.writeUInt16BE(RAYU_ICON_CODEPOINT, 64);
  os2.writeUInt16BE(RAYU_ICON_CODEPOINT, 66);
  os2.writeInt16BE(ASCENDER, 68);
  os2.writeInt16BE(DESCENDER, 70);
  os2.writeInt16BE(0, 72);
  os2.writeUInt16BE(ASCENDER, 74);
  os2.writeUInt16BE(Math.abs(DESCENDER), 76);
  os2.writeUInt32BE(1, 78);
  os2.writeUInt32BE(0, 82);
  os2.writeInt16BE(500, 86);
  os2.writeInt16BE(700, 88);
  os2.writeUInt16BE(0, 90);
  os2.writeUInt16BE(0x0020, 92);
  os2.writeUInt16BE(0, 94);

  const post = Buffer.alloc(32);
  post.writeUInt32BE(0x00030000, 0);
  post.writeInt16BE(-100, 8);
  post.writeInt16BE(50, 10);

  const cmap = buildCmapTable(RAYU_ICON_CODEPOINT, 1);
  const name = buildNameTable();

  const tables = [
    { tag: "OS/2", data: os2 },
    { tag: "cmap", data: cmap },
    { tag: "glyf", data: glyf },
    { tag: "head", data: head },
    { tag: "hhea", data: hhea },
    { tag: "hmtx", data: hmtx },
    { tag: "loca", data: loca },
    { tag: "maxp", data: maxp },
    { tag: "name", data: name },
    { tag: "post", data: post },
  ].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const numTables = tables.length;
  const maxPow2 = 1 << Math.floor(Math.log2(numTables));
  const searchRange = maxPow2 * 16;
  const entrySelector = Math.floor(Math.log2(numTables));
  const rangeShift = numTables * 16 - searchRange;

  const sfntHeader = Buffer.alloc(12 + numTables * 16);
  sfntHeader.writeUInt32BE(0x00010000, 0);
  sfntHeader.writeUInt16BE(numTables, 4);
  sfntHeader.writeUInt16BE(searchRange, 6);
  sfntHeader.writeUInt16BE(entrySelector, 8);
  sfntHeader.writeUInt16BE(rangeShift, 10);

  let offset = sfntHeader.length;
  let headOffset = 0;
  const paddedBlocks = [];

  for (let i = 0; i < tables.length; i += 1) {
    const t = tables[i];
    const padded = pad4(t.data);
    const checksum = calcTableChecksum(t.data);
    const recOff = 12 + i * 16;
    sfntHeader.write(t.tag, recOff, 4, "ascii");
    sfntHeader.writeUInt32BE(checksum, recOff + 4);
    sfntHeader.writeUInt32BE(offset, recOff + 8);
    sfntHeader.writeUInt32BE(t.data.length, recOff + 12);
    if (t.tag === "head") headOffset = offset;
    paddedBlocks.push(padded);
    offset += padded.length;
  }

  const fullTtf = Buffer.concat([sfntHeader, ...paddedBlocks]);
  const wholeSum = calcTableChecksum(fullTtf);
  const checkSumAdjustment = (0xb1b0afba - wholeSum) >>> 0;
  fullTtf.writeUInt32BE(checkSumAdjustment, headOffset + 8);

  return {
    ttf: fullTtf,
    tables: tables.map((t) => ({
      tag: t.tag,
      data:
        t.tag === "head"
          ? fullTtf.subarray(headOffset, headOffset + t.data.length)
          : t.data,
    })),
  };
}

export function buildRayuIconWoff() {
  const { ttf, tables } = buildRayuIconTtf();
  const numTables = tables.length;
  const headerSize = 44;
  const dirSize = numTables * 20;

  let offset = headerSize + dirSize;
  const dir = Buffer.alloc(dirSize);
  const chunks = [];

  for (let i = 0; i < numTables; i += 1) {
    const { tag, data } = tables[i];
    const compressed = deflateSync(data, { level: 9 });
    const useCompressed = compressed.length < data.length;
    const payload = useCompressed ? compressed : data;
    const paddedPayload = pad4(payload);
    const checksum = calcTableChecksum(data);

    const recOff = i * 20;
    dir.write(tag, recOff, 4, "ascii");
    dir.writeUInt32BE(offset, recOff + 4);
    dir.writeUInt32BE(payload.length, recOff + 8);
    dir.writeUInt32BE(data.length, recOff + 12);
    dir.writeUInt32BE(checksum, recOff + 16);

    chunks.push(paddedPayload);
    offset += paddedPayload.length;
  }

  const woffHeader = Buffer.alloc(headerSize);
  woffHeader.writeUInt32BE(0x774f4646, 0); // 'wOFF'
  woffHeader.writeUInt32BE(0x00010000, 4); // TrueType flavor
  woffHeader.writeUInt32BE(offset, 8);
  woffHeader.writeUInt16BE(numTables, 12);
  woffHeader.writeUInt16BE(0, 14);
  woffHeader.writeUInt32BE(ttf.length, 16);
  woffHeader.writeUInt16BE(1, 20);
  woffHeader.writeUInt16BE(0, 22);

  return Buffer.concat([woffHeader, dir, ...chunks]);
}

export async function generateIconAssets(outDir) {
  await mkdir(outDir, { recursive: true });
  const woff = buildRayuIconWoff();

  await writeFile(path.join(outDir, "rayucode-icons.woff"), woff);

  return {
    woffBytes: woff.length,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const targetDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : fileURLToPath(new URL("../dist/extension/media", import.meta.url));
  const summary = await generateIconAssets(targetDir);
  console.log(
    `Generated RayuCode Fox icon font in ${targetDir}: rayucode-icons.woff (${summary.woffBytes} B)`,
  );
}
