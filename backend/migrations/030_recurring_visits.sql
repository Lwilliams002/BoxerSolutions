-- 030_recurring_visits: appointments generated from a signed agreement's recurring plan
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS recurring_charge_id UUID REFERENCES recurring_charges(id);
CREATE INDEX IF NOT EXISTS idx_appointments_recurring_charge ON appointments(recurring_charge_id, scheduled_date) WHERE deleted_at IS NULL;
