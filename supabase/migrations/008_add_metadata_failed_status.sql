-- Add 'failed' as valid metadata_status
ALTER TABLE memories DROP CONSTRAINT IF EXISTS metadata_status_valid;
ALTER TABLE memories ADD CONSTRAINT metadata_status_valid
  CHECK (metadata_status IN ('ready', 'degraded', 'failed'));
