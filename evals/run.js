import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanJava } from '../src/scan.js';
import { scanDocs } from '../src/docs.js';
import { compare, normalizePath } from '../src/match.js';

const FORMATS = ['bullets', 'table', 'mixed'];
const TRIALS_PER_FORMAT = 10;
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const SEED = 0x5eed1234;
const PARAM_RE = /\{[^}]*\}|:[A-Za-z_$][\w$]*/;
const MAX_FAILURES = 10;
const GENERIC_DIRS = new Set([
  'java',
  'kotlin',
  'src',
  'main',
  'test',
  'resources',
  'backend',
  'frontend',
]);

/**
 * Run the deterministic drift evaluation for each repository directory.
 *
 * @param {string[]} dirs directories containing Spring Boot .java sources
 * @returns {{ rows: object[], total: object, failures: string[], skipped: string[] }}
 */
export function runEval(dirs) {
  const rows = [];
  const failures = [];
  const skipped = [];
  const total = emptyStats('TOTAL');

  dirs.forEach((dir, index) => {
    let endpoints;
    try {
      endpoints = scanJavaQuiet(dir);
    } catch (error) {
      skipped.push(`Skipping ${dir}: ${error.message}`);
      return;
    }

    if (endpoints.length < 4) {
      skipped.push(
        `Skipping ${dir}: only ${endpoints.length} endpoint(s) found (need at least 4).`,
      );
      return;
    }

    const repo = repoName(dir);
    const rng = mulberry32(SEED + index);
    const stats = emptyStats(repo);
    stats.endpoints = endpoints.length;

    for (const format of FORMATS) {
      for (let trial = 0; trial < TRIALS_PER_FORMAT; trial += 1) {
        const result = runTrial({ repo, format, trial, endpoints, rng });
        stats.trials += 1;
        accumulate(stats, result);
        accumulate(total, result);
        for (const failure of result.failures) {
          if (failures.length < MAX_FAILURES) failures.push(failure);
        }
      }
    }

    total.endpoints += endpoints.length;
    rows.push(withMetrics(stats));
  });

  total.trials = rows.reduce((sum, row) => sum + row.trials, 0);

  return { rows, total: withMetrics(total), failures, skipped };
}

function runTrial({ repo, format, trial, endpoints, rng }) {
  const k = Math.min(1 + (trial % 3), Math.floor(endpoints.length / 2));
  const { kept, removed, fakes } = seedDrift({
    endpoints,
    rng,
    trial,
    removedCount: k,
    fakeCount: k,
  });

  const documented = kept.map((endpoint) => ({
    method: primaryDocMethod(endpoint.method),
    path: endpoint.path,
  }));

  for (const endpoint of documented) {
    if (rng() < 0.34) {
      endpoint.path = renameParam(endpoint.path, rng);
    }
    if (
      rng() < 0.34 &&
      !PARAM_RE.test(endpoint.path) &&
      !endpoint.path.endsWith('/')
    ) {
      endpoint.path = `${endpoint.path}/`;
    }
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'docdrift-eval-'));
  try {
    writeFileSync(
      join(tempDir, 'README.md'),
      renderReadme(format, [...documented, ...fakes]),
    );

    const docEndpoints = scanDocs(tempDir);
    const result = compare(endpoints, docEndpoints);

    const stale = score(keySet(fakes), keySet(result.stale));
    const undocumented = score(
      keySet(removed),
      keySet(result.undocumented),
    );

    return {
      stale,
      undocumented,
      failures: failureMessages({
        repo,
        format,
        trial: trial + 1,
        stale,
        undocumented,
      }),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function seedDrift({
  endpoints,
  rng,
  trial,
  removedCount,
  fakeCount,
}) {
  const shuffled = shuffle([...endpoints], rng);
  const removed = shuffled.slice(0, removedCount);
  const kept = shuffled.slice(removedCount);
  const fakes = [];

  for (let i = 0; i < fakeCount; i += 1) {
    fakes.push({
      method: METHODS[Math.floor(rng() * METHODS.length)],
      path: `/fake-${trial + 1}-${i + 1}/items`,
    });
  }

  return { kept, removed, fakes };
}

export function renderReadme(format, endpoints) {
  const bullet = (endpoint) => `- \`${endpoint.method} ${endpoint.path}\``;
  const row = (endpoint) => `| ${endpoint.method} | \`${endpoint.path}\` |`;

  if (format === 'table') {
    return [
      '# API',
      '',
      '| Method | Path |',
      '| --- | --- |',
      ...endpoints.map(row),
      '',
    ].join('\n');
  }

  if (format === 'mixed') {
    const split = Math.ceil(endpoints.length / 2);
    return [
      '# API',
      '',
      '## Endpoints',
      '',
      ...endpoints.slice(0, split).map(bullet),
      '',
      '## More endpoints',
      '',
      '| Method | Path |',
      '| --- | --- |',
      ...endpoints.slice(split).map(row),
      '',
    ].join('\n');
  }

  return [
    '# API',
    '',
    '## Endpoints',
    '',
    ...endpoints.map(bullet),
    '',
  ].join('\n');
}

export function repoName(dir) {
  const parts = resolve(dir)
    .split(/[\\/]+/)
    .filter(Boolean);

  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (!GENERIC_DIRS.has(parts[i].toLowerCase())) return parts[i];
  }

  return basename(resolve(dir));
}

export function primaryDocMethod(method) {
  const methods = String(method ?? '')
    .split('|')
    .map((value) => value.trim());
  if (methods.includes('ANY')) return 'GET';
  return methods.find((value) => METHODS.includes(value)) ?? 'GET';
}

function renameParam(path, rng) {
  const match = path.match(PARAM_RE);
  if (!match) return path;

  const alias = ['someId', 'userId', 'itemId', 'key'][
    Math.floor(rng() * 4)
  ];
  const replacement = match[0].startsWith('{') ? `{${alias}}` : `:${alias}`;
  return path.replace(PARAM_RE, replacement);
}

function keySet(endpoints) {
  const keys = new Set();
  for (const endpoint of endpoints) {
    for (const method of String(endpoint.method ?? '')
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean)) {
      keys.add(`${method} ${normalizePath(endpoint.path)}`);
    }
  }
  return keys;
}

