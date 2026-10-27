import test from 'node:test';
import assert from 'node:assert/strict';

import { chat } from '../src/llm.js';

const config = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'super-secret-key',
  model: 'test-model',
};

async function captureError(status) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status,
    text() {
      throw new Error('the response body must not be read');
    },
  });

  try {
    await chat(config, [{ role: 'user', content: 'hello' }]);
    return null;
  } catch (error) {
    return error.message;
  } finally {
    globalThis.fetch = original;
  }
}

function assertNoSecrets(message) {
  assert.ok(!message.includes(config.apiKey));
  assert.ok(!message.includes('api.example.com'));
  assert.ok(!message.includes('response body'));
}

test('429 shows the short rate-limit message with no response body', async () => {
  const message = await captureError(429);

  assert.equal(
    message,
    'The model is rate-limited or busy right now (HTTP 429). Try again in a minute, or set another model in DOCDRIFT_MODEL.',
  );
  assertNoSecrets(message);
});

test('401 shows the short API key message with no response body', async () => {
  const message = await captureError(401);

  assert.equal(
    message,
    'The API key was rejected (HTTP 401). Check DOCDRIFT_API_KEY.',
  );
  assertNoSecrets(message);
});

test('500 shows the short generic message with no response body', async () => {
  const message = await captureError(500);

  assert.equal(message, 'The model request failed (HTTP 500).');
  assertNoSecrets(message);
});