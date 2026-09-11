-- 035: agreements can bill every 3 months
ALTER TABLE recurring_charges DROP CONSTRAINT IF EXISTS recurring_charges_frequency_check;
ALTER TABLE recurring_charges
  ADD CONSTRAINT recurring_charges_frequency_check CHECK (frequency IN ('weekly','biweekly','monthly','bimonthly','quarterly'));
