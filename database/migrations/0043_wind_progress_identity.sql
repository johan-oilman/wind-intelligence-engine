-- Identity enrichment is separate from the immutable archive and confirmed project facts.
CREATE TABLE wind_progress_identities (
  history_id text NOT NULL REFERENCES wind_history(id) ON DELETE CASCADE,
  event_index integer NOT NULL CHECK (event_index >= 0),
  project_names jsonb NOT NULL CHECK (jsonb_typeof(project_names) = 'array'),
  reason text NOT NULL,
  evidence_url text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (history_id, event_index)
);
