-- Event ownership is finer than ownership of the email/report that carried it.
CREATE TABLE wind_progress_targets (
  history_id text NOT NULL REFERENCES wind_history(id),
  event_index integer NOT NULL CHECK (event_index >= 0),
  project_id text NOT NULL REFERENCES wind_projects(id),
  method text NOT NULL CHECK (method IN ('name_match','manual')),
  PRIMARY KEY (history_id, event_index, project_id)
);
CREATE INDEX wind_progress_project_idx ON wind_progress_targets(project_id);
CREATE TABLE wind_progress_reviews (
  history_id text NOT NULL REFERENCES wind_history(id),
  event_index integer NOT NULL CHECK (event_index >= 0),
  PRIMARY KEY (history_id, event_index)
);
