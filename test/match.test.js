import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compare, normalizePath } from '../src/match.js';
import { check, formatEndpointList } from '../src/check.js';

const here = dirname(fileURLToPath(import.meta.url));

const endpoint = (method, path, file = 'code.java', line = 1) => ({
  method,
  path,
  file,
  line,
});

const doc = (method, path) => endpoint(method, path, 'README.md', 1);

test('path parameters {id}, :id and {userId} normalise to the same path', () => {
  assert.equal(normalizePath('/users/{id}'), '/users/{}');
  assert.equal(normalizePath('/users/:id'), '/users/{}');
  assert.equal(normalizePath('/users/{userId}'), '/users/{}');

  const result = compare(
    [endpoint('GET', '/users/{id}')],
    [doc('GET', '/users/:id')],
  );

  assert.equal(result.matched, 1);
  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.undocumented, []);
});

test('a trailing slash does not change the path', () => {
  assert.equal(normalizePath('/users/'), '/users');
  assert.equal(normalizePath('/'), '/');

  const result = compare([endpoint('GET', '/users/')], [doc('GET', '/users')]);

  assert.equal(result.matched, 1);
  assert.deepEqual(result.stale, []);
});

test('query strings are ignored when comparing', () => {
  assert.equal(normalizePath('/users?limit=10'), '/users');

  const result = compare(
    [endpoint('GET', '/users')],
    [doc('GET', '/users?limit=10')],
  );

  assert.equal(result.matched, 1);
  assert.deepEqual(result.undocumented, []);
});

test('a code ANY method matches any documented method', () => {
  const result = compare(
    [endpoint('ANY', '/users')],
    [doc('DELETE', '/users'), doc('PATCH', '/users')],
  );

  assert.equal(result.matched, 2);
  assert.deepEqual(result.stale, []);
  assert.deepEqual(result.undocumented, []);
});

test('a code method like GET|POST counts as one endpoint per method', () => {
  const code = [endpoint('GET|POST', '/users')];

  const both = compare(code, [doc('GET', '/users'), doc('POST', '/users')]);
  assert.equal(both.matched, 2);
  assert.deepEqual(both.undocumented, []);

  const onlyGet = compare(code, [doc('GET', '/users')]);
  assert.equal(onlyGet.matched, 1);
  assert.deepEqual(onlyGet.undocumented, []);

  const neither = compare(code, [doc('DELETE', '/users')]);
  assert.equal(neither.matched, 0);
  assert.deepEqual(neither.undocumented, code);
});

test('documented endpoints missing from the code are stale', () => {
  const result = compare(
    [endpoint('GET', '/users')],
    [doc('GET', '/users'), doc('GET', '/legacy')],
  );

  assert.equal(result.matched, 1);
  assert.deepEqual(
    result.stale.map(({ method, path }) => [method, path]),
    [['GET', '/legacy']],
  );
  assert.equal(result.stale[0].file, 'README.md');
  assert.equal(result.stale[0].line, 1);
});

test('code endpoints missing from the docs are undocumented', () => {
  const result = compare(
    [endpoint('GET', '/users'), endpoint('PUT', '/users/{id}')],
    [doc('GET', '/users')],
  );

  assert.equal(result.matched, 1);
  assert.deepEqual(
    result.undocumented.map(({ method, path }) => [method, path]),
    [['PUT', '/users/{id}']],
  );
  assert.equal(result.undocumented[0].file, 'code.java');
});

test('with zero documented endpoints nothing is reported as undocumented', () => {
  const codeDir = join(here, 'fixtures');
  const { report, exitCode, result } = check(codeDir);

  assert.equal(exitCode, 0);
  assert.deepEqual(result.stale, []);
  assert.match(
    report,
    /^No endpoints are documented in .*fixtures, nothing to compare \(\d+ endpoints found in code\)\.$/,
  );
});

test('check reports drift for the fixtures-check project', () => {
  const { report, exitCode } = check(join(here, 'fixtures-check'));

  assert.equal(exitCode, 1);
  assert.match(report, /^docdrift check: 3 code endpoints, 3 documented endpoints, 2 matched$/m);
  assert.match(report, /^STALE \(documented, not in code\)$/m);
  assert.match(report, /^ {2}GET {4}\/api\/legacy \(README\.md:7\)$/m);
  assert.match(report, /^UNDOCUMENTED \(in code, not documented\)$/m);
  assert.match(
    report,
    /^ {2}DELETE \/api\/users\/\{id\} \(UserController\.java:15\)$/m,
  );
});

test('check output uses relative paths, aligned methods and sorted paths', () => {
  const baseDir = join(here, 'fixtures-check');
  const listed = formatEndpointList(
    [
      {
        method: 'GET',
        path: '/zeta',
        file: join(baseDir, 'controller', 'Zeta.java'),
        line: 9,
      },
      {
        method: 'POST',
        path: '/alpha',
        file: join(baseDir, 'controller', 'alpha', 'Alpha.java'),
        line: 5,
      },
      {
        method: 'GET',
        path: '/alpha',
        file: join(baseDir, 'controller', 'alpha', 'Alpha.java'),
        line: 3,
      },
    ],
    baseDir,
    6,
  );

  assert.deepEqual(listed, [
    '  GET    /alpha (controller/alpha/Alpha.java:3)',
    '  POST   /alpha (controller/alpha/Alpha.java:5)',
    '  GET    /zeta (controller/Zeta.java:9)',
  ]);
});

test('check reports no drift when every endpoint matches', () => {
  const { matched, stale, undocumented } = compare(
    [endpoint('GET', '/users'), endpoint('POST', '/users/')],
    [doc('GET', '/users?page=2'), doc('POST', '/users')],
  );

  assert.equal(matched, 2);
  assert.deepEqual(stale, []);
  assert.deepEqual(undocumented, []);
});