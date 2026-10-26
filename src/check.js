import { relative, sep } from 'node:path';

import { scanJava } from './scan.js';
import { scanDocs } from './docs.js';
import { compare } from './match.js';

/**
 * Run the whole drift check for a project directory.
 *
 * @param {string} codeDir directory with .java sources
 * @param {string} [docsDir] directory with README.md/docs, defaults to codeDir
 * @returns {{ report: string, exitCode: number, code: object[], docs: object[], result: object }}
 */
export function check(codeDir, docsDir = codeDir) {
  const code = scanJava(codeDir);
  const docs = scanDocs(docsDir);

  if (docs.length === 0) {
    return {
      code,
      docs,
      result: { matched: 0, stale: [], undocumented: [] },
      report: `No endpoints are documented in ${docsDir}, nothing to compare (${code.length} endpoints found in code).`,
      exitCode: 0,
    };
  }

  const result = compare(code, docs);
  const drift = result.stale.length + result.undocumented.length;

  const lines = [
    `docdrift check: ${code.length} code endpoints, ${docs.length} documented endpoints, ${result.matched} matched`,
    '',
  ];

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
      lines.push(...formatEndpointList(result.undocumented, codeDir, methodWidth));
      lines.push('');
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
export function formatEndpointList(endpoints, baseDir, methodWidth = 0) {
  return [...endpoints]
    .sort(
      (a, b) =>
        compareText(a.path, b.path) || compareText(a.method, b.method),
    )
    .map(
      (endpoint) =>
        `  ${endpoint.method.padEnd(methodWidth)} ${endpoint.path} (${relativeFile(baseDir, endpoint.file)}:${endpoint.line})`,
    );
}

function relativeFile(baseDir, file) {
  return relative(baseDir, file).split(sep).join('/');
}

function compareText(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}