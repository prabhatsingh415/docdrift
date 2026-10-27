import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { check } from '../src/check.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures-framework');

test('framework endpoints are ignored by default', () => {
  const { report, exitCode } = check(fixtures);

  assert.equal(exitCode, 0);
  assert.match(
    report,
    /^Ignored 2 framework endpoint\(s\) documented but provided by libraries: GET \/actuator\/health, GET \/swagger-ui\/index\.html$/m,
  );
  assert.doesNotMatch(report, /^STALE /m);
  assert.match(report, /No drift found\./);
});

test('--strict reports framework endpoints as stale', () => {
  const { report, exitCode } = check(fixtures, fixtures, null, {
    strict: true,
  });

  assert.equal(exitCode, 1);
  assert.match(report, /^STALE \(documented, not in code\)$/m);
  assert.match(report, /GET\s+\/actuator\/health/);
  assert.match(report, /GET\s+\/swagger-ui\/index\.html/);
  assert.doesNotMatch(report, /Ignored \d+ framework endpoint/);
});

test('a documented duplicate counts once', () => {
  const { report } = check(fixtures);

  assert.match(
    report,
    /docdrift check: 1 code endpoints, 3 documented endpoints, 1 matched/,
  );
});

test('matched equals documented when the duplicate is already matched', () => {
  const { report, exitCode } = check(join(here, 'fixtures-duplicate'));

  assert.equal(exitCode, 0);
  assert.match(
    report,
    /docdrift check: 2 code endpoints, 2 documented endpoints, 2 matched/,
  );
});