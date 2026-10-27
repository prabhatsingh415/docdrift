import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { compare, normalizePath } from './match.js';
import { extractFromText } from './docs.js';

/**
 * Build the writer conversation for a fix attempt.
 *
 * @param {{ codeEndpoints: object[], docEndpoints: object[], readmeText: string }} input
 * @returns {{ role: string, content: string }[]}
 */
export function buildWriterMessages({ codeEndpoints, docEndpoints, readmeText }) {
  const { stale, undocumented } = compare(codeEndpoints, docEndpoints);

  const system = [
    'You update API documentation.',
    'Return ONLY the full updated README in Markdown, with no commentary and no code fences around it.',
    'Mention only endpoints from the lists below, plus endpoints already present in the README that also exist in the code.',
    'Never invent endpoints, paths or HTTP methods.',
    'Remove every STALE endpoint and add every UNDOCUMENTED endpoint.',
    'Place each added endpoint in the section whose path prefix matches it, and create a new section if none exists.',
    'Keep the existing formatting, wording and order of everything else.',
  ].join(' ');

  const user = [
    'Current README:',
    '"""',
    readmeText,
    '"""',
    '',
    'STALE endpoints to remove (documented, not in code):',
    listEndpoints(stale),
    '',
    'UNDOCUMENTED endpoints to add (in code, not documented):',
    listEndpoints(undocumented),
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Ask the writer for a README fix and verify it with plain code.
 *
 * @param {{
 *   codeEndpoints: object[],
 *   docEndpoints: object[],
 *   readmeText: string,
 *   chatFn: (messages: { role: string, content: string }[]) => Promise<string>,
 *   maxRetries?: number,
 * }} input
 * @returns {Promise<{
 *   status: string, draft?: string, invented?: object[], missing?: object[],
 *   leftover?: object[], attempts?: number,
 * }>}
 */
export async function fixDocs({
  codeEndpoints,
  docEndpoints,
  readmeText,
  chatFn,
  maxRetries = 2,
}) {
  const { stale, undocumented } = compare(codeEndpoints, docEndpoints);
  if (stale.length === 0 && undocumented.length === 0) {
    return { status: 'NO_DRIFT' };
  }

  const messages = buildWriterMessages({
    codeEndpoints,
    docEndpoints,
    readmeText,
  });

  let attempts = 0;
  let draft = '';
  let problems = { invented: [], missing: [], leftover: [] };

  while (attempts <= maxRetries) {
    attempts += 1;
    draft = cleanDraft(await chatFn(messages));
    problems = verifyDraft(draft, codeEndpoints, undocumented, stale);

    if (hasNoProblems(problems)) {
      return { status: 'VERIFIED', draft, ...problems, attempts };
    }

    if (attempts > maxRetries) break;

    messages.push({ role: 'assistant', content: draft });
    messages.push({ role: 'user', content: problemsMessage(problems) });
  }

  return { status: 'UNVERIFIED', draft, ...problems, attempts };
}

/**
 * Write the draft next to the README as README.drift.md, never overwriting it.
 *
 * @param {string} readmePath
 * @param {string} draft
 * @returns {string} path of the written file
 */
export function writeDriftFile(readmePath, draft) {
  const driftPath = join(dirname(readmePath), 'README.drift.md');
  writeFileSync(driftPath, draft);
  return driftPath;
}

/**
 * Trim a draft and drop a single fence wrapping the whole answer. Models often
 * wrap the README in ```markdown fences; keeping it would write a broken
 * README and let the fence lines confuse the verifier.
 */
function cleanDraft(rawDraft) {
  const trimmed = String(rawDraft ?? '').trim();
  const lines = trimmed.split('\n');

  if (
    lines.length >= 2 &&
    lines[0].trim().startsWith('```') &&
    lines[lines.length - 1].trim() === '```'
  ) {
    lines.shift();
    lines.pop();
    return lines.join('\n').trim();
  }

  return trimmed;
}

function verifyDraft(draft, codeEndpoints, undocumented, stale) {
  const draftEndpoints = extractFromText(draft);

  const invented = uniqueByMethodAndPath(
    draftEndpoints.filter(
      (endpoint) =>
        !codeEndpoints.some((code) => codeCovers(code, endpoint)),
    ),
  );

  const missing = undocumented.filter(
    (code) => !draftEndpoints.some((endpoint) => codeCovers(code, endpoint)),
  );

  const leftover = stale.filter((staleEndpoint) =>
    draftEndpoints.some((endpoint) =>
      sameMethodAndPath(staleEndpoint, {
        method: endpoint.method,
        path: endpoint.path,
      }),
    ),
  );

  return { invented, missing, leftover };
}

function codeCovers(codeEndpoint, docEndpoint) {
  if (normalizePath(codeEndpoint.path) !== normalizePath(docEndpoint.path)) {
    return false;
  }

  const methods = String(codeEndpoint.method ?? '')
    .split('|')
    .map((method) => method.trim());

  return methods.includes('ANY') || methods.includes(docEndpoint.method);
}

function sameMethodAndPath(a, b) {
  return (
    a.method === b.method && normalizePath(a.path) === normalizePath(b.path)
  );
}

function uniqueByMethodAndPath(endpoints) {
  const seen = new Set();
  const unique = [];
  for (const endpoint of endpoints) {
    const key = `${endpoint.method} ${normalizePath(endpoint.path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(endpoint);
  }
  return unique;
}

function hasNoProblems({ invented, missing, leftover }) {
  return invented.length + missing.length + leftover.length === 0;
}

function problemsMessage({ invented, missing, leftover }) {
  const lines = ['The draft has problems:'];

  if (invented.length > 0) {
    lines.push(`- Invented endpoints that are not in the code: ${labels(invented)}`);
  }
  if (missing.length > 0) {
    lines.push(`- Documented endpoints still missing: ${labels(missing)}`);
  }
  if (leftover.length > 0) {
    lines.push(`- Stale endpoints still present: ${labels(leftover)}`);
  }

  lines.push('Return ONLY the corrected full README in Markdown.');
  return lines.join('\n');
}

/**
 * Format the `fix` command output. Never includes the API key or base URL.
 *
 * @param {{
 *   status: string, model: string, attempts: number, staleRemoved: number,
 *   undocumentedAdded: number, draftPath: string | null,
 *   invented?: object[], missing?: object[], leftover?: object[],
 * }} input
 * @param {object | null} [style] optional createStyle() result for colored output
 * @returns {string}
 */
export function formatFixReport(input, style = null) {
  const {
    status,
    model,
    attempts,
    staleRemoved,
    undocumentedAdded,
    draftPath,
    invented = [],
    missing = [],
    leftover = [],
  } = input;

  const colored = Boolean(style?.enabled);

  const statusValue = !colored
    ? status
    : status === 'UNVERIFIED'
      ? style.danger(status)
      : style.success(status);

  const lines = colored
    ? [
        `${style.muted('Status:')} ${statusValue}`,
        `${style.muted('Model:')} ${style.muted(model)}`,
        `${style.muted('Attempts:')} ${style.muted(attempts)}`,
        `${style.muted('Stale removed:')} ${style.bold(style.success(String(staleRemoved)))} | ${style.muted('Undocumented added:')} ${style.bold(style.success(String(undocumentedAdded)))}`,
        `${style.muted('Draft:')} ${style.muted(draftPath ?? '(none)')}`,
      ]
    : [
        `Status: ${status}`,
        `Model: ${model}`,
        `Attempts: ${attempts}`,
        `Stale removed: ${staleRemoved} | Undocumented added: ${undocumentedAdded}`,
        `Draft: ${draftPath ?? '(none)'}`,
      ];

  if (status === 'UNVERIFIED') {
    for (const endpoint of invented) {
      lines.push(problemLine(style, 'Invented:', endpoint));
    }
    for (const endpoint of missing) {
      lines.push(problemLine(style, 'Missing:', endpoint));
    }
    for (const endpoint of leftover) {
      lines.push(problemLine(style, 'Leftover:', endpoint));
    }
  }

  if (colored && status === 'VERIFIED') {
    lines.push(style.success('✔ Draft verified against the code'));
  }
  if (colored && status === 'UNVERIFIED') {
    lines.push(style.danger('✖ Draft could not be verified'));
  }

  return lines.join('\n');
}

function problemLine(style, label, endpoint) {
  const text = `${endpoint.method} ${endpoint.path}`;
  if (!style?.enabled) return `${label} ${text}`;
  return `${style.danger(label)} ${style.danger(text)}`;
}

function listEndpoints(endpoints) {
  if (endpoints.length === 0) return '- (none)';
  return endpoints
    .map((endpoint) => `- ${endpoint.method} ${endpoint.path}`)
    .join('\n');
}

function labels(endpoints) {
  return endpoints
    .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    .join(', ');
}