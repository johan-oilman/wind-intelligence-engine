-- Private project intelligence. These tables never join the anonymous publication layer.
CREATE TABLE wind_projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  province text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  developer text,
  capacity_mw numeric CHECK (capacity_mw > 0),
  aliases text[] NOT NULL DEFAULT '{}',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('high','normal')),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wind_evidence (
  id text PRIMARY KEY,
  url text NOT NULL,
  title text NOT NULL,
  publisher text NOT NULL,
  body text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('T1','T1_5','T2')),
  published_at timestamptz,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  article_id text REFERENCES articles(id) ON DELETE SET NULL,
  content_hash text NOT NULL,
  UNIQUE (url, content_hash)
);
CREATE TABLE wind_candidates (
  id text PRIMARY KEY,
  project_id text REFERENCES wind_projects(id),
  matches text[] NOT NULL DEFAULT '{}',
  evidence_id text NOT NULL REFERENCES wind_evidence(id),
  field text NOT NULL CHECK (field IN ('capacityMw','developer','approval','procurement','construction','installation','grid','exception','plannedGridDate')),
  scope text NOT NULL DEFAULT 'project',
  value jsonb NOT NULL,
  quote text NOT NULL,
  event_date date,
  planned boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  note text NOT NULL DEFAULT '',
  extractor text NOT NULL,
  dedup_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewer text,
  reason text
);
CREATE INDEX wind_candidates_pending_idx ON wind_candidates (status, created_at DESC);
CREATE INDEX wind_candidates_project_idx ON wind_candidates (project_id, created_at DESC);
CREATE TABLE wind_changes (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES wind_projects(id),
  candidate_id text NOT NULL UNIQUE REFERENCES wind_candidates(id),
  field text NOT NULL,
  scope text NOT NULL,
  before_value jsonb,
  after_value jsonb NOT NULL,
  event_date date,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  applied boolean NOT NULL,
  kind text NOT NULL CHECK (kind IN ('live','supplement','historical','correction')),
  reason text NOT NULL,
  actor text NOT NULL
);
CREATE INDEX wind_changes_project_idx ON wind_changes (project_id, confirmed_at DESC);
CREATE TABLE wind_facts (
  project_id text NOT NULL REFERENCES wind_projects(id),
  field text NOT NULL,
  scope text NOT NULL,
  value jsonb NOT NULL,
  event_date date,
  change_id text NOT NULL REFERENCES wind_changes(id),
  evidence_id text NOT NULL REFERENCES wind_evidence(id),
  PRIMARY KEY (project_id, field, scope)
);
CREATE TABLE wind_source_targets (
  project_id text NOT NULL REFERENCES wind_projects(id),
  source_id text NOT NULL REFERENCES sources(id),
  PRIMARY KEY (project_id, source_id)
);
CREATE TABLE wind_article_runs (
  article_id text PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','no_match','missing_body')),
  candidates integer NOT NULL DEFAULT 0,
  checked_at timestamptz NOT NULL DEFAULT now()
);