function score(expected, predicted) {
  const falseNegatives = [...expected].filter((key) => !predicted.has(key));
  const falsePositives = [...predicted].filter((key) => !expected.has(key));
  return {
    tp: [...predicted].filter((key) => expected.has(key)).length,
    fp: falsePositives.length,
    fn: falseNegatives.length,
    falsePositives,
    falseNegatives,
  };
}

function failureMessages({ repo, format, trial, stale, undocumented }) {
  const messages = [];
  for (const key of stale.falseNegatives) {
    messages.push(
      `${repo} | ${format} | trial ${trial} | STALE false negative: ${key} (expected stale, not found)`,
    );
  }
  for (const key of stale.falsePositives) {
    messages.push(
      `${repo} | ${format} | trial ${trial} | STALE false positive: ${key} (found, not expected)`,
    );
  }
  for (const key of undocumented.falseNegatives) {
    messages.push(
      `${repo} | ${format} | trial ${trial} | UNDOCUMENTED false negative: ${key} (expected undocumented, not found)`,
    );
  }
  for (const key of undocumented.falsePositives) {
    messages.push(
      `${repo} | ${format} | trial ${trial} | UNDOCUMENTED false positive: ${key} (found, not expected)`,
    );
  }
  return messages;
}

function emptyStats(repo) {
  return {
    repo,
    endpoints: 0,
    trials: 0,
    stale: { tp: 0, fp: 0, fn: 0 },
    undocumented: { tp: 0, fp: 0, fn: 0 },
  };
}

function accumulate(stats, result) {
  for (const kind of ['stale', 'undocumented']) {
    stats[kind].tp += result[kind].tp;
    stats[kind].fp += result[kind].fp;
    stats[kind].fn += result[kind].fn;
  }
}

function withMetrics(stats) {
  return {
    ...stats,
    stale: {
      ...stats.stale,
      precision: ratio(stats.stale.tp, stats.stale.tp + stats.stale.fp),
      recall: ratio(stats.stale.tp, stats.stale.tp + stats.stale.fn),
    },
    undocumented: {
      ...stats.undocumented,
      precision: ratio(
        stats.undocumented.tp,
        stats.undocumented.tp + stats.undocumented.fp,
      ),
      recall: ratio(
        stats.undocumented.tp,
        stats.undocumented.tp + stats.undocumented.fn,
      ),
    },
  };
}

function ratio(value, total) {
  return total === 0 ? 'n/a' : value / total;
}

function formatPercent(value) {
  return value === 'n/a' ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function markdownTable(rows, total) {
  const header =
    '| Repo | Endpoints | Trials | STALE precision | STALE recall | UNDOCUMENTED precision | UNDOCUMENTED recall |';
  const separator = '| --- | --- | --- | --- | --- | --- | --- |';
  const body = [...rows, total].map(
    (row) =>
      `| ${row.repo} | ${row.endpoints} | ${row.trials} | ${formatPercent(row.stale.precision)} | ${formatPercent(row.stale.recall)} | ${formatPercent(row.undocumented.precision)} | ${formatPercent(row.undocumented.recall)} |`,
  );
  return [header, separator, ...body].join('\n');
}

export function scanJavaQuiet(dir) {
  const original = process.stderr.write;
  process.stderr.write = () => true;
  try {
    return scanJava(dir);
  } finally {
    process.stderr.write = original;
  }
}

function shuffle(items, rng) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function failureSection(failures) {
  if (failures.length === 0) return 'No failures';
  return failures.map((failure, index) => `${index + 1}. ${failure}`).join('\n');
}

function main() {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error('usage: node evals/run.js <javaSrcDir> [<javaSrcDir> ...]');
    process.exitCode = 1;
    return;
  }

  const { rows, total, failures, skipped } = runEval(dirs);
  const table = markdownTable(rows, total);
  const failuresText = failureSection(failures);

  for (const message of skipped) console.log(message);
  if (skipped.length > 0) console.log('');
  console.log(table);
  console.log('');
  console.log('Failures:');
  console.log(failuresText);

  const results = [
    '# DocDrift eval results',
    '',
    ...(skipped.length > 0 ? [...skipped, ''] : []),
    table,
    '',
    '## Failures',
    '',
    failuresText,
    '',
  ].join('\n');

  writeFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'RESULTS.md'),
    results,
  );
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  main();
}