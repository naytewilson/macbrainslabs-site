// Zero-dependency PNG sanity checks for the approved MacBrains Labs brand mark.
// The earlier icon was a one-sided crop with cream-colored empty space, despite
// having valid PNG dimensions. Check the visible glyph bounds, not dimensions alone.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

function readRGBA(file) {
  const png = fs.readFileSync(file);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(png[24], 8, '8-bit icon required');
  const channels = png[25] === 6 ? 4 : png[25] === 2 ? 3 : 0;
  assert.ok(channels, 'RGB or RGBA icon required');
  const idat = [];
  for (let pos = 8; pos + 12 <= png.length;) {
    const n = png.readUInt32BE(pos);
    const tag = png.toString('ascii', pos + 4, pos + 8);
    if (tag === 'IDAT') idat.push(png.subarray(pos + 8, pos + 8 + n));
    pos += n + 12;
    if (tag === 'IEND') break;
  }
  assert.ok(idat.length, 'missing image data');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  assert.equal(raw.length, height * (stride + 1), 'invalid PNG scanlines');
  const pixels = Buffer.alloc(height * width * 4);
  let pos = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    assert.ok(filter >= 0 && filter <= 4, 'unsupported PNG row filter');
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      if (filter === 2) predictor = b;
      if (filter === 3) predictor = Math.floor((a + b) / 2);
      if (filter === 4) {
        const p = a + b - c;
        const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
        predictor = da <= db && da <= dc ? a : db <= dc ? b : c;
      }
      row[x] = (raw[pos++] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const si = x * channels, di = (y * width + x) * 4;
      pixels[di] = row[si]; pixels[di + 1] = row[si + 1]; pixels[di + 2] = row[si + 2];
      pixels[di + 3] = channels === 4 ? row[si + 3] : 255;
    }
    prev = row;
  }
  return { width, height, pixels };
}

function rgba(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [...img.pixels.subarray(i, i + 4)];
}

function glyphBounds(img) {
  let left = img.width, top = img.height, right = -1, bottom = -1, count = 0;
  let orange = false, white = false;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b, a] = rgba(img, x, y);
      if (a < 200) continue;
      if (r > 150 && g > 150 && b > 150) white = true;
      if (r > 170 && r > g + 50 && r > b + 70) orange = true;
      if (r < 150 && g < 150 && b < 150) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
    }
  }
  assert.ok(orange && white && count > img.width * img.height / 100, 'white MB and orange slash must remain visible');
  assert.ok(right > left && bottom > top, 'glyph bounds unavailable');
  return { left, right, top, bottom };
}

export function assertCenteredBrandIcons(root) {
  const svg = fs.readFileSync(path.join(root, 'favicon.svg'), 'utf8');
  assert.match(svg, /viewBox="0 0 512 512"/);
  assert.ok(svg.includes('#F3F1EA') && svg.includes('#FF4A27'), 'approved brand pigments missing');
  for (const [name, size] of [['apple-touch-icon.png', 180], ['assets/brand-mark-96.png', 96]]) {
    const img = readRGBA(path.join(root, name));
    assert.equal(img.width, size, name + ' width');
    assert.equal(img.height, size, name + ' height');
    const corner = rgba(img, 0, 0);
    if (size === 180) {
      assert.deepEqual(corner, [11, 11, 11, 255], 'iOS icon must be full-bleed black (no cream margin)');
    } else {
      assert.equal(corner[3], 0, 'browser icon must have a properly centered rounded box');
    }
    const { left, right, top, bottom } = glyphBounds(img);
    assert.ok(Math.abs(left - (size - 1 - right)) <= 3, name + ' glyph is horizontally off-center');
    assert.ok(Math.abs(top - (size - 1 - bottom)) <= 3, name + ' glyph is vertically off-center');
    const widthFraction = (right - left + 1) / size;
    assert.ok(widthFraction > 0.6 && widthFraction < 0.8, name + ' glyph should have balanced margins');
  }
}
