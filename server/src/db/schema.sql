-- QuantumShift PostgreSQL schema
-- Compatible with PostgreSQL 14+ and the embedded PGlite engine.

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  email       TEXT,
  role        TEXT NOT NULL CHECK (role IN ('CTO', 'CISO', 'DEVELOPER', 'AUDITOR')),
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repositories (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  slug                  TEXT UNIQUE NOT NULL,
  source_type           TEXT NOT NULL CHECK (source_type IN ('github', 'gitlab', 'upload', 'docker', 'cloud', 'demo')),
  source_ref            TEXT,
  storage_path          TEXT,
  primary_language      TEXT,
  business_unit         TEXT,
  criticality           TEXT NOT NULL DEFAULT 'medium' CHECK (criticality IN ('critical', 'high', 'medium', 'low')),
  data_classification   TEXT,
  data_lifetime_years   REAL NOT NULL DEFAULT 5,
  migration_time_years  REAL NOT NULL DEFAULT 2,
  description           TEXT,
  is_demo               BOOLEAN NOT NULL DEFAULT false,
  simulated_ingestion   BOOLEAN NOT NULL DEFAULT false,
  status                TEXT NOT NULL DEFAULT 'registered',
  files_scanned         INT NOT NULL DEFAULT 0,
  loc                   INT NOT NULL DEFAULT 0,
  languages             JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_scan_at          TIMESTAMPTZ,
  scan_duration_ms      INT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id              SERIAL PRIMARY KEY,
  repository_id   INT REFERENCES repositories(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running',
  files_scanned   INT DEFAULT 0,
  assets_found    INT DEFAULT 0,
  red             INT DEFAULT 0,
  yellow          INT DEFAULT 0,
  green           INT DEFAULT 0,
  triggered_by    TEXT,
  mode            TEXT,
  error           TEXT
);

CREATE TABLE IF NOT EXISTS crypto_assets (
  id                SERIAL PRIMARY KEY,
  repository_id     INT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  fingerprint       TEXT UNIQUE NOT NULL,
  file_path         TEXT NOT NULL,
  language          TEXT,
  function_name     TEXT,
  line              INT,
  end_line          INT,
  snippet           TEXT,
  api_call          TEXT,
  algorithm         TEXT NOT NULL,
  family            TEXT,
  key_size          INT,
  asset_type        TEXT NOT NULL,
  primitive         TEXT,
  rule_id           TEXT,
  detection_method  TEXT,
  confidence        REAL,
  quantum_status    TEXT,
  data_context      TEXT,
  dependencies      JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_algorithm  TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'open',
  first_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crypto_assets_repo ON crypto_assets(repository_id);

CREATE TABLE IF NOT EXISTS cbom_assets (
  id               SERIAL PRIMARY KEY,
  repository_id    INT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  crypto_asset_id  INT REFERENCES crypto_assets(id) ON DELETE SET NULL,
  bom_ref          TEXT NOT NULL,
  name             TEXT,
  asset_type       TEXT,
  primitive        TEXT,
  component        JSONB NOT NULL,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cbom_repo ON cbom_assets(repository_id);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id                    SERIAL PRIMARY KEY,
  crypto_asset_id       INT UNIQUE NOT NULL REFERENCES crypto_assets(id) ON DELETE CASCADE,
  x_years               REAL,
  y_years               REAL,
  z_years               REAL,
  mosca_exposed         BOOLEAN,
  mosca_margin          REAL,
  risk_level            TEXT CHECK (risk_level IN ('RED', 'YELLOW', 'GREEN')),
  risk_score            INT,
  business_criticality  TEXT,
  urgency               TEXT,
  rationale             TEXT,
  explanation           JSONB,
  assessed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS migration_plans (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  scope       JSONB,
  strategy    TEXT,
  phases      JSONB,
  items       JSONB,
  summary     JSONB,
  status      TEXT NOT NULL DEFAULT 'draft',
  mode        TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS remediation_jobs (
  id             SERIAL PRIMARY KEY,
  repository_id  INT REFERENCES repositories(id) ON DELETE CASCADE,
  file_path      TEXT,
  language       TEXT,
  asset_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  changes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra_files    JSONB NOT NULL DEFAULT '[]'::jsonb,
  before_code    TEXT,
  after_code     TEXT,
  diff           TEXT,
  explanation    JSONB,
  confidence     REAL,
  status         TEXT NOT NULL DEFAULT 'generated',
  mode           TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_results (
  id                  SERIAL PRIMARY KEY,
  run_id              TEXT NOT NULL,
  remediation_job_id  INT REFERENCES remediation_jobs(id) ON DELETE SET NULL,
  suite               TEXT,
  category            TEXT,
  name                TEXT,
  status              TEXT CHECK (status IN ('passed', 'failed', 'warning')),
  execution           TEXT CHECK (execution IN ('real', 'simulated')),
  duration_ms         INT,
  details             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(run_id);

CREATE TABLE IF NOT EXISTS pull_requests (
  id                   SERIAL PRIMARY KEY,
  number               INT NOT NULL,
  repository_id        INT REFERENCES repositories(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  branch               TEXT NOT NULL,
  base_branch          TEXT NOT NULL DEFAULT 'main',
  remediation_job_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  changed_files        JSONB NOT NULL DEFAULT '[]'::jsonb,
  crypto_changes       JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_before          INT,
  risk_after           INT,
  risk_reduction       INT,
  test_run_id          TEXT,
  test_summary         JSONB,
  ai_explanation       TEXT,
  compliance           JSONB,
  status               TEXT NOT NULL DEFAULT 'pending_review'
                       CHECK (status IN ('pending_review', 'approved', 'rejected', 'changes_requested')),
  audit_status         TEXT NOT NULL DEFAULT 'pending',
  simulated            BOOLEAN NOT NULL DEFAULT true,
  created_by           TEXT,
  reviewer             TEXT,
  review_comment       TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         SERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL,
  agent      TEXT NOT NULL,
  action     TEXT NOT NULL,
  resource   TEXT,
  result     TEXT,
  username   TEXT,
  status     TEXT NOT NULL CHECK (status IN ('success', 'warning', 'failure', 'pending', 'info')),
  mode       TEXT,
  details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash  TEXT,
  hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts DESC);

CREATE TABLE IF NOT EXISTS system_services (
  id          SERIAL PRIMARY KEY,
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'UNKNOWN',
  latency_ms  INT,
  message     TEXT,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_check  TIMESTAMPTZ
);
