const WIDTH = 76;
const LETTER_GAP = '  ';
const WORD_GAP = '    ';

const GLYPHS = {
  D: ['######', '#    #', '#    #', '#    #', '#    #', '#    #', '######'],
  O: [' #### ', '#    #', '#    #', '#    #', '#    #', '#    #', ' #### '],
  C: [' #####', '#     ', '#     ', '#     ', '#     ', '#     ', ' #####'],
  R: ['##### ', '#    #', '#    #', '##### ', '#  #  ', '#   # ', '#    #'],
  I: ['######', '  ##  ', '  ##  ', '  ##  ', '  ##  ', '  ##  ', '######'],
  F: ['######', '#     ', '#     ', '##### ', '#     ', '#     ', '#     '],
  T: ['######', '  ##  ', '  ##  ', '  ##  ', '  ##  ', '  ##  ', '  ##  '],
};

const WORDMARK_ROWS = Array.from({ length: 7 }, (_, row) =>
  ['DOC', 'DRIFT']
    .map((word) =>
      word
        .split('')
        .map((letter) => GLYPHS[letter][row])
        .join(LETTER_GAP),
    )
    .join(WORD_GAP),
);

function centered(text, paint) {
  const padding = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  const right = Math.max(0, WIDTH - padding - text.length);
  return `${' '.repeat(padding)}${paint(text)}${' '.repeat(right)}`;
}

function paintWordmark(style, text) {
  if (!style.enabled) return text;
  return style.bold(style.success(text));
}

/**
 * Full DocDrift branding: the wordmark is the whole identity.
 *
 * @param {ReturnType<import('./style.js').createStyle>} style
 * @param {string} version
 * @returns {string}
 */
export function fullBanner(style, version = '0.0.0') {
  const rows = WORDMARK_ROWS.map((row) =>
    centered(row, (text) => paintWordmark(style, text)),
  );

  rows.push(centered("Code changes. Docs don't.", (text) => style.muted(text)));
  rows.push(centered(`v${version}`, (text) => style.muted(text)));

  return rows.join('\n');
}

/**
 * One-line branding for the start of colored check/fix runs.
 */
export function compactBanner(style, version = '0.0.0') {
  return `${style.bold(style.success('DocDrift'))} ${style.muted(`v${version}`)}`;
}