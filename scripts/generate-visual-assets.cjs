#!/usr/bin/env node
// Dev-only asset generation. Site runtime stays dependency-free.
// Requires "sharp" in the Node resolution path (npm install --no-save sharp).
// --card-only regenerates assets/social-card.* and leaves the icons untouched.
const fs = require('node:fs');
const path = require('node:path');
let sharp;
try { sharp = require('sharp'); } catch {
  console.error('Install dev-only sharp (npm install --no-save sharp) before regenerating icons.');
  process.exit(2);
}
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
const source = fs.readFileSync(path.join(root, 'favicon.svg'), 'utf8');
if (!source.includes('viewBox="0 0 512 512"') || !source.includes('#FF4A27')) {
  throw new Error('Expected the approved centered MacBrains SVG master');
}
const fill = source.replace('rx="96"', 'rx="0"');
const logoInside = source.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/s, '');
const mkdir = (name) => fs.mkdirSync(path.dirname(name), { recursive: true });

function ico(pngs) {
  const count = pngs.length;
  const entries = Buffer.alloc(6 + count * 16);
  entries.writeUInt16LE(0, 0);
  entries.writeUInt16LE(1, 2);
  entries.writeUInt16LE(count, 4);
  let offset = entries.length;
  pngs.forEach(({ size, content }, i) => {
    const base = 6 + 16 * i;
    entries[base] = size === 256 ? 0 : size;
    entries[base + 1] = size === 256 ? 0 : size;
    entries[base + 2] = entries[base + 3] = 0;
    entries.writeUInt16LE(1, base + 4);
    entries.writeUInt16LE(32, base + 6);
    entries.writeUInt32LE(content.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    offset += content.length;
  });
  return Buffer.concat([entries, ...pngs.map(p => p.content)]);
}

const cardOnly = process.argv.includes('--card-only');

async function run() {
  if (!cardOnly) await icons();
  await socialCard();
}

async function icons() {
  const small = [];
  for (const size of [16, 32, 48, 192, 512]) {
    const sourceSvg = size >= 192 ? fill : source;
    const content = await sharp(Buffer.from(sourceSvg))
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer();
    const file = path.join(assets, `icon-${size}.png`);
    mkdir(file);
    fs.writeFileSync(file, content);
    if (size <= 48) small.push({ size, content });
    console.log(`icon-${size}.png ${content.length} bytes`);
  }
  const fav = ico(small);
  fs.writeFileSync(path.join(root, 'favicon.ico'), fav);
  console.log(`favicon.ico ${fav.length} bytes`);
}

async function socialCard() {
  // Social sharing card mirrors the actual dark homepage and approved MB mark.
  const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <pattern id="p" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1" fill="#445046" opacity=".40"/></pattern>
    </defs>
    <rect width="1200" height="630" fill="#0d0f0f"/>
    <rect x="720" y="0" width="480" height="630" fill="#101513"/>
    <rect x="730" y="0" width="470" height="630" fill="url(#p)"/>
    <path d="M54 145 H1150" stroke="#343b34" stroke-width="2"/>
    <path d="M54 555 H1150" stroke="#343b34" stroke-width="2"/>
    <g transform="translate(52 42) scale(.156)">${logoInside}</g>
    <text x="150" y="103" font-family="Arial,Helvetica,sans-serif" font-weight="600" font-size="31" fill="#efede5">MacBrains<tspan fill="#c7cac2" font-weight="400"> Labs</tspan></text>
    <text x="54" y="300" font-family="Arial,Helvetica,sans-serif" font-weight="600" font-size="76" letter-spacing="-3.4" fill="#efede5">Where did it</text>
    <text x="54" y="380" font-family="Arial,Helvetica,sans-serif" font-weight="600" font-size="76" letter-spacing="-3.4" fill="#efede5">really run?</text>
    <text x="56" y="456" font-family="Arial,Helvetica,sans-serif" font-size="25" fill="#dedfd8">I build language models for the Neural Engine</text>
    <text x="56" y="492" font-family="Arial,Helvetica,sans-serif" font-size="25" fill="#dedfd8">and write down what actually happened.</text>
    <text x="56" y="596" font-family="Arial,Helvetica,sans-serif" font-size="17" fill="#b7bdb2">macbrainslabs.org</text>
    <rect x="764" y="177" width="371" height="352" rx="14" stroke="#435044" fill="#131a16" stroke-width="2"/>
    <path d="M782 198H1117 M782 507H1117" stroke="#3c493e" stroke-width="2" stroke-dasharray="4 8"/>
    <g transform="translate(808 212) scale(.545)">${logoInside}</g>
    <text x="764" y="596" font-family="Arial,Helvetica,sans-serif" font-size="17" fill="#b7bdb2">Nayte Wilson · not affiliated with Apple</text>
  </svg>`;
  fs.writeFileSync(path.join(assets, 'social-card.svg'), card);
  const png = await sharp(Buffer.from(card)).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(assets, 'social-card.png'), png);
  const { width, height } = await sharp(png).metadata();
  if (width !== 1200 || height !== 630) throw new Error('Social card size mismatch');
  console.log(`social-card.png ${width}x${height} ${png.length} bytes`);
}
run().catch(e => { console.error(e); process.exitCode = 1; });
