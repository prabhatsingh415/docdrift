import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runEval } from '../evals/run.js';

const here = dirname(fileURLToPath(import.meta.url));

test('the evaluation runs on the Java fixtures and returns metrics', () => {
  const { rows, total } = runEval([join(here, 'fixtures')]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].repo, 'fixtures');
  assert.equal(rows[0].trials, 30);
  assert.equal(total.trials, 30);

  const values = [
    rows[0].stale.precision,
    rows[0].stale.recall,
    rows[0].undocumented.precision,
    rows[0].undocumented.recall,
    total.stale.precision,
    total.stale.recall,
    total.undocumented.precision,
    total.undocumented.recall,
  ];

  for (const value of values) {
    assert.ok(value === 'n/a' || typeof value === 'number');
  }
});

test('repositories with fewer than four endpoints are skipped', () => {
  const { rows, skipped } = runEval([join(here, 'fixtures-check')]);

  assert.equal(rows.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /need at least 4/);
});