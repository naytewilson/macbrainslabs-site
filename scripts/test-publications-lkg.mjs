#!/usr/bin/env node
// Adversarial unit tests for the publications last-known-good decision rule
// (the exact defect class fixed after review of cf1904839fff10c97ba6854908314307c29a5918):
//   - ANY previously verified -> degraded transition over unchanged data must
//     hold the whole update (regardless of other unchanged releases);
//   - a transient re-derivation failure (e.g. Zenodo fetch, fingerprint
//     target flake) must be indistinguishable from "data changed" and must
//     hold, not publish;
//   - new records that are not fully verified must be held;
//   - genuine data changes and improvements publish.
// Dependency-free; run: node scripts/test-publications-lkg.mjs
import assert from 'node:assert/strict';
import { coreKey, lastKnownGoodDecision } from './update-publications.mjs';

const S1 = '1111111111111111111111111111111111111111111111111111111111111111';
const S2 = '2222222222222222222222222222222222222222222222222222222222222222';
const S3 = '3333333333333333333333333333333333333333333333333333333333333333';
const S4 = '4444444444444444444444444444444444444444444444444444444444444444';

function rec(tag, { state = 'verified', crosscheck = 'pass', fingerprint = 'match', sumsVerified = true, shaOk = true, core = {} } = {}) {
  return {
    tag,
    release_name: `Archive ${tag} — public measurement summaries`,
    published_at: '2026-10-30T08:17:50Z',
    release_url: `https://github.com/macbrainslabs/ane-research-records/releases/tag/${tag}`,
    record_class: 'source-bound curated summary, not raw results',
    zenodo_title: 'MacBrains Labs ANE Research Records, 2026: Public Measurement Summaries',
    record_repository: 'https://github.com/macbrainslabs/ane-research-records',
    provenance: {
      site_repository: 'https://github.com/naytewilson/macbrainslabs-site',
      site_commit: '27ac1941b26e865b1894a715946e2db7bcf7ed8b',
      source_pages: [{
        path: 'methods/index.html',
        url: 'https://macbrainslabs.org/methods/',
        sha256: S1,
        fingerprint_check: fingerprint
      }]
    },
    doi: {
      version_doi: '10.5281/zenodo.23798037',
      concept_doi: '10.5281/zenodo.23798036',
      zenodo_record_url: 'https://zenodo.org/records/23798037',
      tagged_manifest_doi_status: 'not issued; Zenodo authorization and deposit still required',
      binding_source: 'citation file at main',
      registered_state: { pass: 'registered_verified', unreachable: 'unverifiable_now', mismatch: 'mismatch_detected' }[crosscheck],
      crosscheck: { state: crosscheck, comparisons: crosscheck === 'pass' ? { version_doi: 'match' } : null, detail: null }
    },
    assets: [{
      name: `ane-research-records-${tag}.tar.gz`,
      url: `https://github.com/macbrainslabs/ane-research-records/releases/download/${tag}/ane-research-records-${tag}.tar.gz`,
      size: 13284,
      digest: `sha256:${S2}`,
      sha256: shaOk ? S2 : null
    }],
    sha256_sums: { verified: sumsVerified },
    evidence_limits: core.evidenceLimitsOverride ?? [
      'MLComputePlan ANE assignment is compiler placement and is not direct ANE hardware tracing'
    ],
    verification: { state, guards: [{ name: 'published release tag', state: state === 'verified' ? 'pass' : 'degraded' }] }
  };
}

