-- Preferred visit time and technician for a recurring plan, set by the office after signing.
ALTER TABLE recurring_charges ADD COLUMN IF NOT EXISTS preferred_window_start TIME;
ALTER TABLE recurring_charges ADD COLUMN IF NOT EXISTS preferred_technician_id UUID REFERENCES employees(id);
