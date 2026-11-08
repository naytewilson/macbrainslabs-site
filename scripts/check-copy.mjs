#!/usr/bin/env node
// Copy gate: fails when visible site prose uses wording from scripts/slop-wording.json marked "block".
// "warn" entries are reported but do not fail. Code, tool output, scripts, styles, JSON-LD and
// metadata are not prose and are skipped. Archival publication records are rendered verbatim from
// verified upstream release metadata (scripts/update-publications.mjs) and are skipped here too.
// Usage: node scripts/check-copy.mjs [--json] [--warn]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = JSON.parse(fs.readFileSync(path.join(root, 'scripts/slop-wording.json'), 'utf8'));
const showWarn = process.argv.includes('--warn');
const asJson = process.argv.includes('--json');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'tests', '.taste-skill', 'assets']);
const SKIP_FILES = new Set(['publications/index.html']);
const SKIP_PREFIX = ['research/records/'];

export function visibleProse(html) {
  return html
    .replace(/<!-- publications-latest:start -->[\s\S]*?<!-- publications-latest:end -->/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[\s\S]*?<\/head>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<pre[\s\S]*?<\/pre>/g, ' ')
    .replace(/<code[\s\S]*?<\/code>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<(?:p|li|h[1-6]|dt|dd|td|th|figcaption|summary|blockquote|div|section|article|header|footer|nav|main|aside)\b[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ');
}

// Template literals in generators hold page prose; extract the string parts only.
function generatorProse(src) {
  const parts = [...src.matchAll(/`([^`]*)`/g)].map(m => m[1]).filter(s => /<(?:p|h[1-6]|li|dd|figcaption|a)\b/.test(s));
  return visibleProse(parts.join('\n').replace(/\$\{[^}]*\}/g, ' '));
}

function* files(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* files(path.join(dir, e.name), r); }
    else if (e.name.endsWith('.html') && !SKIP_FILES.has(r) && !SKIP_PREFIX.some(p => r.startsWith(p))) yield r;
  }
}

const rules = db.entries.map(e => {
  const source = e.is_regex ? e.pattern : e.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bounded = e.is_regex || !/^\w/.test(source) ? source : `\\b${source}${/\w$/.test(e.pattern) ? '\\b' : ''}`;
  return { ...e, re: new RegExp(bounded, 'giu') };
});

const targets = [...files(root)].map(r => ({ r, text: visibleProse(fs.readFileSync(path.join(root, r), 'utf8')) }));
for (const g of ['scripts/build-public-experience.mjs']) {
  if (fs.existsSync(path.join(root, g))) targets.push({ r: g, text: generatorProse(fs.readFileSync(path.join(root, g), 'utf8')) });
}

const hits = [];
for (const { r, text } of targets) {
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const at = m.index ?? 0;
      const ctx = text.slice(Math.max(0, at - 50), at + m[0].length + 50).replace(/\s+/g, ' ').trim();
      hits.push({ file: r, id: rule.id, severity: rule.severity, match: m[0], context: ctx });
    }
  }
}

const blocks = hits.filter(h => h.severity === 'block');
const warns = hits.filter(h => h.severity !== 'block');
if (asJson) console.log(JSON.stringify({ blocks, warns }, null, 2));
else {
  for (const h of blocks) console.log(`BLOCK ${h.file} [${h.id}] "${h.match}" … ${h.context}`);
  if (showWarn) for (const h of warns) console.log(`warn  ${h.file} [${h.id}] "${h.match}" … ${h.context}`);
  console.log(`Copy gate: ${rules.length} patterns over ${targets.length} sources; ${blocks.length} blocking, ${warns.length} warnings${showWarn ? '' : ' (show with --warn)'}`);
}
assert.equal(blocks.length, 0, `${blocks.length} blocked phrase(s) in site copy`);
