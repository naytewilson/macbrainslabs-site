#!/usr/bin/env node
// The publications workflow may open a pull request. It must not push main.
// Dependency-free; run: node scripts/test-publications-workflow.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/publications.yml'), 'utf8');
const publisher = fs.readFileSync(path.join(root, 'scripts/publish-publications-pr.mjs'), 'utf8');

assert.equal(workflow.split('\n').some(line => /^\s*git push\b/.test(line)), false);
assert.equal(workflow.includes('git push origin main'), false);
assert.equal(workflow.includes('gh pr merge'), false);
assert.equal(workflow.includes('gh pr review'), false);
assert.match(workflow, /^ {2}contents: write$/m);
assert.match(workflow, /^ {2}pull-requests: write$/m);
assert.match(workflow, /^ {2}statuses: write$/m);
assert.match(workflow, /^concurrency:\n {2}group: publications-feed\n {2}cancel-in-progress: false$/m);
assert.equal(workflow.includes('node scripts/publish-publications-pr.mjs --commit-only'), true);
assert.equal(workflow.includes('node scripts/publish-publications-pr.mjs --push'), true);
assert.equal(workflow.includes('node scripts/publish-publications-pr.mjs --no-diff'), true);

const names = [...workflow.matchAll(/- name: (.+)/g)].map(match => match[1]);
const commitAt = names.indexOf('Commit the candidate locally without pushing');
const checkAt = names.indexOf('Verify the candidate with the site-check suite');
const pushAt = names.indexOf('Push the candidate and open or update the pull request');
assert.ok(commitAt !== -1 && checkAt !== -1 && pushAt !== -1, names.join(' | '));
assert.ok(commitAt < checkAt && checkAt < pushAt, 'the candidate is checked before it is pushed');
const pushStep = workflow.slice(workflow.indexOf('- name: Push the candidate'));
assert.equal(pushStep.includes('continue-on-error'), false);
assert.match(pushStep, /if: steps\.candidate\.outputs\.has_diff == 'true'/);

assert.equal(publisher.includes('refs/heads/main'), false);
assert.equal(publisher.includes('gh pr merge'), false);
assert.equal(publisher.includes('gh pr review'), false);
assert.match(publisher, /HEAD:refs\/heads\/\$\{branch\}/);
assert.match(publisher, /--force-with-lease=refs\/heads\/\$\{branch\}:\$\{remoteSha\}/);

console.log('publications workflow opens a pull request and does not push main');
