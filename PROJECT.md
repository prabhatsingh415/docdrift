# DocDrift

A Node.js CLI (plain JavaScript ESM, zero external dependencies) that extracts Spring Boot REST endpoints from .java files and compares them with the endpoints documented in README.md and docs/*.md.

## How it works

- STALE = documented in the docs but not present in the code.

- UNDOCUMENTED = present in the code but not documented.

- Both are detected purely from the code and the docs, with no AI involved (VERIFIED).

- AI is only used to write text: a Writer agent drafts a README fix, and a verifier checks that the draft mentions only endpoints that exist in the code. AI text is UNVERIFIED until it passes that check.

## Scope

- Only Spring Boot REST endpoints (@GetMapping, @PostMapping, @PutMapping, @DeleteMapping, @PatchMapping, @RequestMapping with a class-level prefix).

- No UI, no database, no login.

## Rules

- Keep everything simple. Do not over-engineer.

- No npm dependencies. Use only Node.js built-ins (Node 22, ESM, node:test, fetch).

- Work only inside this folder. Never read or touch files outside it, and never touch .env files or keys.