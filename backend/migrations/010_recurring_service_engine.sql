-- 010_recurring_service_engine: recurring subscription automation fields and indexes
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS preferred_time TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS next_service_date DATE,
  ADD COLUMN IF NOT EXISTS last_generated_date DATE,
  ADD COLUMN IF NOT EXISTS generate_ahead_days INT NOT NULL DEFAULT 30;

UPDATE subscriptions
SET next_service_date = COALESCE(next_service_date, next_generation_date, start_date),
    generate_ahead_days = COALESCE(generate_ahead_days, 30)
WHERE next_service_date IS NULL OR generate_ahead_days IS NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES subscriptions(id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_next_service
  ON subscriptions(next_service_date)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_subscription_date
  ON appointments(subscription_id, scheduled_date)
  WHERE subscription_id IS NOT NULL AND deleted_at IS NULL;