let ran = 0;
function t(name, fn) {
  ran++;
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

const A = 'v0.1.0';
const B = 'v0.1.1';

t('identical single verified record -> no_change (no churn)', () => {
  const out = lastKnownGoodDecision([rec(A)], [rec(A)]);
  assert.equal(out.decision, 'no_change');
});

t('identical multi-record verified feed -> no_change', () => {
  const out = lastKnownGoodDecision([rec(B), rec(A)], [rec(B), rec(A)]);
  assert.equal(out.decision, 'no_change');
});

t('transient Zenodo failure on a verified record (same core) -> hold, not publish', () => {
  const prev = rec(A);
  const next = rec(A, { state: 'degraded', crosscheck: 'unreachable', shaOk: false, sumsVerified: false });
  // The reviewer's defect: comparing rec.doi JSON made a verification-only
  // change look like a data change and published the degraded state.
  assert.equal(coreKey(next), coreKey(prev), 'crosscheck state must not be part of the data core');
  const out = lastKnownGoodDecision([prev], [next]);
  assert.equal(out.decision, 'hold');
  assert.ok(out.reasons.some(r => r.includes(A) && r.includes('fail closed')), out.reasons.join('; '));
});

t('two records: one verified stays, one verified -> degraded (same core) -> hold (any-transition rule)', () => {
  const out = lastKnownGoodDecision([rec(B), rec(A)], [rec(B), rec(A, { state: 'degraded', crosscheck: 'unreachable' })]);
  assert.equal(out.decision, 'hold');
  assert.ok(out.reasons.some(r => r.includes(A)), out.reasons.join('; '));
});

t('fingerprint flake (core identical, fingerprint flag differs) -> hold', () => {
  const out = lastKnownGoodDecision([rec(A)], [rec(A, { state: 'degraded', fingerprint: 'mismatch' })]);
  assert.equal(out.decision, 'hold');
});

t('upstream data genuinely changed (evidence limits edited) while degraded -> hold (data change never lowers the verification bar)', () => {
  const next = rec(A, { state: 'degraded', crosscheck: 'unreachable', core: { evidenceLimitsOverride: ['An upstream edit legitimately changed the limits list.'] } });
  const out = lastKnownGoodDecision([rec(A)], [next]);
  assert.equal(out.decision, 'hold');
  assert.ok(out.reasons.some(r => r.includes(A) && r.includes('fail closed')), out.reasons.join('; '));
});

t('changed core where EVERY record still independently verifies -> publish', () => {
  const next = rec(A, { core: { evidenceLimitsOverride: ['An upstream edit legitimately changed the limits list.'] } });
  assert.notEqual(coreKey(next), coreKey(rec(A)), 'the core must actually differ');
  const out = lastKnownGoodDecision([rec(A)], [next]);
  assert.equal(out.decision, 'publish');
});

t('multi-record: upstream changed for one record while another re-derives degraded -> hold whole update', () => {
  const changedVerified = rec(B, { core: { evidenceLimitsOverride: ['Upstream edit that still verifies cleanly.'] } });
  const out = lastKnownGoodDecision([rec(B), rec(A)], [changedVerified, rec(A, { state: 'degraded', crosscheck: 'unreachable' })]);
  assert.equal(out.decision, 'hold');
  assert.ok(out.reasons.some(r => r.includes(A) && r.includes('fail closed')), out.reasons.join('; '));
});

t('new fully verified record -> publish', () => {
  const out = lastKnownGoodDecision([rec(A)], [rec(B), rec(A)]);
  assert.equal(out.decision, 'publish');
});

t('new degraded record -> hold the whole update (no auto-publication of unverified entries)', () => {
  const newBad = rec(B, { state: 'degraded', crosscheck: 'unreachable' });
  const out = lastKnownGoodDecision([rec(A)], [newBad, rec(A)]);
  assert.equal(out.decision, 'hold');
  assert.ok(out.reasons.some(r => r.includes(B) && r.includes('holding the update')), out.reasons.join('; '));
});

t('mixed feed: existing verified + new degraded -> hold whole update', () => {
  const out = lastKnownGoodDecision([rec(A)], [rec(A), rec(B, { state: 'degraded', crosscheck: 'unreachable' })]);
  assert.equal(out.decision, 'hold');
});

t('record vanished upstream -> hold (removal needs human review)', () => {
  const out = lastKnownGoodDecision([rec(B), rec(A)], [rec(A)]);
  assert.equal(out.decision, 'hold');
  assert.ok(out.reasons.some(r => r.includes('vanished')), out.reasons.join('; '));
});

t('previously degraded record re-verifies (same core) -> publish the improvement', () => {
  const prev = rec(A, { state: 'degraded', crosscheck: 'unreachable', shaOk: false, sumsVerified: false });
  const next = rec(A);
  const out = lastKnownGoodDecision([prev], [next]);
  assert.equal(out.decision, 'publish');
});

t('empty prev (first publication of verified records) -> publish', () => {
  const out = lastKnownGoodDecision([], [rec(A)]);
  assert.equal(out.decision, 'publish');
});

console.log(`last-known-good rule tests: ${ran - (process.exitCode ? 1 : 0)}/${ran} passed`);
