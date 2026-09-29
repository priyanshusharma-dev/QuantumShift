# QUANTUMSHIFT

**Agentic PQC Migration of Enterprise Codebases using IBM Bob**

> From discovery to quantum-safe code in days.

QuantumShift is a full-stack platform that walks enterprise codebases through a Post-Quantum Cryptography (PQC) migration:

**DISCOVER → ASSESS → PLAN → REMEDIATE → GOVERN**

It finds every RSA, ECC/ECDSA, ECDH, SHA-1, MD5, 3DES, AES-128 use, hardcoded key, certificate and PQC-blocking library. It builds a CycloneDX 1.5 CBOM and scores quantum exposure with Mosca's theorem. It then uses IBM Bob-inspired agents to plan, patch (ML-KEM-768 / ML-DSA-65), test and open pull requests. Every PR needs mandatory human approval, and every action goes into a tamper-evident BobShell audit trail.

> **Honesty note.** IBM Bob does not expose a public API. QuantumShift ships a *local, Bob-inspired* orchestrator (Architect / Code / Ask modes, BobShell-style audit). It is not the IBM Bob product. Anything simulated is labelled **Demo / Simulation Mode** in the UI, and every test result is tagged `real` or `simulated`.

---

## Architecture

```
ZONE 1  Input sources & users   GitHub/GitLab · Docker registries · AWS · CTO/CISO/Developer/Auditor
              ↓
ZONE 2  Presentation            React 19 + Tailwind CSS 4 + Recharts + Lucide (Vite)
              ↓  REST + Server-Sent Events
ZONE 3  Application             Node.js + Express 5 API gateway → scanner, CBOM, risk, remediation,
                                testing, compliance, audit services
              ↓
ZONE 4  Data & AI               PostgreSQL · Risk Engine (Mosca) · IBM Bob-inspired agent layer ·
                                IBM Granite explanations (watsonx.ai, optional)
```

```
quantumshift/
├── client/                 React app (15+ pages)
│   └── src/{pages,components,context,lib}
├── server/
│   ├── src/
│   │   ├── index.js        Express app (helmet, CORS, rate limits, static client)
│   │   ├── routes/api.js   REST API + SSE stream
│   │   ├── middleware/     JWT auth, RBAC, zod validation
│   │   ├── db/             schema.sql, PostgreSQL/PGlite adapter, seed
│   │   └── services/       scanner, catalog (rules), risk, granite, cbom, planner,
│   │                       remediation + adapters, testing, compliance, agents,
│   │                       audit, pipeline, demo, dashboard, health, reports, ingest
│   ├── demo-repos/         5 sample enterprise codebases (intentionally vulnerable, no real secrets)
│   └── demo-sources/       synthetic AWS crypto inventory
├── .env.example
└── package.json            root scripts (dev / build / start / seed)
```

## Features

