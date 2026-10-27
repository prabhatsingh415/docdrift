import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildWriterMessages,
  fixDocs,
  formatFixReport,
  writeDriftFile,
} from '../src/fix.js';

const here = dirname(fileURLToPath(import.meta.url));

const endpoint = (method, path, file = 'Code.java', line = 1) => ({
  method,
  path,
  file,
  line,
});

const code = [
  endpoint('GET', '/users'),
  endpoint('POST', '/users'),
  endpoint('DELETE', '/users/{id}'),
];

const docs = [
  endpoint('GET', '/users', 'README.md', 3),
  endpoint('GET', '/legacy', 'README.md', 7),
];

const readmeText = '# Users\n\n- GET /users\n- GET /legacy\n';

const goodDraft =
  '# Users\n\n- GET /users\n- POST /users\n- DELETE /users/{id}\n';

test('a good draft is VERIFIED on the first attempt', async () => {
  let calls = 0;

  const result = await fixDocs({
    codeEndpoints: code,
    docEndpoints: docs,
    readmeText,
    chatFn: async () => {
      calls += 1;
      return goodDraft;
    },
  });

  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.attempts, 1);
  assert.equal(result.draft, goodDraft.trim());
  assert.equal(calls, 1);
  assert.deepEqual(result.invented, []);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.leftover, []);
});

test('an invented endpoint triggers a retry and then passes', async () => {
  const drafts = [`${goodDraft}- GET /ghost\n`, goodDraft];
  const calls = [];

  const result = await fixDocs({
    codeEndpoints: code,
    docEndpoints: docs,
    readmeText,
    chatFn: async (messages) => {
      calls.push(messages.map((message) => ({ ...message })));
      return drafts[calls.length - 1];
    },
  });

  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.attempts, 2);
  assert.equal(calls.length, 2);

  const retry = calls[1];
  assert.ok(
    retry.some(
      (message) =>
        message.role === 'user' && message.content.includes('Invented'),
    ),
  );
  assert.ok(
    retry.some((message) => message.content.includes('GET /ghost')),
  );
});

test('a draft that never passes ends as UNVERIFIED after the retries', async () => {
  let calls = 0;

  const result = await fixDocs({
    codeEndpoints: code,
    docEndpoints: docs,
    readmeText,
    chatFn: async () => {
      calls += 1;
      return '# Users\n\n- GET /users\n';
    },
  });

  assert.equal(result.status, 'UNVERIFIED');
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
  assert.deepEqual(
    result.missing.map(({ method, path }) => [method, path]),
    [
      ['POST', '/users'],
      ['DELETE', '/users/{id}'],
    ],
  );
});

test('no drift returns NO_DRIFT without calling the writer', async () => {
  const result = await fixDocs({
    codeEndpoints: [endpoint('GET', '/users')],
    docEndpoints: [endpoint('GET', '/users')],
    readmeText: '# Users\n\n- GET /users\n',
    chatFn: async () => {
      throw new Error('the writer must not be called');
    },
  });

  assert.deepEqual(result, { status: 'NO_DRIFT' });
});

test('a draft wrapped in one markdown fence is cleaned and verified', async () => {
  const wrapped = `\`\`\`markdown\n${goodDraft}\`\`\``;

  const result = await fixDocs({
    codeEndpoints: code,
    docEndpoints: docs,
    readmeText,
    chatFn: async () => wrapped,
  });

  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.draft, goodDraft.trim());
  assert.ok(!result.draft.includes('```'));
});

test('a fence inside the draft body is kept', async () => {
  const draftWithInnerFence = [
    '# Users',
    '',
    '```http',
    'GET /users',
    '```',
    '',
    '- GET /users',
    '- POST /users',
    '- DELETE /users/{id}',
  ].join('\n');

  const result = await fixDocs({
    codeEndpoints: code,
    docEndpoints: docs,
    readmeText,
    chatFn: async () => draftWithInnerFence,
  });

  assert.equal(result.status, 'VERIFIED');
  assert.ok(result.draft.includes('```http'));
  assert.equal(result.draft, draftWithInnerFence);
});

test('the writer prompt asks to match sections and keep formatting', () => {
  const messages = buildWriterMessages({
    codeEndpoints: code,
    docEndpoints: docs,
    readmeText,
  });

  assert.ok(
    messages[0].content.includes(
      'Place each added endpoint in the section whose path prefix matches it, and create a new section if none exists. Keep the existing formatting, wording and order of everything else.',
    ),
  );
});

test('the fix report shows status, model and attempts', () => {
  const report = formatFixReport({
    status: 'UNVERIFIED',
    model: 'test-model',
    attempts: 3,
    staleRemoved: 1,
    undocumentedAdded: 0,
    draftPath: 'README.drift.md',
    invented: [{ method: 'GET', path: '/ghost' }],
    missing: [],
    leftover: [{ method: 'GET', path: '/legacy' }],
  });

  const lines = report.split('\n');
  assert.equal(lines[0], 'Status: UNVERIFIED');
  assert.equal(lines[1], 'Model: test-model');
  assert.equal(lines[2], 'Attempts: 3');
  assert.equal(lines[3], 'Stale removed: 1 | Undocumented added: 0');
  assert.equal(lines[4], 'Draft: README.drift.md');
  assert.ok(lines.includes('Invented: GET /ghost'));
  assert.ok(lines.includes('Leftover: GET /legacy'));
});

test('writer messages contain the README and both endpoint lists', () => {
  const messages = buildWriterMessages({
    codeEndpoints: code,
    docEndpoints: docs,
    readmeText,
  });

  assert.equal(messages[0].role, 'system');
  const user = messages[1].content;

  assert.ok(user.includes(readmeText));
  assert.ok(user.includes('GET /legacy'));
  assert.ok(user.includes('POST /users'));
  assert.ok(user.includes('DELETE /users/{id}'));
});

test('writing a draft never overwrites the README', () => {
  const dir = mkdtempSync(join(here, 'tmp-fix-'));
  try {
    const readmePath = join(dir, 'README.md');
    const original = '# Original README\n';
    writeFileSync(readmePath, original);

    const driftPath = writeDriftFile(readmePath, '# Draft\n');

    assert.equal(readFileSync(readmePath, 'utf8'), original);
    assert.equal(driftPath, join(dir, 'README.drift.md'));
    assert.equal(readFileSync(driftPath, 'utf8'), '# Draft\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});