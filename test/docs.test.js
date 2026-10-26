import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanDocs } from '../src/docs.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures-docs');
const all = scanDocs(fixturesDir);

const endpointsIn = (fileName) =>
  all.filter((endpoint) => endpoint.file.endsWith(fileName));

const methodAndPath = (endpoints) =>
  endpoints.map(({ method, path }) => [method, path]);

test('finds endpoints in a fenced code block', () => {
  assert.ok(
    methodAndPath(endpointsIn('README.md')).some(
      ([method, path]) => method === 'PATCH' && path === '/users/{id}',
    ),
  );
});

test('finds endpoints in markdown table rows', () => {
  const rows = methodAndPath(endpointsIn('api.md')).slice(0, 3);

  assert.deepEqual(rows, [
    ['GET', '/users'],
    ['POST', '/users'],
    ['DELETE', '/users/{id}'],
  ]);
});

test('finds endpoints wrapped in inline backticks and bold markers', () => {
  assert.ok(
    methodAndPath(endpointsIn('README.md')).some(
      ([method, path]) => method === 'GET' && path === '/users/{id}',
    ),
  );
  assert.ok(
    methodAndPath(endpointsIn('api.md')).some(
      ([method, path]) => method === 'PUT' && path === '/users/{id}',
    ),
  );
});

test('strips a trailing period and a query string from the path', () => {
  const readme = methodAndPath(endpointsIn('README.md'));

  assert.ok(readme.some(([method, path]) => method === 'POST' && path === '/users'));
  assert.ok(
    readme.some(([method, path]) => method === 'GET' && path === '/users/search'),
  );
  assert.ok(all.every((endpoint) => !endpoint.path.endsWith('.')));
  assert.ok(all.every((endpoint) => !endpoint.path.includes('?')));
});

test('keeps path parameters exactly as written', () => {
  const paths = all.map((endpoint) => endpoint.path);

  assert.ok(paths.includes('/users/{id}'));
  assert.ok(paths.includes('/orders/:id'));
});

test('does not match URLs after the method', () => {
  assert.ok(all.every((endpoint) => !endpoint.path.includes('example.com')));
  assert.ok(all.every((endpoint) => !endpoint.path.startsWith('https:')));
});

test('reports the 1-based line number of each endpoint', () => {
  const tableRow = endpointsIn('api.md').find(
    ({ method, path }) => method === 'GET' && path === '/users',
  );

  assert.equal(tableRow.line, 5);
  assert.ok(all.every((endpoint) => endpoint.line >= 1));
});