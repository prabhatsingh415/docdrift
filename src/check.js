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
    if (result.stale.length > 0) {
      lines.push('STALE (documented, not in code)');
      for (const endpoint of result.stale) {
        lines.push(`  ${endpoint.method} ${endpoint.path} (${endpoint.file}:${endpoint.line})`);
      }
      lines.push('');
    }

    if (result.undocumented.length > 0) {
      lines.push('UNDOCUMENTED (in code, not documented)');
      for (const endpoint of result.undocumented) {
        lines.push(`  ${endpoint.method} ${endpoint.path} (${endpoint.file}:${endpoint.line})`);
      }
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