#!/usr/bin/env node
// Candidate DOI for the v0.1.0 baseline once CITATION.cff on main cites a later
// record: it must come from the records index baseline, and nothing else.
import assert from 'node:assert/strict';
import { citationCandidate } from './update-publications.mjs';

const cff = (version, doi) => `cff-version: 1.2.0\ntitle: "MacBrains Labs ANE Research Records"\nversion: "${version}"\ndoi: "${doi}"\ndate-released: "2026-11-03"\n`;
const index = baseline => JSON.stringify({ schema: 'macbrains.dataset.records-index.v1', conceptDoi: '10.5281/zenodo.23798036', baseline, records: [] });
const base = { version: 'v0.1.0', tag: 'v0.1.0', versionDoi: '10.5281/zenodo.23798037' };

let ran = 0, failed = 0;
function t(name, fn) {
  ran++;
  try { fn(); console.log(`PASS ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}

t('citation file citing this tag binds from the citation file', () => {
  assert.deepEqual(citationCandidate('v0.1.0', cff('0.1.0', '10.5281/zenodo.23798037'), null), { doi: '10.5281/zenodo.23798037', source: 'citation file at main' });
});
t('citation file citing a later version binds from the records index baseline', () => {
  assert.deepEqual(citationCandidate('v0.1.0', cff('0.2.0', '10.5281/zenodo.23905811'), index(base)), { doi: '10.5281/zenodo.23798037', source: 'records index at main' });
});
t('later citation with no records index refuses to bind', () => {
  assert.throws(() => citationCandidate('v0.1.0', cff('0.2.0', '10.5281/zenodo.23905811'), null), /does not correspond to this tag/);
});
t('records index baseline naming another tag refuses to bind', () => {
  assert.throws(() => citationCandidate('v0.1.0', cff('0.2.0', '10.5281/zenodo.23905811'), index({ ...base, tag: 'v0.1.1' })), /does not name this tag/);
  assert.throws(() => citationCandidate('v0.1.0', cff('0.2.0', '10.5281/zenodo.23905811'), index({ ...base, version: 'v0.1.1' })), /does not name this tag/);
});
t('missing or malformed baseline DOI, or a non-JSON index, refuses to bind', () => {
  assert.throws(() => citationCandidate('v0.1.0', cff('0.2.0', '10.5281/zenodo.23905811'), index({ version: 'v0.1.0', tag: 'v0.1.0' })), /does not name this tag/);
  assert.throws(() => citationCandidate('v0.1.0', cff('0.2.0', '10.5281/zenodo.23905811'), index({ ...base, versionDoi: 'doi:nope' })));
  assert.throws(() => citationCandidate('v0.1.0', cff('0.2.0', '10.5281/zenodo.23905811'), '{not json'), /not valid JSON/);
});

console.log(`legacy DOI binding tests: ${ran - failed}/${ran} passed`);
process.exit(failed ? 1 : 0);
