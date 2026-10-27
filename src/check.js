import { relative, sep } from 'node:path';

import { scanJava } from './scan.js';
import { scanDocs } from './docs.js';
import { compare, normalizePath } from './match.js';

const FRAMEWORK_PREFIXES = [
  '/actuator',
  '/swagger-ui',
  '/v3/api-docs',
  '/v2/api-docs',
  '/swagger-resources',
  '/h2-console',
  '/error',
];

/**
 * Run the whole drift check for a project directory.
 *
 * @param {string} codeDir directory with .java sources
 * @param {string} [docsDir] directory with README.md/docs, defaults to codeDir
 * @param {object | null} [style] optional createStyle() result for colored output
 * @param {{ strict?: boolean, codeEndpoints?: object[] }} [options] strict reports framework endpoints as stale
 * @returns {{ report: string, exitCode: number, code: object[], docs: object[], result: object }}
 */
export function check(codeDir, docsDir = codeDir, style = null, options = {}) {
  const code = Array.isArray(options.codeEndpoints)
    ? options.codeEndpoints
    : scanJava(codeDir);
  const docs = scanDocs(docsDir);

  if (docs.length === 0) {
    const message = `No endpoints are documented in ${docsDir}, nothing to compare (${code.length} endpoints found in code).`;
    return {
      code,
      docs,
      result: { matched: 0, stale: [], undocumented: [] },
      report: style?.enabled ? style.warning(message) : message,
      exitCode: 0,
    };
  }

  const result = compare(code, docs);
  const strict = options.strict === true;
  const stale = strict
    ? result.stale
    : result.stale.filter((endpoint) => !isFrameworkPath(endpoint.path));
  const ignored = strict
    ? []
    : result.stale.filter((endpoint) => isFrameworkPath(endpoint.path));
  const undocumented = result.undocumented;
  const drift = stale.length + undocumented.length;
  const documentedCount = new Set(
    docs.map(
      (endpoint) => `${endpoint.method} ${normalizePath(endpoint.path)}`,
    ),
  ).size;
  const matchedCount = Math.min(countMatched(code, docs), code.length);
  const ignoredText = ignored.length > 0 ? frameworkLine(ignored) : null;
  const lines = [];

  if (style?.enabled) {
    lines.push(
      `${style.muted('docdrift check:')} ${style.bold(style.success(String(code.length)))} code endpoints, ${style.bold(style.success(String(documentedCount)))} documented endpoints, ${style.bold(style.success(String(matchedCount)))} matched`,
    );
    if (ignoredText) lines.push(ignoredText);
    lines.push('');

    if (drift > 0) {
      const methodWidth = Math.max(
        0,
        ...stale.map((endpoint) => endpoint.method.length),
        ...undocumented.map((endpoint) => endpoint.method.length),
      );

      if (stale.length > 0) {
        lines.push(style.danger('STALE (documented, not in code)'));
        lines.push(...formatEndpointList(stale, docsDir, methodWidth, style));
        lines.push('');
      }

      if (undocumented.length > 0) {
        lines.push(style.danger('UNDOCUMENTED (in code, not documented)'));
        lines.push(
          ...formatEndpointList(
            undocumented,
            codeDir,
            methodWidth,
            style,
          ),
        );
        lines.push('');
      }
    }

    lines.push(
      drift === 0
        ? style.success('✔ No drift found')
        : style.danger(
            `✖ ${stale.length} stale, ${undocumented.length} undocumented`,
          ),
    );
  } else {
    lines.push(
      `docdrift check: ${code.length} code endpoints, ${documentedCount} documented endpoints, ${matchedCount} matched`,
    );
    if (ignoredText) lines.push(ignoredText);
    lines.push('');

    if (drift === 0) {
      lines.push('No drift found.');
    } else {
      const methodWidth = Math.max(
        0,
        ...stale.map((endpoint) => endpoint.method.length),
        ...undocumented.map((endpoint) => endpoint.method.length),
      );

      if (stale.length > 0) {
        lines.push('STALE (documented, not in code)');
        lines.push(...formatEndpointList(stale, docsDir, methodWidth));
        lines.push('');
      }

      if (undocumented.length > 0) {
        lines.push('UNDOCUMENTED (in code, not documented)');
        lines.push(
          ...formatEndpointList(undocumented, codeDir, methodWidth),
        );
        lines.push('');
      }
    }
  }

  return {
    code,
    docs,
    result,
    report: lines.join('\n').trimEnd(),
    exitCode: drift === 0 ? 0 : 1,
  };
}

// Count each documented (METHOD, normalised path) once, so a duplicate entry
// does not inflate the header, and never exceed the number of code endpoints.
function countMatched(codeEndpoints, docEndpoints) {
  const matchedKeys = new Set();

  for (const docEndpoint of docEndpoints) {
    if (
      codeEndpoints.some((codeEndpoint) =>
        codeCovers(codeEndpoint, docEndpoint),
      )
    ) {
      matchedKeys.add(
        `${docEndpoint.method} ${normalizePath(docEndpoint.path)}`,
      );
    }
  }

  return matchedKeys.size;
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

function isFrameworkPath(path) {
  const normalized = normalizePath(path);
  return FRAMEWORK_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function frameworkLine(endpoints) {
  const labels = [...endpoints]
    .sort(
      (a, b) =>
        compareText(normalizePath(a.path), normalizePath(b.path)) ||
        compareText(a.method, b.method),
    )
    .map((endpoint) => `${endpoint.method} ${endpoint.path}`);

  return `Ignored ${endpoints.length} framework endpoint(s) documented but provided by libraries: ${labels.join(', ')}`;
}

/**
 * Format endpoints as "METHOD PATH (relative/file.java:line)", sorted by path
 * and then method, with the method column padded to align the paths.
 */
export function formatEndpointList(
  endpoints,
  baseDir,
  methodWidth = 0,
  style = null,
) {
  return [...endpoints]
    .sort(
      (a, b) =>
        compareText(a.path, b.path) || compareText(a.method, b.method),
    )
    .map((endpoint) => {
      const method = endpoint.method.padEnd(methodWidth);
      const where = `${relativeFile(baseDir, endpoint.file)}:${endpoint.line}`;

      if (style?.enabled) {
        return `  ${style.success(method)} ${endpoint.path} (${style.muted(where)})`;
      }

      return `  ${method} ${endpoint.path} (${where})`;
    });
}

function relativeFile(baseDir, file) {
  return relative(baseDir, file).split(sep).join('/');
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}