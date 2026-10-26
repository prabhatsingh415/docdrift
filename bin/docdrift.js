#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { scanJava } from '../src/scan.js';
import { scanDocs, extractFromText } from '../src/docs.js';
import { check } from '../src/check.js';
import { loadConfig } from '../src/config.js';
import { chat } from '../src/llm.js';
import {
  buildWriterMessages,
  fixDocs,
  writeDriftFile,
} from '../src/fix.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [command, target, docsTarget] = args.filter((arg) => arg !== '--dry-run');

const commands = { scan: scanJava, docs: scanDocs };

if (command === 'fix') {
  if (!target) {
    console.error('usage: docdrift fix <codeDir> [docsDir] [--dry-run]');
    process.exitCode = 1;
  } else {
    process.exitCode = await runFix(target, docsTarget ?? target, dryRun);
  }
} else if (command === 'check') {
  if (!target) {
    console.error('usage: docdrift check <codeDir> [docsDir]');
    process.exitCode = 1;
  } else {
    try {
      const { report, exitCode } = check(target, docsTarget ?? target);
      process.stdout.write(`${report}\n`);
      process.exitCode = exitCode;
    } catch (error) {
      console.error(`docdrift: ${error.message}`);
      process.exitCode = 1;
    }
  }
} else if (!target || !Object.hasOwn(commands, command)) {
  console.error('usage: docdrift <scan|docs|check|fix> <dir>');
  process.exitCode = 1;
} else {
  try {
    const endpoints = commands[command](target);
    process.stdout.write(`${JSON.stringify(endpoints, null, 2)}\n`);
  } catch (error) {
    console.error(`docdrift: ${error.message}`);
    process.exitCode = 1;
  }
}

async function runFix(codeDir, docsDir, isDryRun) {
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
  const codeEndpoints = scanJava(codeDir);
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

    if (result.status === 'NO_DRIFT') {
      process.stdout.write('No drift found.\n');
      return 0;
    }

    const draftPath = writeDriftFile(readmePath, result.draft);
    process.stdout.write(`${result.status}\n${draftPath}\n`);

    if (result.status === 'UNVERIFIED') {
      for (const endpoint of result.invented) {
        process.stdout.write(`  invented: ${endpoint.method} ${endpoint.path}\n`);
      }
      for (const endpoint of result.missing) {
        process.stdout.write(`  missing: ${endpoint.method} ${endpoint.path}\n`);
      }
      for (const endpoint of result.leftover) {
        process.stdout.write(`  leftover: ${endpoint.method} ${endpoint.path}\n`);
      }
      return 1;
    }

    return 0;
  } catch (error) {
    console.error(`docdrift: ${error.message}`);
    return 1;
  }
}