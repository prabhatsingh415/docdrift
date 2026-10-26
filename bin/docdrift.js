#!/usr/bin/env node
import { scanJava } from '../src/scan.js';
import { scanDocs } from '../src/docs.js';
import { check } from '../src/check.js';

const [command, target, docsTarget] = process.argv.slice(2);

const commands = { scan: scanJava, docs: scanDocs };

if (command === 'check') {
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
  console.error('usage: docdrift <scan|docs|check> <dir>');
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