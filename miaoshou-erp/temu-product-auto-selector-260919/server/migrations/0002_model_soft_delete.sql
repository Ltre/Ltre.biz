ALTER TABLE models ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_models_active_channel ON models(channel_id, deleted_at, enabled);
