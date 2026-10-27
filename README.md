# DocDrift

Find stale and undocumented REST endpoints by comparing your Spring Boot code with your docs.

## Why DocDrift?

Docs drift from Spring Boot controllers silently: routes get renamed, removed or added without a README update.
DocDrift finds stale and undocumented endpoints deterministically, with no AI in the detection path.
AI is used only to draft the fix, and a code-based verifier checks that draft before it is marked VERIFIED.

## Quick start

```bash
cd my-spring-app
npx @prabhat-singh/docdrift check
```

Or install it in your project with `npm i @prabhat-singh/docdrift` and run `npx docdrift check`.

That scans every `.java` file under the current folder and compares it with `README.md` and `docs/*.md` in that folder.

If the docs live elsewhere:

```bash
docdrift check ./my-spring-app/src/main/java ./path/to/docs
```

## What it does

- **STALE** - an endpoint is documented but not present in the code.
- **UNDOCUMENTED** - an endpoint exists in the code but is not documented.

Both come straight from the code and the docs, with no AI involved.

AI is optional and only used to draft a README fix. A code-based verifier checks the draft: it must mention only endpoints that exist in the code, remove stale ones and add undocumented ones. Until that check passes, the draft is **UNVERIFIED**. The original README is never overwritten - the draft is written to `README.drift.md`.

## Install

Project install:

```bash
npm i @prabhat-singh/docdrift
npx docdrift check
```

One-off run:

```bash
npx @prabhat-singh/docdrift check .
```

Global install:

```bash
npm install -g @prabhat-singh/docdrift
```

After a global install, use `docdrift ...` directly. Requires Node 18+. Zero dependencies.

## Usage

```bash
docdrift scan
docdrift docs
docdrift check
docdrift fix
```

Run these from your project root. All four commands also accept optional paths: `scan [dir]`, `docs [dir]`, `check [codeDir] [docsDir]`, and `fix [codeDir] [docsDir]`.

- `scan [dir]` - print the endpoints found in `.java` files as JSON.
- `docs [dir]` - print the endpoints documented in `README.md` and `docs/*.md` as JSON.
- `check [codeDir] [docsDir]` - compare code and docs and print a report. `docsDir` defaults to `codeDir`.
- `fix [codeDir] [docsDir]` - ask a model to draft a fixed README, verify the draft, and write it to `README.drift.md`.

Flags:

- `--dry-run` - print the writer prompt for `fix` without calling any model.
- `--strict` - report Spring framework endpoints as STALE instead of ignoring them.
- `--no-color` - disable ANSI colors.

Exit codes:

- `check`: `1` when drift is found, `0` otherwise.
- `fix`: `0` for VERIFIED or NO_DRIFT, `1` for UNVERIFIED, `2` for a config error.

## Example output

Real output from `docdrift check` on a private Spring Boot project whose README had seeded drift:

```text
docdrift check: 23 code endpoints, 16 documented endpoints, 14 matched

STALE (documented, not in code)
  GET    /giveaway/winners (Readme.md:7)
  DELETE /user/delete (Readme.md:31)

UNDOCUMENTED (in code, not documented)
  POST   /api/webhooks/razorpay (com/LuckyHub/Backend/controller/WebhookController.java:19)
  PUT    /user/changePassword (com/LuckyHub/Backend/controller/UserController.java:181)
  DELETE /user/confirm-delete (com/LuckyHub/Backend/controller/UserController.java:212)
  POST   /user/logout (com/LuckyHub/Backend/controller/UserController.java:193)
  GET    /user/me (com/LuckyHub/Backend/controller/UserController.java:146)
  POST   /user/request-delete (com/LuckyHub/Backend/controller/UserController.java:204)
  GET    /user/resendToken (com/LuckyHub/Backend/controller/UserController.java:107)
  PUT    /user/updateAvatar (com/LuckyHub/Backend/controller/UserController.java:168)
  PUT    /user/updateName (com/LuckyHub/Backend/controller/UserController.java:156)
```

From a checkout of this repo:

```bash
node bin/docdrift.js check test/fixtures-check --no-color
```

