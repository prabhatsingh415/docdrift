const RESET_FG = '\x1b[39m';

const PALETTE = {
  cyan: [34, 211, 238],
  violet: [167, 139, 250],
  amber: [251, 191, 36],
  pink: [251, 113, 133],
  gray: [156, 163, 175],
};

const FALLBACK = {
  cyan: '\x1b[96m',
  violet: '\x1b[95m',
  amber: '\x1b[93m',
  pink: '\x1b[91m',
  gray: '\x1b[90m',
};

/**
 * Decide whether ANSI colors should be used for a stream.
 * FORCE_COLOR (non-empty, not "0") wins over everything else.
 */
export function shouldUseColor(stream, env = process.env, argv = []) {
  if (env?.FORCE_COLOR && env.FORCE_COLOR !== '0') return true;
  if (!stream || !stream.isTTY) return false;
  if (env?.NO_COLOR !== undefined) return false;
  if (Array.isArray(argv) && argv.includes('--no-color')) return false;
  return true;
}

export function supportsTrueColor(env = process.env) {
  return (
    env?.COLORTERM === 'truecolor' ||
    env?.COLORTERM === '24bit' ||
    Boolean(env?.WT_SESSION)
  );
}

/**
 * Build a tiny ANSI style kit. When disabled every helper is the identity.
 */
export function createStyle(enabled, trueColor) {
  const wrap = (open, close, text) =>
    enabled ? `${open}${String(text)}${close}` : String(text);

  const cyan = (text) => wrap('\x1b[36m', RESET_FG, text);

  const paint = (rgb, fallbackOpen) => (text) => {
    if (!enabled) return String(text);
    if (!trueColor) return `${fallbackOpen}${String(text)}${RESET_FG}`;
    const [r, g, b] = rgb;
    return `\x1b[38;2;${r};${g};${b}m${String(text)}${RESET_FG}`;
  };

  return {
    enabled: Boolean(enabled),
    trueColor: Boolean(trueColor),

    bold: (text) => wrap('\x1b[1m', '\x1b[22m', text),
    dim: (text) => wrap('\x1b[2m', '\x1b[22m', text),
    red: (text) => wrap('\x1b[31m', RESET_FG, text),
    green: (text) => wrap('\x1b[32m', RESET_FG, text),
    yellow: (text) => wrap('\x1b[33m', RESET_FG, text),
    cyan,
    magenta: (text) => wrap('\x1b[35m', RESET_FG, text),

    success: paint(PALETTE.cyan, FALLBACK.cyan),
    accent: paint(PALETTE.violet, FALLBACK.violet),
    warning: paint(PALETTE.amber, FALLBACK.amber),
    danger: paint(PALETTE.pink, FALLBACK.pink),
    muted: paint(PALETTE.gray, FALLBACK.gray),

    rgb(r, g, b, text) {
      if (!enabled) return String(text);
      if (!trueColor) return cyan(text);
      return `\x1b[38;2;${r};${g};${b}m${String(text)}${RESET_FG}`;
    },

    gradient(text, from, to) {
      const value = String(text);
      if (!enabled) return value;
      if (!trueColor) return cyan(value);
      if (value.length === 0) return value;

      let painted = '';
      for (let i = 0; i < value.length; i += 1) {
        const ratio = value.length === 1 ? 0 : i / (value.length - 1);
        const r = Math.round(from[0] + (to[0] - from[0]) * ratio);
        const g = Math.round(from[1] + (to[1] - from[1]) * ratio);
        const b = Math.round(from[2] + (to[2] - from[2]) * ratio);
        painted += `\x1b[38;2;${r};${g};${b}m${value[i]}`;
      }
      return `${painted}${RESET_FG}`;
    },
  };
}