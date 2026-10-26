import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanJava } from '../src/scan.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const all = scanJava(fixturesDir);

const endpointsIn = (fileName) =>
  all.filter((endpoint) => endpoint.file.endsWith(fileName));

const methodAndPath = (endpoints) =>
  endpoints.map(({ method, path }) => [method, path]);

test('class-level @RequestMapping prefix is joined to every method path', () => {
  const endpoints = endpointsIn('WithPrefix.java');

  assert.deepEqual(methodAndPath(endpoints), [
    ['GET', '/api/users'],
    ['GET', '/api/users/{id}'],
    ['POST', '/api/users/create'],
    ['DELETE', '/api/users/{id}'],
  ]);

  for (const endpoint of endpoints) {
    assert.ok(endpoint.path.startsWith('/'));
    assert.ok(!endpoint.path.includes('//'));
  }
});

test('methods on a class without a prefix keep their own paths', () => {
  assert.deepEqual(methodAndPath(endpointsIn('NoPrefix.java')), [
    ['GET', '/health'],
    ['POST', '/items'],
  ]);
});

test('one annotation with several paths yields one endpoint per path', () => {
  assert.deepEqual(methodAndPath(endpointsIn('MultiPath.java')), [
    ['GET', '/multi/a'],
    ['GET', '/multi/b'],
    ['GET', '/multi/c'],
    ['GET', '/multi/d'],
  ]);
});

test('commented-out endpoints are ignored', () => {
  const endpoints = endpointsIn('Commented.java');

  assert.deepEqual(methodAndPath(endpoints), [['GET', '/ghosts/real']]);
  assert.ok(endpoints.every((endpoint) => !endpoint.path.includes('gone')));
});

test('line numbers point at the annotation in the original file', () => {
  assert.ok(all.length > 0);

  for (const endpoint of all) {
    const lines = readFileSync(endpoint.file, 'utf8').split(/\r?\n/);
    assert.match(
      lines[endpoint.line - 1],
      /@(?:GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\b/,
    );
  }
});