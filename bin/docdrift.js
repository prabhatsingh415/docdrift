#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { scanJava } from '../src/scan.js';
import { scanDocs, extractFromText } from '../src/docs.js';
import { check } from '../src/check.js';
import { compare } from '../src/match.js';
import { loadConfig } from '../src/config.js';
import { chat } from '../src/llm.js';
import {
  buildWriterMessages,
  fixDocs,
  formatFixReport,
  writeDriftFile,
} from '../src/fix.js';
import { createStyle, shouldUseColor, supportsTrueColor } from '../src/style.js';
import { compactBanner, fullBanner } from '../src/banner.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

const rawArgs = process.argv.slice(2);
const style = createStyle(
  shouldUseColor(process.stdout, process.env, rawArgs),
  supportsTrueColor(process.env),
);

if (rawArgs.includes('--help')) {
  process.stdout.write(`${fullBanner(style, version)}\n\n${helpText()}\n`);
} else if (rawArgs.includes('--version')) {
  process.stdout.write(`${fullBanner(style, version)}\n`);
} else {
  const flags = new Set(['--dry-run', '--no-color', '--strict']);
  const [command, target, docsTarget] = rawArgs.filter(
    (arg) => !flags.has(arg),
  );
  const commands = { scan: scanJava, docs: scanDocs };

  if (command === undefined) {
    process.stdout.write(`${fullBanner(style, version)}\n\n${helpText()}\n`);
    process.exitCode = 1;
  } else if (command === 'fix') {
    process.exitCode = await runFix(
      target ?? '.',
      docsTarget,
      rawArgs.includes('--dry-run'),
      style,
    );
  } else if (command === 'check') {
    const codeDir = target ?? '.';
    const docsDir = docsTarget ?? codeDir;

    try {
      const codeEndpoints = scanJava(codeDir);
      if (codeEndpoints.length === 0) {
        console.error(noEndpointsMessage(codeDir));
        process.exitCode = 2;
      } else {
        if (style.enabled) {
          process.stdout.write(`${compactBanner(style, version)}\n\n`);
        }
        const { report, exitCode } = check(
          codeDir,
          docsDir,
          style.enabled ? style : null,
          {
            strict: rawArgs.includes('--strict'),
            codeEndpoints,
          },
        );
        process.stdout.write(`${report}\n`);
        process.exitCode = exitCode;
      }
    } catch (error) {
      console.error(`docdrift: ${error.message}`);
      process.exitCode = 1;
    }
  } else if (!Object.hasOwn(commands, command)) {
    console.error('usage: docdrift <scan|docs|check|fix> [dir]');
    process.exitCode = 1;
  } else {
    try {
      const endpoints = commands[command](target ?? '.');
      process.stdout.write(`${JSON.stringify(endpoints, null, 2)}\n`);
    } catch (error) {
      console.error(`docdrift: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

async function runFix(codeDir, docsTarget, isDryRun, style) {
  const docsDir = docsTarget ?? codeDir;

  let codeEndpoints;
  try {
    codeEndpoints = scanJava(codeDir);
  } catch (error) {
    console.error(`docdrift: ${error.message}`);
    return 1;
  }

  if (codeEndpoints.length === 0) {
    console.error(noEndpointsMessage(codeDir));
    return 2;
  }

  if (style.enabled) {
    process.stdout.write(`${compactBanner(style, version)}\n\n`);
  }

  let readmeName;
  try {
    readmeName = readdirSync(docsDir).find(
      (name) => name.toLowerCase() === 'readme.md',
    );
  } catch (error) {
    console.error(`docdrift: ${error.message}`);
    return 1;
  }

  if (!readmeName) {
    console.error(`docdrift: no README.md found in ${docsDir}`);
    return 1;
  }

  const readmePath = join(docsDir, readmeName);
  const readmeText = readFileSync(readmePath, 'utf8');
  const docEndpoints = extractFromText(readmeText).map((endpoint) => ({
    ...endpoint,
    file: readmePath,
  }));

  if (isDryRun) {
    const messages = buildWriterMessages({
      codeEndpoints,
      docEndpoints,
      readmeText,
    });
    for (const message of messages) {
      process.stdout.write(`[${message.role}]\n${message.content}\n\n`);
    }
    return 0;
  }

  const config = loadConfig();
  if (config.error) {
    console.error(`docdrift: ${config.error}`);
    return 2;
  }

  try {
    const result = await fixDocs({
      codeEndpoints,
      docEndpoints,
      readmeText,
      chatFn: (messages) => chat(config, messages),
    });

    const { stale, undocumented } = compare(codeEndpoints, docEndpoints);

    if (result.status === 'NO_DRIFT') {
      process.stdout.write(
        `${formatFixReport(
          {
            status: result.status,
            model: config.model,
            attempts: 0,
            staleRemoved: 0,
            undocumentedAdded: 0,
            draftPath: null,
          },
          style.enabled ? style : null,
        )}\n`,
      );
      return 0;
    }

    const draftPath = writeDriftFile(readmePath, result.draft);
    process.stdout.write(
      `${formatFixReport(
        {
          status: result.status,
          model: config.model,
          attempts: result.attempts,
          staleRemoved: stale.length - result.leftover.length,
          undocumentedAdded: undocumented.length - result.missing.length,
          draftPath,
          invented: result.invented,
          missing: result.missing,
          leftover: result.leftover,
        },
        style.enabled ? style : null,
      )}\n`,
    );

    return result.status === 'VERIFIED' ? 0 : 1;
  } catch (error) {
    console.error(`docdrift: ${error.message}`);
    return 1;
  }
}

function noEndpointsMessage(codeDir) {
  const label =
    codeDir === '.' ? basename(process.cwd()) || codeDir : codeDir;
  return `No Spring REST endpoints found in "${label}" - run docdrift from your project root or pass the path: docdrift check <codeDir> [docsDir]`;
}

function helpText() {
  return [
    'Usage: docdrift <command> [paths] [options]',
    '',
    'Commands:',
    '  scan [dir]                        Print code endpoints as JSON',
    '  docs [dir]                        Print documented endpoints as JSON',
    '  check [codeDir] [docsDir]         Compare code against docs',
    '  fix [codeDir] [docsDir]           Draft a verified README fix',
    '',
    'Options:',
    '  --strict                          Report Spring framework endpoints as STALE',
    '  --dry-run                         Print the writer prompt, no API call',
    '  --no-color                        Disable ANSI colors',
    '',
    'Environment for fix:',
    '  DOCDRIFT_API_KEY',
    '  DOCDRIFT_BASE_URL',
    '  DOCDRIFT_MODEL',
  ].join('\n');
}