-- Agreement term length (12, 24, ... 72 months) so schedule rebuilds cover the whole term.
ALTER TABLE recurring_charges ADD COLUMN IF NOT EXISTS term_months INTEGER NOT NULL DEFAULT 12;
