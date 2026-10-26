import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['target', 'build', '.git', 'node_modules']);

const METHOD_BY_ANNOTATION = new Map([
  ['GetMapping', 'GET'],
  ['PostMapping', 'POST'],
  ['PutMapping', 'PUT'],
  ['DeleteMapping', 'DELETE'],
  ['PatchMapping', 'PATCH'],
]);

const ANNOTATION_RE =
  /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\b/g;

/**
 * Scan a directory for Spring Boot REST endpoints.
 *
 * @param {string} dir directory to walk recursively
 * @returns {{ method: string, path: string, file: string, line: number }[]}
 */
export function scanJava(dir) {
  const endpoints = [];

  for (const file of collectJavaFiles(dir)) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const annotations = findAnnotations(code);
    const classIndex = findClassIndex(code);
    const prefix = readClassPrefix(
      code,
      annotations.filter((a) => classIndex !== -1 && a.index < classIndex),
      file,
    );

    for (const annotation of annotations) {
      if (classIndex !== -1 && annotation.index < classIndex) continue;

      const mapping = parseMappingArgs(annotation.args);
      const line = lineOf(code, annotation.index);

      if (!mapping.literal) {
        console.error(
          `docdrift: warning: ${file}:${line}: skipping @${annotation.name} with a non-literal path`,
        );
        continue;
      }

      const method =
        annotation.name === 'RequestMapping'
          ? (mapping.method ?? 'ANY')
          : METHOD_BY_ANNOTATION.get(annotation.name);

      for (const path of mapping.paths) {
        endpoints.push({ method, path: joinPaths(prefix, path), file, line });
      }
    }
  }

  return endpoints.sort(
    (a, b) => compare(a.file, b.file) || a.line - b.line,
  );
}

function collectJavaFiles(dir) {
  const files = [];

  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        files.push(full);
      }
    }
  };

  walk(dir);
  return files;
}

function compare(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Replace comments with spaces while keeping newlines, so offsets and line
 * numbers still match the original source. String literals are left alone.
 */
function stripComments(source) {
  let out = '';
  let state = 'code';
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '"') state = 'string';
      else if (ch === "'") state = 'char';
      out += ch;
      i += 1;
      continue;
    }

    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += ch;
      } else {
        out += ch === '\r' ? '\r' : ' ';
      }
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        out += '  ';
        i += 2;
        continue;
      }
      out += ch === '\n' || ch === '\r' ? ch : ' ';
      i += 1;
      continue;
    }

    // Inside a string or char literal: copy verbatim, honour escapes.
    if (ch === '\\') {
      out += ch + (next ?? '');
      i += 2;
      continue;
    }
    if ((state === 'string' && ch === '"') || (state === 'char' && ch === "'")) {
      state = 'code';
    }
    out += ch;
    i += 1;
  }

  return out;
}

function findAnnotations(code) {
  const annotations = [];

  ANNOTATION_RE.lastIndex = 0;
  let match;
  while ((match = ANNOTATION_RE.exec(code)) !== null) {
    let i = ANNOTATION_RE.lastIndex;
    while (i < code.length && /\s/.test(code[i])) i += 1;

    let args = '';
    if (code[i] === '(') {
      const close = findClosingParen(code, i);
      if (close === -1) continue;
      args = code.slice(i + 1, close);
    }

    annotations.push({ name: match[1], index: match.index, args });
  }

  return annotations;
}

function findClosingParen(code, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      i = skipLiteral(code, i);
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipLiteral(code, start) {
  const quote = code[start];
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') {
      i += 2;
      continue;
    }
    if (code[i] === quote) return i;
    i += 1;
  }
  return code.length;
}

function findClassIndex(code) {
  const match = /\b(?:class|interface|enum|record)\s+[A-Za-z_$][\w$]*/.exec(code);
  return match ? match.index : -1;
}

function readClassPrefix(code, classAnnotations, file) {
  const classMapping = classAnnotations
    .filter((annotation) => annotation.name === 'RequestMapping')
    .pop();

  if (!classMapping) return '';

  const mapping = parseMappingArgs(classMapping.args);
  if (!mapping.literal) {
    console.error(
      `docdrift: warning: ${file}:${lineOf(code, classMapping.index)}: class-level @RequestMapping has a non-literal path, using no prefix`,
    );
    return '';
  }

  return mapping.paths[0] ?? '';
}

function parseMappingArgs(argsText) {
  const text = argsText.trim();
  if (text === '') return { paths: [''], method: null, literal: true };

  const parts = splitTopLevel(text)
    .map((part) => part.trim())
    .filter(Boolean);

  let pathExpr = null;
  for (const part of parts) {
    const explicit = part.match(/^(?:value|path)\s*=\s*([\s\S]*)$/);
    if (explicit) {
      pathExpr = explicit[1].trim();
      break;
    }
  }

  if (pathExpr === null) {
    const positional = parts.find(
      (part) => !/^[A-Za-z_$][\w$]*\s*=/.test(part),
    );
    if (positional !== undefined) pathExpr = positional;
  }

  const method = extractMethod(text);

  if (pathExpr === null) return { paths: [''], method, literal: true };

  const paths = parseStringList(pathExpr);
  if (paths === null) return { paths: [], method, literal: false };

  return { paths, method, literal: true };
}

function extractMethod(text) {
  const attributes = text.match(/\bmethod\s*=\s*([\s\S]*)$/);
  if (!attributes) return null;

  const names = [];
  for (const match of attributes[1].matchAll(/RequestMethod\.([A-Za-z]+)/g)) {
    names.push(match[1].toUpperCase());
  }

  return names.length > 0 ? names.join('|') : null;
}

/**
 * Split on a separator that sits outside strings, braces, brackets and parens.
 */
function splitTopLevel(text, separator = ',') {
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipLiteral(text, i);
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(text.slice(start));
  return parts;
}

/**
 * Turn a plain string literal or an array of literals into a list of paths.
 * Returns null when the expression needs constant resolution.
 */
function parseStringList(expr) {
  const literals = [];
  for (const match of expr.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    literals.push(unescapeLiteral(match[1]));
  }

  const rest = expr.replace(/"(?:[^"\\]|\\.)*"/g, '').replace(/[{},\s]/g, '');
  if (rest !== '' || literals.length === 0) return null;

  return literals;
}

function unescapeLiteral(value) {
  return value.replace(/\\(["'\\])/g, '$1');
}

function joinPaths(prefix, path) {
  let joined = `${prefix ?? ''}/${path ?? ''}`.replace(/\/{2,}/g, '/');
  if (!joined.startsWith('/')) joined = `/${joined}`;
  if (joined.length > 1) joined = joined.replace(/\/+$/, '');
  return joined || '/';
}

function lineOf(code, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (code[i] === '\n') line += 1;
  }
  return line;
}