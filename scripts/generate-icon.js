/**
 * Generates icon.png (128x128) for the extension. No external deps; uses Node fs + zlib.
 * Design: AI/code explanation — teal shape with dark outline, code-bracket symbol, works on light/dark.
 */
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const W = 128;
const H = 128;

// Colors [R, G, B, A] — teal fill, dark outline, light symbol so it reads on both themes
const TEAL = [13, 148, 136, 255]; // #0d9488
const DARK = [30, 41, 59, 255]; // #1e293b
const LIGHT = [248, 250, 252, 255]; // #f8fafc
const TRANS = [0, 0, 0, 0];

function setPixel(data, x, y, color) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  data[i] = color[0];
  data[i + 1] = color[1];
  data[i + 2] = color[2];
  data[i + 3] = color[3];
}

function dist(x, y, cx, cy) {
  return Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
}

// True if (x,y) is inside rounded rect centered at (cx,cy) with size (w,h) and corner radius r
function inRoundedRect(x, y, cx, cy, w, h, r) {
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  if (x < left || x > right || y < top || y > bottom) return false;
  if (r <= 0) return true;
  const topLeft = dist(x, y, left + r, top + r) <= r;
  const topRight = dist(x, y, right - r, top + r) <= r;
  const bottomRight = dist(x, y, right - r, bottom - r) <= r;
  const bottomLeft = dist(x, y, left + r, bottom - r) <= r;
  if (x <= left + r && y <= top + r) return topLeft;
  if (x >= right - r && y <= top + r) return topRight;
  if (x >= right - r && y >= bottom - r) return bottomRight;
  if (x <= left + r && y >= bottom - r) return bottomLeft;
  return true;
}

// True if (x,y) is in the stroke ring: outer rounded rect minus inner
function inRoundedRectRing(x, y, cx, cy, w, h, r, strokeWidth) {
  const outer = inRoundedRect(
    x,
    y,
    cx,
    cy,
    w + strokeWidth * 2,
    h + strokeWidth * 2,
    r + strokeWidth
  );
  const inner = inRoundedRect(
    x,
    y,
    cx,
    cy,
    w - strokeWidth * 2,
    h - strokeWidth * 2,
    Math.max(0, r - strokeWidth)
  );
  return outer && !inner;
}

// Line from (x0,y0) to (x1,y1), thickness t
function setLine(data, x0, y0, x1, y1, color, t) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const steps = Math.ceil(len) + 1;
  const perpX = -dy / len;
  const perpY = dx / len;
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const px = Math.round(x0 + u * dx);
    const py = Math.round(y0 + u * dy);
    for (let d = -t; d <= t; d++) {
      setPixel(data, px + perpX * d, py + perpY * d, color);
    }
  }
}

// Draw "</>" code brackets: center at (cx, cy), scale, line thickness
function drawCodeSymbol(data, cx, cy, scale, thickness) {
  const l = 18 * scale;
  const h = 24 * scale;
  // "</" left part
  setLine(data, cx - l, cy - h / 2, cx - l * 0.3, cy, LIGHT, thickness);
  setLine(data, cx - l * 0.3, cy, cx - l, cy + h / 2, LIGHT, thickness);
  // ">" right part
  setLine(data, cx + l * 0.3, cy - h / 2, cx + l, cy, LIGHT, thickness);
  setLine(data, cx + l, cy, cx + l * 0.3, cy + h / 2, LIGHT, thickness);
}

function main() {
  const rgba = new Uint8Array(W * H * 4);
  const cx = W / 2;
  const cy = H / 2;
  const boxW = 88;
  const boxH = 88;
  const radius = 20;
  const stroke = 5;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inFill = inRoundedRect(x, y, cx, cy, boxW, boxH, radius);
      const inRing = inRoundedRectRing(
        x,
        y,
        cx,
        cy,
        boxW,
        boxH,
        radius,
        stroke
      );
      if (inFill) {
        setPixel(rgba, x, y, TEAL);
      } else if (inRing) {
        setPixel(rgba, x, y, DARK);
      } else {
        setPixel(rgba, x, y, TRANS);
      }
    }
  }

  drawCodeSymbol(rgba, cx, cy, 1.2, 4);

  // PNG: filter byte 0 per row, then RGBA
  const rowSize = 1 + W * 4;
  const raw = Buffer.alloc(rowSize * H);
  for (let y = 0; y < H; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < W; x++) {
      const src = (y * W + x) * 4;
      const dst = y * rowSize + 1 + x * 4;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      raw[dst + 3] = rgba[src + 3];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let t = i;
      for (let k = 0; k < 8; k++) t = t & 1 ? 0xedb88320 ^ (t >>> 1) : t >>> 1;
      table[i] = t >>> 0;
    }
    for (let i = 0; i < buf.length; i++)
      c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const writeU32 = (n) =>
    Buffer.from([
      (n >> 24) & 0xff,
      (n >> 16) & 0xff,
      (n >> 8) & 0xff,
      n & 0xff,
    ]);
  const chunk = (type, data) => {
    const len = writeU32(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = writeU32(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const png = Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const outPath = path.join(__dirname, "..", "icon.png");
  fs.writeFileSync(outPath, png);
  console.log("Written", outPath);
}

main();
