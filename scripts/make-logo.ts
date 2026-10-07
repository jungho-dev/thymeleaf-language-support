/**
 * @file make-logo.ts
 * @description 128x128 PNG 로고 생성 (잎 모양, 외부 의존성 없음)
 * @author Jungho
 * @since 2026-10-07
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const SIZE = 128;
const BACKGROUND = [0x1b, 0x1f, 0x27, 0xff];
const LEAF = [0x63, 0xec, 0x63, 0xff];
const VEIN = [0x1b, 0x1f, 0x27, 0xff];
const OUTPUT = path.resolve(import.meta.dir, `..`, `logo.png`);

// 1. CRC32 ---------------------------------------------------------------------------------
const CRC_TABLE = Array.from({ "length": 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// 2. PNG 청크 -------------------------------------------------------------------------------
const buildChunk = (type: string, body: Uint8Array): Buffer => {
  const typeBytes = Buffer.from(type, `ascii`);
  const lengthBytes = Buffer.alloc(4);
  lengthBytes.writeUInt32BE(body.length, 0);
  const crcBytes = Buffer.alloc(4);
  crcBytes.writeUInt32BE(crc32(Buffer.concat([typeBytes, body])), 0);
  return Buffer.concat([lengthBytes, typeBytes, body, crcBytes]);
};

// 3. 픽셀 렌더링 (회전 타원 잎 + 중앙 잎맥) -------------------------------------------------------
const isInsideLeaf = (x: number, y: number): boolean => {
  const cx = x - SIZE / 2;
  const cy = y - SIZE / 2;
  const angle = -Math.PI / 4;
  const rx = cx * Math.cos(angle) - cy * Math.sin(angle);
  const ry = cx * Math.sin(angle) + cy * Math.cos(angle);
  const ellipse = (rx * rx) / (50 * 50) + (ry * ry) / (26 * 26) <= 1;
  const tipCut = rx > 44 && Math.abs(ry) > (50 - rx) * 2;
  return ellipse && !tipCut;
};
const isOnVein = (x: number, y: number): boolean => {
  const cx = x - SIZE / 2;
  const cy = y - SIZE / 2;
  return Math.abs(cx + cy) <= 1.2 && Math.abs(cx - cy) <= 88;
};
const renderPixels = (): Buffer => {
  const rows: Buffer[] = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    row[0] = 0;
    for (let x = 0; x < SIZE; x++) {
      const inside = isInsideLeaf(x + 0.5, y + 0.5);
      const color = inside ? (isOnVein(x + 0.5, y + 0.5) ? VEIN : LEAF) : BACKGROUND;
      row.set(color, 1 + x * 4);
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
};

// 4. 파일 출력 -------------------------------------------------------------------------------
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;
header[9] = 6;
header[10] = 0;
header[11] = 0;
header[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  buildChunk(`IHDR`, header),
  buildChunk(`IDAT`, deflateSync(renderPixels())),
  buildChunk(`IEND`, new Uint8Array(0)),
]);
writeFileSync(OUTPUT, png);
console.log(`logo written: ${OUTPUT} (${png.length} bytes)`);
