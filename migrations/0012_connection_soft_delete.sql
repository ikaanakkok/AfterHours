ALTER TABLE connections
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
