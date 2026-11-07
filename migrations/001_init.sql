CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  is_fixture boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_roles (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('strategist', 'copy_writer', 'editor', 'approver', 'architect')),
  PRIMARY KEY (account_id, role)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE creatives (
  id uuid PRIMARY KEY,
  creative_code text UNIQUE,
  parent_code text NOT NULL DEFAULT 'net new',
  idea text NOT NULL DEFAULT '',
  source_type text,
  spotted_by text NOT NULL DEFAULT '',
  spotted_on date,
  hypothesis text NOT NULL DEFAULT '',
  sheet_link text,
  medium text,
  execution_style text,
  other_medium text NOT NULL DEFAULT '',
  other_execution text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'intake',
  approval_status text NOT NULL DEFAULT 'none',
  handoff_status text NOT NULL DEFAULT 'not_offered',
  parked boolean NOT NULL DEFAULT false,
  historical_order boolean NOT NULL DEFAULT false,
  fixture_kind text,
  intake_revision integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE creative_assignments (
  creative_id uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('strategist', 'copy_writer', 'editor', 'approver')),
  account_id uuid NOT NULL REFERENCES accounts(id),
  assigned_by uuid NOT NULL REFERENCES accounts(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (creative_id, role)
);

CREATE TABLE analysis_versions (
  id uuid PRIMARY KEY,
  creative_id uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  state text NOT NULL CHECK (state IN ('draft', 'ready')),
  authored_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creative_id, version_number)
);

CREATE TABLE brief_versions (
  id uuid PRIMARY KEY,
  creative_id uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  state text NOT NULL CHECK (state IN ('draft', 'frozen', 'approved', 'changes_requested', 'superseded')),
  analysis_version_id uuid REFERENCES analysis_versions(id),
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  parent_version_id uuid,
  frozen_at timestamptz,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creative_id, version_number)
);

CREATE TABLE checks (
  brief_version_id uuid NOT NULL REFERENCES brief_versions(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  result text NOT NULL CHECK (result IN ('pass', 'fail')),
  reason text NOT NULL DEFAULT '',
  basis jsonb NOT NULL DEFAULT '{}',
  checked_by uuid REFERENCES accounts(id),
  checked_at timestamptz,
  PRIMARY KEY (brief_version_id, check_key)
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY,
  brief_version_id uuid NOT NULL UNIQUE REFERENCES brief_versions(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES accounts(id),
  decision text NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  words text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id uuid PRIMARY KEY,
  brief_version_id uuid NOT NULL REFERENCES brief_versions(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  body text NOT NULL,
  author_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE handoffs (
  id uuid PRIMARY KEY,
  brief_version_id uuid NOT NULL UNIQUE REFERENCES brief_versions(id) ON DELETE CASCADE,
  offered_by uuid NOT NULL REFERENCES accounts(id),
  offered_at timestamptz NOT NULL DEFAULT now(),
  destination text NOT NULL,
  external_link text NOT NULL DEFAULT '',
  recipient_id uuid REFERENCES accounts(id),
  acceptance text NOT NULL DEFAULT 'pending' CHECK (acceptance IN ('pending', 'accepted', 'gaps')),
  gaps text NOT NULL DEFAULT '',
  decided_at timestamptz,
  disclaimer text NOT NULL
);

CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  request_hash text NOT NULL,
  creative_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_id uuid,
  action text NOT NULL,
  creative_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE pipeline_code_seq;

CREATE INDEX creatives_updated ON creatives (updated_at DESC);
CREATE INDEX briefs_creative ON brief_versions (creative_id, version_number);
CREATE INDEX analysis_creative ON analysis_versions (creative_id, version_number);
CREATE INDEX audit_creative ON audit_events (creative_id, created_at DESC);
