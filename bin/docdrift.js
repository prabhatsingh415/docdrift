#!/usr/bin/env node
import { scanJava } from '../src/scan.js';
import { scanDocs } from '../src/docs.js';

const [command, target] = process.argv.slice(2);

const commands = { scan: scanJava, docs: scanDocs };

if (!target || !Object.hasOwn(commands, command)) {
  console.error('usage: docdrift <scan|docs> <dir>');
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