CREATE TABLE IF NOT EXISTS company_assets (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  asset_type text NOT NULL,
  storage_provider text NOT NULL,
  storage_key text NOT NULL,
  original_file_name text,
  mime_type text NOT NULL,
  file_size integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT company_assets_asset_type_check CHECK (asset_type IN ('company_logo')),
  CONSTRAINT company_assets_status_check CHECK (status IN ('active', 'replaced', 'deleted')),
  CONSTRAINT company_assets_mime_type_check CHECK (mime_type IN ('image/png', 'image/jpeg')),
  CONSTRAINT company_assets_file_size_check CHECK (file_size > 0),
  CONSTRAINT company_assets_dimensions_check CHECK (width > 0 AND height > 0),
  CONSTRAINT company_assets_content_hash_check CHECK (content_hash ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS company_assets_storage_key_unique
  ON company_assets (storage_key);

CREATE INDEX IF NOT EXISTS company_assets_company_type_status_idx
  ON company_assets (company_id, asset_type, status);

CREATE UNIQUE INDEX IF NOT EXISTS company_assets_one_active_logo_per_company_unique
  ON company_assets (company_id, asset_type)
  WHERE asset_type = 'company_logo' AND status = 'active';

CREATE TABLE IF NOT EXISTS company_brand_settings (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  show_logo_in_reports boolean NOT NULL DEFAULT true,
  logo_alt_text text NOT NULL DEFAULT 'Firma logosu',
  logo_position text NOT NULL DEFAULT 'left',
  logo_size text NOT NULL DEFAULT 'medium',
  brand_settings_version integer NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT company_brand_settings_logo_position_check CHECK (logo_position IN ('left', 'center', 'right')),
  CONSTRAINT company_brand_settings_logo_size_check CHECK (logo_size IN ('small', 'medium', 'large')),
  CONSTRAINT company_brand_settings_logo_alt_text_length_check CHECK (char_length(logo_alt_text) <= 250),
  CONSTRAINT company_brand_settings_version_check CHECK (brand_settings_version > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS company_brand_settings_company_id_unique
  ON company_brand_settings (company_id);
