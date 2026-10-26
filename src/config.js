import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = ['DOCDRIFT_BASE_URL', 'DOCDRIFT_MODEL'];
const API_KEY = 'DOCDRIFT_API_KEY';

/**
 * Load config from the environment, falling back to a .env file in `cwd`.
 * Real environment variables win over .env values.
 *
 * @param {{ env?: NodeJS.ProcessEnv, cwd?: string }} [options]
 * @returns {{ baseUrl: string, apiKey: string, model: string } | { error: string }}
 */
export function loadConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const fileValues = readDotEnv(join(cwd, '.env'));

  const read = (name) => {
    const fromEnv = env[name];
    if (fromEnv) return fromEnv;
    return fileValues[name] ?? '';
  };

  const baseUrl = read('DOCDRIFT_BASE_URL');
  const model = read('DOCDRIFT_MODEL');
  const apiKey = read(API_KEY);

  const missing = REQUIRED.filter((name) => !read(name));
  if (!apiKey && !isLocal(baseUrl)) missing.push(API_KEY);

  if (missing.length > 0) {
    return {
      error: `Missing ${missing.join(', ')}. Set these as environment variables or in .env (see .env.example).`,
    };
  }

  return { baseUrl, apiKey, model };
}

function readDotEnv(path) {
  if (!existsSync(path)) return {};

  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }

  return values;
}

function isLocal(baseUrl) {
  if (!baseUrl) return false;

  try {
    const { hostname } = new URL(baseUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/.test(
      baseUrl,
    );
  }
}