| Area | What it does |
|---|---|
| **Repository Discovery** | GitHub/GitLab URL, ZIP upload, Docker image or cloud source, then a live 6-stage pipeline: ingestion → AST parsing → semantic analysis → crypto API detection → dependency analysis → CBOM generation |
| **AST Scanner** | Real Babel ASTs for JS/TS; Semgrep-style PQC rules for Python, Go and Java; analysers for Dockerfiles, nginx/properties configs, manifests and X.509 certificates; playground for pasted code |
| **CBOM Explorer** | CycloneDX 1.5 `cryptographic-asset` components with evidence, filters (algorithm, risk, repository, file, language, asset type) and JSON export |
| **Risk Assessment** | Interactive Mosca calculator (X + Y > Z), RED/YELLOW/GREEN classification, 0–100 risk score, editable per-repository risk profiles |
| **Granite-style explanations** | "Why risky / data affected / recommended migration / dependencies / developer actions". Labelled *AI-generated explanation — Demo Mode* unless watsonx.ai is configured |
| **Migration Planner** | Architect Mode roadmap in 7 phases: Discovery, Risk Classification, Hybrid Cryptography, PQC Migration, Testing, Developer Approval, Production Deployment. Includes priorities, effort and a Gantt view |
| **Code Mode** | Deterministic rewrites to ML-KEM-768 / ML-DSA-65 using generated liboqs-style adapters (node:crypto on OpenSSL 3.5, liboqs-python, liboqs-go, Bouncy Castle 1.80), plus hash, cipher, TLS, runtime and hardcoded-key fixes. Side-by-side diff, change explanations, confidence scores |
| **Testing** | Real ML-KEM encaps/decaps, ML-DSA sign/verify + tamper rejection, hybrid X25519+ML-KEM, key serialisation, payload-size and performance tests; AST re-scan of patches; execution of the generated JS adapter; simulated CI regression suites (labelled) |
| **PR Review Hub** | Simulated PRs with diff, crypto changes, risk reduction, tests, AI explanation and Compliance Agent checks (FIPS 203/204, NIST IR 8547, CNSA 2.0). APPROVE / REJECT / REQUEST CHANGES; nothing is auto-approved |
| **BobShell audit** | Every agent and human action goes into a SHA-256 hash chain, with search, filters, chain verification and CSV/JSON export |
| **Executive dashboard** | 8 KPIs, 6 charts and a RED/YELLOW/GREEN heatmap, all computed from the database. Drill-down: repository → file → crypto asset → call site |
| **Agents** | Live view of 8 agents: Discovery, AST, Risk, Architect, Refactoring, Test, Compliance and Audit |
| **Complete demo** | One button runs all 15 steps end-to-end and stops at human approval |
| **Roles** | CTO, CISO / Security, Developer and Auditor, each with a dedicated workspace and server-enforced permissions |
| **System health** | Real self-tests of the frontend, API, PostgreSQL, risk engine, AST scanner, CBOM generator, agent engine, audit logger and testing engine |
| **Reports** | CBOM JSON, risk CSV/JSON, migration Markdown/JSON, test JSON/CSV, audit CSV/JSON and an executive HTML report |

## Requirements

- **Node.js ≥ 24.7** (native ML-KEM / ML-DSA via OpenSSL 3.5, used by the real interoperability tests)
- PostgreSQL 14+ *(optional)*. Without `DATABASE_URL` the server uses embedded PostgreSQL (PGlite), stored in `server/data/pglite`

## Installation & running

```bash
npm run install:all      # installs root, server and client dependencies
cp .env.example .env     # optional — defaults work out of the box
npm run dev              # API on http://localhost:4000, web on http://localhost:5173
```

Open **http://localhost:5173**. You're signed in automatically as the CTO (demo SSO); switch roles from the top-right menu.

Production-style single port:

```bash
npm start                # builds the client and serves everything from http://localhost:4000
```

Reset the demo database:

```bash
npm run seed
```

The first start seeds 4 demo users and scans the 5 sample repositories. It also creates one approved and one pending PR plus a roadmap. This takes about 20 seconds.

## Environment variables

See [`.env.example`](.env.example). The main ones:

| Variable | Purpose |
|---|---|
| `PORT` | API port (default 4000) |
| `DATABASE_URL` | External PostgreSQL. Empty = embedded PGlite |
| `JWT_SECRET` | Session signing secret (≥ 32 chars). Empty = ephemeral per-process secret |
| `CORS_ORIGINS` | Allowed browser origins |
| `DEFAULT_MODE` | `demo` or `real` |
| `PACING_MS` | Visual pacing between pipeline stages |
| `WATSONX_API_KEY`, `WATSONX_PROJECT_ID`, `WATSONX_URL`, `WATSONX_MODEL_ID` | Optional IBM Granite on watsonx.ai (real mode only) |

API keys are read only by the server and are never sent to the browser.

## Database setup

The schema is in [`server/src/db/schema.sql`](server/src/db/schema.sql) and is applied automatically on startup. Tables: `users`, `app_settings`, `repositories`, `scan_runs`, `crypto_assets`, `cbom_assets`, `risk_assessments`, `migration_plans`, `remediation_jobs`, `test_results`, `pull_requests`, `audit_logs`, `system_services`.

To use your own PostgreSQL:

```bash
createdb quantumshift
# .env
DATABASE_URL=postgres://user:password@localhost:5432/quantumshift
```

## Demo mode vs Real Integration

