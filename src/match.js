/**
 * Normalise a path for comparison: drop the query string, turn {name} and
 * :name parameters into {}, collapse repeated slashes and drop a trailing
 * slash. Paths stay case-sensitive.
 */
export function normalizePath(path) {
  let normalized = String(path ?? '').split('?')[0];

  normalized = normalized.replace(/\{[^}]*\}/g, '{}');
  normalized = normalized.replace(/:[A-Za-z_$][\w$]*/g, '{}');
  normalized = normalized.replace(/\/{2,}/g, '/');

  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '');

  return normalized || '/';
}

function methodsOf(endpoint) {
  return String(endpoint.method ?? '')
    .split('|')
    .map((method) => method.trim())
    .filter(Boolean);
}

function methodsMatch(codeMethod, docMethod) {
  return (
    codeMethod === 'ANY' ||
    docMethod === 'ANY' ||
    codeMethod === docMethod
  );
}

/**
 * Compare code endpoints with documented endpoints.
 *
 * @param {{ method: string, path: string, file: string, line: number }[]} codeEndpoints
 * @param {{ method: string, path: string, file: string, line: number }[]} docEndpoints
 * @returns {{ matched: number, stale: object[], undocumented: object[] }}
 */
export function compare(codeEndpoints, docEndpoints) {
  const code = Array.isArray(codeEndpoints) ? codeEndpoints : [];
  const docs = Array.isArray(docEndpoints) ? docEndpoints : [];

  const docKeys = docs.map((endpoint) => normalizePath(endpoint.path));
  const matchedDocs = new Set();
  const undocumented = [];
  let matched = 0;

  for (const endpoint of code) {
    const codePath = normalizePath(endpoint.path);
    let found = false;

    for (const codeMethod of methodsOf(endpoint)) {
      for (let i = 0; i < docs.length; i += 1) {
        if (docKeys[i] !== codePath) continue;
        if (!methodsMatch(codeMethod, docs[i].method)) continue;

        found = true;
        if (!matchedDocs.has(i)) {
          matchedDocs.add(i);
          matched += 1;
        }
      }
    }

    if (!found) undocumented.push(endpoint);
  }

  const stale = docs.filter((_, index) => !matchedDocs.has(index));

  return { matched, stale, undocumented };
}