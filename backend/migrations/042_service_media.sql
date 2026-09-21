-- Service proof media: technicians tag photos/videos taken on a visit and the
-- customer sees them in the portal once the visit is completed. The office can
-- hide a single item from the customer without deleting it.
ALTER TABLE photos ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS hidden_from_customer BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE photos DROP CONSTRAINT IF EXISTS photos_label_check;
ALTER TABLE photos ADD CONSTRAINT photos_label_check CHECK (label IS NULL OR label IN ('before', 'after', 'proof'));
