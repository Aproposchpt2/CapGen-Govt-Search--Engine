# RFCP build traceability

RFCP deploys reviewed, committed static assets. Build-time mutation is prohibited: `npm run build` verifies the generated-asset manifest, runs the complete test suite, and runs the RFCP lint/security checks without rewriting output.

## Authoritative inputs and generated outputs

- Historical patch inputs: `scripts/apply-*.cjs` and `scripts/validate-*.cjs`. They are inventoried by the manifest but are no longer executed during deploy because sequential mutation was non-idempotent.
- Generated deploy assets: committed root and nested HTML files, including `index.html`, `dashboard.html`, `ops-command-center-v3.html`, and `ops-command-center-v5.html`.
- Final RFCP remediation generator: `scripts/apply-rfcp-var-001-remediation.cjs`.
- Source/output integrity record: `generated-assets.manifest.json` using SHA-256.
- Final sanitation and manifest refresh: `npm run generate`. Earlier historical patch scripts are retained for traceability only.
- Deploy verification: `npm run build`.

`npm run generate` is a controlled maintainer operation and should leave an intentional reviewable diff. A stale input or output makes `npm run build` fail.

## Runtime and dependency contract

- Netlify build runtime: Node.js 18, declared in `netlify.toml`.
- Dependency lockfile: `package-lock.json`.
- Package manager command: `npm ci` followed by `npm run build`.
- Netlify publish directory: repository root (`.`).
- Netlify Functions directory: `netlify/functions` with esbuild bundling.
- Netlify Edge Functions: self-configured files in `netlify/edge-functions`.

## Configuration inventory

Required environment-variable names are determined from application source and Netlify configuration. Values and secrets are never written to this record. The security-sensitive names include `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_TOKEN_SECRET`, `ANALYZE_FIT_INTERNAL_SECRET`, `SAM_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `NGCC_OPS_PASSWORD`, `NGCC_TEST_OPS_PASSWORD`, and `NGCC_TEST_OPS_EXPIRES_AT`. Historical `NGCC_*` names are retained technical aliases only.

Redirects, response headers, functions, build settings, and edge authorization are declared in `netlify.toml` or by each edge function's exported `config`. The production commit and Netlify deploy ID belong in the release evidence, not this source-controlled document.
