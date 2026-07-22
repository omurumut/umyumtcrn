CREATE TABLE IF NOT EXISTS ai_finding_action_links (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  unit_id integer REFERENCES units(id) ON DELETE SET NULL,
  analysis_id integer NOT NULL REFERENCES ai_analyses(id) ON DELETE CASCADE,
  finding_id varchar(80) NOT NULL,
  action_id integer NOT NULL REFERENCES energy_action_plans(id) ON DELETE CASCADE,
  created_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_finding_action_links_unique_active
  ON ai_finding_action_links(company_id, analysis_id, finding_id);

CREATE INDEX IF NOT EXISTS ai_finding_action_links_company_unit_idx
  ON ai_finding_action_links(company_id, unit_id, created_at);

CREATE INDEX IF NOT EXISTS ai_finding_action_links_action_idx
  ON ai_finding_action_links(action_id);
