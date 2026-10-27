import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createStyle,
  shouldUseColor,
  supportsTrueColor,
} from '../src/style.js';
import { compactBanner, fullBanner } from '../src/banner.js';
import { check } from '../src/check.js';

const here = dirname(fileURLToPath(import.meta.url));
const ANSI = /\x1b\[[0-9;]*m/g;

test('createStyle(false) returns every input unchanged', () => {
  const style = createStyle(false, true);
  const text = 'plain text';

  assert.equal(style.enabled, false);
  assert.equal(style.bold(text), text);
  assert.equal(style.dim(text), text);
  assert.equal(style.red(text), text);
  assert.equal(style.green(text), text);
  assert.equal(style.yellow(text), text);
  assert.equal(style.cyan(text), text);
  assert.equal(style.magenta(text), text);
  assert.equal(style.rgb(1, 2, 3, text), text);
  assert.equal(style.gradient(text, [0, 0, 0], [255, 255, 255]), text);
  assert.equal(style.success(text), text);
  assert.equal(style.accent(text), text);
  assert.equal(style.warning(text), text);
  assert.equal(style.danger(text), text);
  assert.equal(style.muted(text), text);
});

test('createStyle(true, true) wraps text in ANSI codes', () => {
  const style = createStyle(true, true);

  assert.equal(style.red('x'), '\x1b[31mx\x1b[39m');
  assert.equal(style.bold('x'), '\x1b[1mx\x1b[22m');
  assert.equal(style.rgb(1, 2, 3, 'x'), '\x1b[38;2;1;2;3mx\x1b[39m');

  const gradient = style.gradient('ab', [0, 0, 0], [255, 255, 255]);
  assert.match(gradient, /\x1b\[38;2;\d+;\d+;\d+m/);
  assert.ok(gradient.endsWith('\x1b[39m'));
});

test('the DocDrift palette uses true color when available', () => {
  const style = createStyle(true, true);

  assert.equal(style.success('x'), '\x1b[38;2;34;211;238mx\x1b[39m');
  assert.equal(style.accent('x'), '\x1b[38;2;167;139;250mx\x1b[39m');
  assert.equal(style.warning('x'), '\x1b[38;2;251;191;36mx\x1b[39m');
  assert.equal(style.danger('x'), '\x1b[38;2;251;113;133mx\x1b[39m');
  assert.equal(style.muted('x'), '\x1b[38;2;156;163;175mx\x1b[39m');
});

test('the palette falls back to bright ANSI colors', () => {
  const style = createStyle(true, false);

  assert.equal(style.success('x'), '\x1b[96mx\x1b[39m');
  assert.equal(style.accent('x'), '\x1b[95mx\x1b[39m');
  assert.equal(style.warning('x'), '\x1b[93mx\x1b[39m');
  assert.equal(style.danger('x'), '\x1b[91mx\x1b[39m');
  assert.equal(style.muted('x'), '\x1b[90mx\x1b[39m');
});

test('shouldUseColor follows TTY, NO_COLOR, --no-color and FORCE_COLOR', () => {
  assert.equal(shouldUseColor({ isTTY: false }, {}, []), false);
  assert.equal(shouldUseColor({ isTTY: true }, { NO_COLOR: '1' }, []), false);
  assert.equal(
    shouldUseColor({ isTTY: true }, {}, ['--no-color']),
    false,
  );
  assert.equal(
    shouldUseColor({ isTTY: true }, { FORCE_COLOR: '1' }, []),
    true,
  );
  assert.equal(
    shouldUseColor({ isTTY: false }, { FORCE_COLOR: '1' }, []),
    true,
  );
  assert.equal(shouldUseColor({ isTTY: true }, {}, []), true);
});

test('supportsTrueColor detects truecolor terminals', () => {
  assert.equal(supportsTrueColor({ COLORTERM: 'truecolor' }), true);
  assert.equal(supportsTrueColor({ COLORTERM: '24bit' }), true);
  assert.equal(supportsTrueColor({ WT_SESSION: 'abc' }), true);
  assert.equal(supportsTrueColor({}), false);
});

test('every fullBanner line has the same width of at most 78 columns', () => {
  const banner = fullBanner(createStyle(true, true), '0.1.0');
  const widths = banner
    .split('\n')
    .map((line) => line.replace(ANSI, '').length);

  assert.ok(widths.length > 0);
  assert.ok(widths.every((width) => width === widths[0]));
  assert.ok(widths[0] <= 78);
});

test('compactBanner is a single line with the version', () => {
  const line = compactBanner(createStyle(true, true), '1.2.3');

  assert.equal(line.includes('\n'), false);
  assert.ok(line.replace(ANSI, '').includes('DocDrift'));
  assert.ok(line.replace(ANSI, '').includes('v1.2.3'));
});

test('plain check output is identical to before', () => {
  const { report } = check(join(here, 'fixtures-check'));

  assert.equal(
    report,
    [
      'docdrift check: 3 code endpoints, 3 documented endpoints, 2 matched',
      '',
      'STALE (documented, not in code)',
      '  GET    /api/legacy (README.md:7)',
      '',
      'UNDOCUMENTED (in code, not documented)',
      '  DELETE /api/users/{id} (UserController.java:15)',
    ].join('\n'),
  );
});