import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git']);

// METHOD, then separators, then a path that starts with "/". The path stops at
// any character that ends an endpoint in prose, tables or inline code.
const ENDPOINT_RE =
  /\b(GET|POST|PUT|DELETE|PATCH)[ \t`|*]+\/[^\s`|)\]"'<>;,?*]*/g;

/**
 * Scan Markdown docs for documented REST endpoints.
 *
 * @param {string} dir project root containing README.md and/or docs/
 * @returns {{ method: string, path: string, file: string, line: number }[]}
 */
export function scanDocs(dir) {
  const endpoints = [];

  for (const file of collectMarkdownFiles(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const endpoint of extractFromText(text)) {
      endpoints.push({ ...endpoint, file });
    }
  }

  return endpoints.sort(
    (a, b) => compare(a.file, b.file) || a.line - b.line,
  ).map(({ method, path, file, line }) => ({ method, path, file, line }));
}

/**
 * Extract documented endpoints from a Markdown string.
 *
 * @param {string} text Markdown content
 * @returns {{ method: string, path: string, line: number }[]}
 */
export function extractFromText(text) {
  const found = [];

  ENDPOINT_RE.lastIndex = 0;
  let match;
  while ((match = ENDPOINT_RE.exec(String(text ?? ''))) !== null) {
    const method = match[1];
    let path = match[0].slice(method.length).replace(/^[ \t`|*]+/, '');
    path = path.split('?')[0].replace(/[.:]+$/, '');
    if (!path.startsWith('/')) continue;

    found.push({ method, path, line: lineOf(text, match.index) });
  }

  return found;
}

function collectMarkdownFiles(dir) {
  const files = [];

  if (!existsSync(dir)) return files;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
    if (entry.isFile() && entry.name.toLowerCase() === 'readme.md') {
      files.push(join(dir, entry.name));
    }
  }

  const docsDir = join(dir, 'docs');
  if (existsSync(docsDir) && statSync(docsDir).isDirectory()) {
    walkMarkdown(docsDir, files);
  }

  return files;
}

function walkMarkdown(current, files) {
  const entries = readdirSync(current, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkMarkdown(full, files);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(full);
    }
  }
}

function compare(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}