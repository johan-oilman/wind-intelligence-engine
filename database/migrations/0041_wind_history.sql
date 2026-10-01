-- Private legacy records, separate from verified announcement snapshots and current facts.
CREATE TABLE wind_history (
  id text PRIMARY KEY,
  origin text NOT NULL CHECK (origin IN ('gmail','conversation','file')),
  external_id text NOT NULL,
  archive_url text,
  title text NOT NULL,
  body text NOT NULL,
  content_hash text NOT NULL,
  source_at timestamptz,
  imported_at timestamptz NOT NULL DEFAULT now(),
  events jsonb NOT NULL DEFAULT '[]',
  parse_note text NOT NULL DEFAULT '',
  notification text NOT NULL CHECK (notification IN ('sent_record','not_sent','unknown')),
  link_reviewed boolean NOT NULL DEFAULT false,
  UNIQUE (origin, external_id)
);
CREATE INDEX wind_history_date_idx ON wind_history (imported_at DESC);
CREATE TABLE wind_history_projects (
  history_id text NOT NULL REFERENCES wind_history(id),
  project_id text NOT NULL REFERENCES wind_projects(id),
  method text NOT NULL CHECK (method IN ('name_match','manual')),
  PRIMARY KEY (history_id, project_id)
);
