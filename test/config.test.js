import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const dirWithoutDotEnv = join(here, 'fixtures-check');

test('missing variables are listed with how to set them', () => {
  const result = loadConfig({ env: {}, cwd: dirWithoutDotEnv });

  assert.ok(result.error);
  assert.match(result.error, /DOCDRIFT_BASE_URL/);
  assert.match(result.error, /DOCDRIFT_MODEL/);
  assert.match(result.error, /DOCDRIFT_API_KEY/);
  assert.match(result.error, /environment variables/);
  assert.match(result.error, /\.env/);
});

test('config values are parsed from .env', () => {
  const dir = mkdtempSync(join(here, 'tmp-config-'));
  try {
    writeFileSync(
      join(dir, '.env'),
      [
        '# test values',
        '',
        'DOCDRIFT_API_KEY="file-key"',
        "DOCDRIFT_BASE_URL='https://file.example/v1'",
        'DOCDRIFT_MODEL=file-model',
      ].join('\n'),
    );

    const config = loadConfig({ env: {}, cwd: dir });

    assert.deepEqual(config, {
      baseUrl: 'https://file.example/v1',
      apiKey: 'file-key',
      model: 'file-model',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('real environment variables win over .env', () => {
  const dir = mkdtempSync(join(here, 'tmp-config-'));
  try {
    writeFileSync(
      join(dir, '.env'),
      [
        'DOCDRIFT_API_KEY=file-key',
        'DOCDRIFT_BASE_URL=https://file.example/v1',
        'DOCDRIFT_MODEL=file-model',
      ].join('\n'),
    );

    const config = loadConfig({
      env: { DOCDRIFT_MODEL: 'env-model' },
      cwd: dir,
    });

    assert.equal(config.model, 'env-model');
    assert.equal(config.baseUrl, 'https://file.example/v1');
    assert.equal(config.apiKey, 'file-key');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the API key is optional for localhost and 127.0.0.1', () => {
  const localhost = loadConfig({
    env: {
      DOCDRIFT_BASE_URL: 'http://localhost:11434/v1',
      DOCDRIFT_MODEL: 'llama3',
    },
    cwd: dirWithoutDotEnv,
  });

  assert.deepEqual(localhost, {
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'llama3',
  });

  const loopback = loadConfig({
    env: {
      DOCDRIFT_BASE_URL: 'http://127.0.0.1:11434/v1',
      DOCDRIFT_MODEL: 'llama3',
    },
    cwd: dirWithoutDotEnv,
  });

  assert.equal(loopback.error, undefined);
});

test('the API key is required for non-local base URLs', () => {
  const result = loadConfig({
    env: {
      DOCDRIFT_BASE_URL: 'https://api.example.com/v1',
      DOCDRIFT_MODEL: 'some-model',
    },
    cwd: dirWithoutDotEnv,
  });

  assert.match(result.error, /DOCDRIFT_API_KEY/);
  assert.doesNotMatch(result.error, /DOCDRIFT_MODEL/);
  assert.doesNotMatch(result.error, /DOCDRIFT_BASE_URL/);
});