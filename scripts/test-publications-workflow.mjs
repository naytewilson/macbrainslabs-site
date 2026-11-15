#!/usr/bin/env node
// The publications workflow may open a pull request. It must not push main.
// Dependency-free; run: node scripts/test-publications-workflow.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.github/workflows/publications.yml');
const text = fs.readFileSync(file, 'utf8');
const pushes = text.split('\n').filter(line => /^\s*git push\b/.test(line));

assert.equal(pushes.length, 1, `expected one git push, found: ${JSON.stringify(pushes)}`);
assert.match(pushes[0], /git push origin "HEAD:refs\/heads\/\$\{branch\}"$/);
assert.equal(/^\s*git push\s*$/m.test(text), false);
assert.match(text, /gh pr create --base main --head "\$branch"/);
assert.match(text, /^ {2}pull-requests: write$/m);
assert.match(text, /^ {2}contents: write$/m);
assert.equal(text.includes('git push origin main'), false);
assert.equal(text.includes('git push origin HEAD'), false);

console.log('publications workflow opens a pull request and does not push main');
