-- 049_sms_opt_in: customer consent to text messages (toll-free SMS program).
-- Recorded with when and where the customer opted in, as carriers require.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_opt_in_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_opt_in_source TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sms_opt_out_at TIMESTAMPTZ;
