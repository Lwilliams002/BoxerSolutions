-- 025_recurring_charge_schedule
-- Agreements now carry a service cadence; the recurring charge tracks when the
-- next regular service is due so the office is notified instead of remembering.
ALTER TABLE recurring_charges
  ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS next_due_date DATE,
  ADD COLUMN IF NOT EXISTS last_notified_due_date DATE;

ALTER TABLE recurring_charges DROP CONSTRAINT IF EXISTS recurring_charges_frequency_check;
ALTER TABLE recurring_charges
  ADD CONSTRAINT recurring_charges_frequency_check CHECK (frequency IN ('weekly','biweekly','monthly','bimonthly'));

-- Existing plans: assume monthly, due one month after the last charge (or today).
UPDATE recurring_charges
SET next_due_date = COALESCE((last_charged_at AT TIME ZONE 'UTC')::date + INTERVAL '1 month', CURRENT_DATE)::date
WHERE active AND next_due_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_recurring_charges_due
  ON recurring_charges(next_due_date) WHERE active;
