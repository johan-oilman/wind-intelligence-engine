-- Sweeps compare the exact article version read, so an edit racing a worker is never lost.
ALTER TABLE wind_article_runs ADD COLUMN article_revision integer NOT NULL DEFAULT 0;
