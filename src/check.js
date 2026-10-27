import { relative, sep } from 'node:path';

import { scanJava } from './scan.js';
import { scanDocs } from './docs.js';
import { compare } from './match.js';

/**
 * Run the whole drift check for a project directory.
 *
 * @param {string} codeDir directory with .java sources
 * @param {string} [docsDir] directory with README.md/docs, defaults to codeDir
 * @param {object | null} [style] optional createStyle() result for colored output
 * @returns {{ report: string, exitCode: number, code: object[], docs: object[], result: object }}
 */
export function check(codeDir, docsDir = codeDir, style = null) {
  const code = scanJava(codeDir);
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
  const drift = result.stale.length + result.undocumented.length;
  const lines = [];

  if (style?.enabled) {
    lines.push(
      `${style.muted('docdrift check:')} ${style.bold(style.success(String(code.length)))} code endpoints, ${style.bold(style.success(String(docs.length)))} documented endpoints, ${style.bold(style.success(String(result.matched)))} matched`,
    );
    lines.push('');

    if (drift > 0) {
      const methodWidth = Math.max(
        0,
        ...result.stale.map((endpoint) => endpoint.method.length),
        ...result.undocumented.map((endpoint) => endpoint.method.length),
      );

      if (result.stale.length > 0) {
        lines.push(style.danger('STALE (documented, not in code)'));
        lines.push(
          ...formatEndpointList(result.stale, docsDir, methodWidth, style),
        );
        lines.push('');
      }

      if (result.undocumented.length > 0) {
        lines.push(style.danger('UNDOCUMENTED (in code, not documented)'));
        lines.push(
          ...formatEndpointList(
            result.undocumented,
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
            `✖ ${result.stale.length} stale, ${result.undocumented.length} undocumented`,
          ),
    );
  } else {
    lines.push(
      `docdrift check: ${code.length} code endpoints, ${docs.length} documented endpoints, ${result.matched} matched`,
      '',
    );

    if (drift === 0) {
      lines.push('No drift found.');
    } else {
      const methodWidth = Math.max(
        0,
        ...result.stale.map((endpoint) => endpoint.method.length),
        ...result.undocumented.map((endpoint) => endpoint.method.length),
      );

      if (result.stale.length > 0) {
        lines.push('STALE (documented, not in code)');
        lines.push(...formatEndpointList(result.stale, docsDir, methodWidth));
        lines.push('');
      }

      if (result.undocumented.length > 0) {
        lines.push('UNDOCUMENTED (in code, not documented)');
        lines.push(
          ...formatEndpointList(result.undocumented, codeDir, methodWidth),
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