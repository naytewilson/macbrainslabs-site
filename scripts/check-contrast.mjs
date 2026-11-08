import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function luminance(hex) {
  const rgb = hex.replace('#','').match(/.{2}/g).map(x => parseInt(x,16) / 255);
  const linear = rgb.map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrastRatio(fg, bg) {
  const a=luminance(fg), b=luminance(bg);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}

// Source-reviewed pairs of regular-sized content against their actual solid
// backgrounds; 4.5:1 is the WCAG 2.2 AA minimum for normal text. This does not
// certify all possible overlays or states, which are checked separately in-browser.
const pairs=[
  ['home primary', 'home.css', '#efede5', '#0d0f0f'],
  ['home secondary', 'home.css', '#b7bdb2', '#0d0f0f'],
  ['home quiet note', 'home.css', '#9da696', '#0d0f0f'],
  ['home orange accent', 'home.css', '#ff633a', '#0d0f0f'],
  ['home method panel', 'home.css', '#b7bdb2', '#151a18'],
  ['research folio copy', 'home.css', '#4a5246', '#f4f5f4'],
  ['research folio topic', 'home.css', '#a9371b', '#f4f5f4'],
  ['research boundary copy', 'home.css', '#4a5246', '#eaebe5'],
  ['research paper copy', 'home.css', '#4a5246', '#e4e5df'],
  ['inner page light primary', 'styles.css', '#16191b', '#f3f4f1'],
  ['inner page light secondary', 'styles.css', '#3d4347', '#f3f4f1'],
  ['inner page light subdued', 'styles.css', '#565c60', '#f3f4f1'],
  ['inner page light secondary on surface', 'styles.css', '#3d4347', '#e9ebe6'],
  ['inner page light signal', 'styles.css', '#a9371b', '#f3f4f1'],
  ['inner page dark subdued', 'styles.css', '#9da696', '#0d0f0f'],
  ['inner page dark secondary', 'styles.css', '#b7bdb2', '#0d0f0f'],
  ['inner page dark secondary on surface', 'styles.css', '#b7bdb2', '#151a18'],
  ['inner page dark highlight', 'styles.css', '#ff8a5c', '#0d0f0f']
];

export function assertReviewedTextContrast(root) {
  const sheets = new Map();
  for(const [label, name, fg, bg] of pairs){
    if(!sheets.has(name)) sheets.set(name,fs.readFileSync(path.join(root,name),'utf8').toLowerCase());
    const css=sheets.get(name);
    assert.ok(css.includes(fg)&&css.includes(bg),label + ' colors changed: review pair and update audit');
    const ratio=contrastRatio(fg,bg);
    assert.ok(ratio>=4.5,label + ' has only '+ratio.toFixed(2)+':1 contrast, minimum 4.5:1');
  }
  return pairs.map(([label,,fg,bg])=>({label,ratio:Number(contrastRatio(fg,bg).toFixed(2))}));
}
