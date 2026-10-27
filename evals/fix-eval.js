import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanDocs } from '../src/docs.js';
import { compare } from '../src/match.js';
import { loadConfig } from '../src/config.js';
import { chat } from '../src/llm.js';
import { fixDocs } from '../src/fix.js';
import {
  mulberry32,
  primaryDocMethod,
  renderReadme,
  repoName,
  scanJavaQuiet,
  seedDrift,
} from './run.js';

const SEED = 0x5eed1234;
const TRIALS = 3;
const REMOVED_PER_TRIAL = 2;
const FAKE_PER_TRIAL = 2;
const BETWEEN_CALLS_MS = 4000;
const RETRY_DELAY_MS = 20000;
const MAX_DETAILS = 5;

async function main() {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error(
      'usage: node evals/fix-eval.js <javaSrcDir> [<javaSrcDir> ...]',
    );
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  if (config.error) {
    console.error(config.error);
    process.exitCode = 2;
    return;
  }

  const rows = [];
  const details = [];
  const total = emptyStats('TOTAL');
  const state = { calls: 0 };

  for (let index = 0; index < dirs.length; index += 1) {
    const dir = dirs[index];
    let endpoints;
    try {
      endpoints = scanJavaQuiet(dir);
    } catch (error) {
      console.error(`Skipping ${dir}: ${error.message}`);
      continue;
    }

    const repo = repoName(dir);
    const rng = mulberry32(SEED + index);
    const stats = emptyStats(repo);

    for (let trial = 0; trial < TRIALS; trial += 1) {
      const result = await runTrial({
        repo,
        trial,
        endpoints,
        rng,
        config,
        state,
      });

      stats.trials += 1;
      if (result.error) {
        stats.errors += 1;
      } else {
        stats.completed += 1;
        stats.attempts += result.attempts;
        if (result.status === 'VERIFIED') stats.verified += 1;
        if (result.success) stats.success += 1;
      }

      if (!result.error && !result.success && details.length < MAX_DETAILS) {
        details.push(formatFailure(result));
      }
    }

    rows.push(stats);
    total.trials += stats.trials;
    total.verified += stats.verified;
    total.success += stats.success;
    total.errors += stats.errors;
    total.attempts += stats.attempts;
    total.completed += stats.completed;
  }

  const table = markdownTable([...rows, total]);
  const detailsText =
    details.length === 0
      ? 'No failures'
      : details.map((line, index) => `${index + 1}. ${line}`).join('\n');

  console.log(table);
  console.log('');
  console.log(`Model: ${config.model}`);
  console.log('');
  console.log('Failures:');
  console.log(detailsText);

  const content = [
    '# DocDrift fix eval',
    '',
    table,
    '',
    `Model: ${config.model}`,
    '',
    '## Failures',
    '',
    detailsText,
    '',
  ].join('\n');

  writeFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'FIX-RESULTS.md'),
    content,
  );
}

async function runTrial({ repo, trial, endpoints, rng, config, state }) {
  const tempDir = mkdtempSync(join(tmpdir(), 'docdrift-fix-eval-'));
  try {
    const { kept, fakes } = seedDrift({
      endpoints,
      rng,
      trial,
      removedCount: REMOVED_PER_TRIAL,
      fakeCount: FAKE_PER_TRIAL,
    });

    const documented = [
      ...kept.map((endpoint) => ({
        method: primaryDocMethod(endpoint.method),
        path: endpoint.path,
      })),
      ...fakes,
    ];

    const readmeText = renderReadme('bullets', documented);
    writeFileSync(join(tempDir, 'README.md'), readmeText);
    const docEndpoints = scanDocs(tempDir);

    let result;
    try {
      result = await fixDocs({
        codeEndpoints: endpoints,
        docEndpoints,
        readmeText,
        chatFn: (messages) => realChat(config, messages, state),
        maxRetries: 2,
      });
    } catch {
      return {
        repo,
        trial,
        status: 'ERROR',
        attempts: 0,
        success: false,
        error: true,
      };
    }

    let post = { stale: [], undocumented: [] };
    if (result.draft !== undefined) {
      writeFileSync(join(tempDir, 'README.md'), result.draft);
      post = compare(endpoints, scanDocs(tempDir));
    }

    return {
      repo,
      trial,
      status: result.status,
      attempts: result.attempts ?? 0,
      error: false,
      success:
        result.status === 'VERIFIED' &&
        post.stale.length === 0 &&
        post.undocumented.length === 0,
      invented: result.invented ?? [],
      missing: result.missing ?? [],
      leftover: result.leftover ?? [],
      postStale: post.stale,
      postUndocumented: post.undocumented,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function realChat(config, messages, state) {
  if (state.calls > 0) await sleep(BETWEEN_CALLS_MS);
  state.calls += 1;

  try {
    return await chat(config, messages);
  } catch (error) {
    if (!isRetryable(error)) throw error;
    await sleep(RETRY_DELAY_MS);
    state.calls += 1;
    return chat(config, messages);
  }
}

function isRetryable(error) {
  if (!error) return false;
  if (error.name === 'TypeError' || error.name === 'AbortError') return true;
  return /status 429/.test(String(error.message ?? ''));
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function emptyStats(repo) {
  return {
    repo,
    trials: 0,
    verified: 0,
    success: 0,
    errors: 0,
    attempts: 0,
    completed: 0,
  };
}

function averageAttempts(stats) {
  return stats.completed === 0
    ? 'n/a'
    : (stats.attempts / stats.completed).toFixed(1);
}

function markdownTable(rows) {
  const header =
    '| Repo | Trials | VERIFIED | Success | Errors | Avg attempts |';
  const separator = '| --- | --- | --- | --- | --- | --- |';
  const body = rows.map(
    (row) =>
      `| ${row.repo} | ${row.trials} | ${row.verified} | ${row.success} | ${row.errors} | ${averageAttempts(row)} |`,
  );
  return [header, separator, ...body].join('\n');
}

function formatFailure(result) {
  const list = (endpoints) =>
    endpoints.length === 0
      ? 'none'
      : endpoints
          .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
          .join(', ');

  const parts = [
    `${result.repo} | trial ${result.trial + 1} | ${result.status}`,
    `invented: ${list(result.invented)}`,
    `missing: ${list(result.missing)}`,
    `leftover: ${list(result.leftover)}`,
  ];

  if (result.status === 'VERIFIED') {
    parts.push(
      `second compare stale: ${list(result.postStale)}; undocumented: ${list(result.postUndocumented)}`,
    );
  }

  return parts.join(' | ');
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}