| Capability | Demo mode | Real Integration |
|---|---|---|
| GitHub / GitLab URL | Registered; ingestion simulated with a bundled sample | Public HEAD archive downloaded and scanned locally |
| ZIP upload | Real | Real |
| Docker image / AWS | Demo registry images / synthetic inventory | Returns "not configured" (credentials required) |
| AST scan, CBOM, Mosca, planning, patches | Real | Real |
| ML-KEM / ML-DSA tests | Real (OpenSSL 3.5) | Real |
| CI regression suites | Simulated (labelled) | Simulated (labelled) |
| IBM Granite explanations | Template engine (labelled) | watsonx.ai if configured, else template with a notice |
| Pull requests | Simulated — nothing is pushed | Simulated — nothing is pushed |

Switch modes in the top bar (CTO / CISO only). Each switch is audited.

## API

All routes are under `/api`. Everything except `/system/health`, `/auth/users` and `/auth/login` requires `Authorization: Bearer <token>`.

| Method | Route | Description |
|---|---|---|
| POST | `/auth/login` | Demo SSO → JWT |
| GET | `/stream?token=` | Server-Sent Events (jobs, agents, audit, invalidations) |
| POST | `/scan` | Start a repository scan (returns a job id) |
| POST | `/scan/ast` | Scan a code snippet |
| GET/POST | `/repositories`, `/repositories/upload` | List / register sources |
| GET | `/repositories/:id`, `/repositories/:id/file?path=` | Drill-down |
| PUT | `/repositories/:id/risk-profile` | Update X, Y, criticality and re-assess |
| GET | `/assets`, `/assets/:id` | Crypto inventory, call site, explanation |
| GET | `/cbom`, `/cbom/document` | CBOM rows / CycloneDX document |
| POST | `/risk/calculate` | Mosca calculation |
| GET | `/risks`; POST `/risks/:assetId/explain` | Assessments / regenerate explanation |
| POST | `/migration/plan`; GET `/migration/plans[/:id]` | Architect Mode roadmap |
| POST | `/remediation/generate`; GET `/remediation/jobs[/:id]` | Code Mode patches |
| POST | `/remediation/jobs/:id/explain`, `/remediation/jobs/:id/discard` | Explain / discard |
| POST | `/tests/run`; GET `/tests`, `/tests/runs` | Test Agent |
| GET/POST | `/pull-requests`, `/pull-requests/:id` | PR hub |
| POST | `/pull-requests/:id/approve` \| `reject` \| `request-changes` | Human review |
| GET | `/audit-logs`, `/audit-logs/verify` | BobShell |
| GET | `/dashboard/summary`, `/agents`, `/rules`, `/sources` | Dashboards |
| POST | `/demo/run`; GET `/jobs/:id` | Complete demo |
| GET | `/reports/:type?format=` | `cbom`, `risk`, `migration`, `tests`, `audit`, `executive` |
| GET/PUT | `/system/settings`; POST `/system/diagnostics`, `/system/reset` | Settings & health |

Errors use the shape `{ "error": { "message", "code", "details" } }`.

## Security considerations

- Secrets only in server environment variables; `.env` is git-ignored; no keys in frontend code
- `helmet` secure headers and CSP; CORS allow-list; global and heavy-endpoint rate limiting
- zod validation on every write and query; path-traversal and zip-slip protection; upload size limits
- JWT authentication (auth-ready for OIDC/SAML) and role-based authorization for scans, patches, reviews and settings
- Hash-chained audit logging of every action; CSV formula-injection neutralisation; no stack traces returned to clients
- Sample repositories contain **placeholder** keys only (`DEMO-ONLY-PLACEHOLDER…`). The demo certificates are real public X.509 certificates whose private keys were discarded.

## Roles

| Role | Sees | Can |
|---|---|---|
| CTO | Executive risk and migration progress | Scan, plan, run demo, change settings |
| CISO / Security | CBOM, risk, vulnerabilities, approval queue | Everything, including PR review |
| Developer | Code findings, patches, PRs | Scan, patch, test, open and review PRs |
| Auditor | BobShell logs, chain integrity, compliance | Read-only, exports |

---

IBM, IBM Bob and Granite are trademarks of IBM. This is an independent academic project and is not affiliated with IBM.
