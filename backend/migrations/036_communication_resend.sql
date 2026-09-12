-- Track which failed communication was re-sent (points at the new row).
ALTER TABLE communications ADD COLUMN IF NOT EXISTS resent_communication_id UUID REFERENCES communications(id);