```text
docdrift check: 3 code endpoints, 3 documented endpoints, 2 matched

STALE (documented, not in code)
  GET    /api/legacy (README.md:7)

UNDOCUMENTED (in code, not documented)
  DELETE /api/users/{id} (UserController.java:15)
```

### Example run on a demo project

First, `docdrift fix` drafts a corrected README:

```text
Status: VERIFIED
Model: nvidia/nemotron-3.5-super-vl:free
Attempts: 1
Stale removed: 2 | Undocumented added: 9
```

After replacing README.md with the draft, `docdrift check` again:

```text
docdrift check: 25 code endpoints, 25 documented endpoints, 25 matched

No drift found
```

## Configuring `fix`

`fix` works with any OpenAI-compatible endpoint; bring your own key. Set these variables as environment variables or in a `.env` file:

- `DOCDRIFT_API_KEY`
- `DOCDRIFT_BASE_URL`
- `DOCDRIFT_MODEL`

Never commit `.env` (a `.env.example` is included). The key is optional for local endpoints such as Ollama (`http://localhost:11434/v1`).

`fix --dry-run` prints the prompt without calling any model. `check`, `scan` and `docs` need no key and no AI.

Demoed with open-weight models through OpenRouter (for example `recursive/flint-v1.0:free`). Any OpenAI-compatible endpoint works.

Speed of `fix` depends on the model and provider you choose and on your account's rate limits. Free-tier models can be slow or return HTTP 429 (rate-limited); DocDrift does not retry automatically, so try again or set another model in DOCDRIFT_MODEL.

## How it works

- **Scanner** - reads `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping` and `@RequestMapping` from `.java` files, joins the class-level prefix, ignores comments, and skips non-literal paths with a warning.
- **Docs parser** - finds `"METHOD /path"` in prose, inline code, code blocks and tables.
- **Matcher** - treats path parameters `{id}`, `:id` and `{userId}` as equal, ignores trailing slashes and query strings, and lets a code `@RequestMapping` without a method match any documented method. Spring library endpoints such as `/actuator` and `/swagger-ui` are reported as ignored instead of stale unless `--strict` is used.
- **Verifier loop** - the writer gets up to 2 retries to produce a draft that passes the code-based checks.

## Tests and evaluation

- **60 unit tests** with `node:test` (`npm test`).
- **Seeded-drift evaluation** (`npm run eval`): for 5 Java repos (4 public repos and one private project), 150 trials. Endpoints were removed from and fake endpoints added to a README generated from the code scan, plus harmless noise (renamed path parameters, trailing slashes). Result: **100% precision and recall** for both STALE and UNDOCUMENTED, with no failures. This is a controlled test: the README is generated from the scan, so it validates the matcher and the docs parser, not the scanner and not messy real-world READMEs. Results are in `evals/RESULTS.md`.
- **Real READMEs**: `check` was run on 4 public Spring Boot repos with their own READMEs. DocDrift reported no drift on 3 of them. The one false alarm (documented `/actuator/health` and `/swagger-ui.html`, provided by libraries) led to the framework-endpoint rule. No ground truth exists for real READMEs, so no recall is claimed.
- **Scanner**: on 5 repos it found 51 endpoints. In 4 repos the count matched a grep count; in the 5th, grep also counted a commented-out `@GetMapping` that the scanner correctly skipped (checked by hand).
- **`fix`**: verified on the demo project above. A systematic success rate for `fix` has not been measured yet because the free model endpoint was rate-limited.

## Limitations

- Only Spring Boot REST annotations in `.java` files (no Kotlin, no Express, no OpenAPI files).
- Constants in paths (like `BASE + "/x"`) are skipped with a warning, not resolved.
- `server.servlet.context-path` and class-level inheritance are not handled.
- A `@RequestMapping` without a method matches any documented method, so it can hide a wrong HTTP method.
- Docs are matched textually as `"METHOD /path"`, so endpoints written in other styles (for example a bare path without the method) are not found.
- The verifier only checks endpoints, not the rest of the text a model writes.
- The free open model used for the demo can be rate-limited.

## Built with Alan AI

This project was built with Alan AI (the code was written by Alan and reviewed and tested by the author).

## Not related

Not related to the npm package `docdrift` by Nico Schwandner, which links business decisions to code.

## License

MIT.