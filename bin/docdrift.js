#!/usr/bin/env node
import { scanJava } from '../src/scan.js';

const [command, target] = process.argv.slice(2);

if (command !== 'scan' || !target) {
  console.error('usage: docdrift scan <dir>');
  process.exitCode = 1;
} else {
  try {
    const endpoints = scanJava(target);
    process.stdout.write(`${JSON.stringify(endpoints, null, 2)}\n`);
  } catch (error) {
    console.error(`docdrift: ${error.message}`);
    process.exitCode = 1;
  }
}