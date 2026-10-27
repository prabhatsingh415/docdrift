# DocDrift

DocDrift finds stale and undocumented REST endpoints by comparing the Spring Boot controllers in your code with the endpoints documented in your README and `docs/*.md`. It can also draft a README fix with an AI writer, then verifies that draft against the code before showing it to you.

## Install

```bash
npx github:prabhatsingh415/docdrift check <codeDir> [docsDir]
```

```bash
npm install -g @prabhat-singh/docdrift
```

---

Not related to the npm package `docdrift` by Nico Schwandner, which links business decisions to code.
