-- 007_files: object storage metadata (files live in Wasabi/MinIO, never in the DB)
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  appointment_id UUID REFERENCES appointments(id),
  invoice_id UUID REFERENCES invoices(id),
  file_type TEXT NOT NULL CHECK (file_type IN
    ('customer_photo','service_photo','technician_photo','invoice_pdf','document','signature','attachment')),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT,
  storage_bucket TEXT NOT NULL,
  storage_object_key TEXT NOT NULL UNIQUE,
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending','uploaded','failed')),
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_files_customer ON files(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_appointment ON files(appointment_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_files_invoice ON files(invoice_id);

ALTER TABLE invoices
  ADD CONSTRAINT fk_invoices_pdf_file FOREIGN KEY (pdf_file_id) REFERENCES files(id);

CREATE TABLE photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  appointment_id UUID REFERENCES appointments(id),
  caption TEXT,
  taken_by UUID REFERENCES employees(id),
  taken_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_photos_appointment ON photos(appointment_id);
CREATE INDEX idx_photos_customer ON photos(customer_id);

CREATE TABLE signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id),
  customer_id UUID NOT NULL REFERENCES customers(id),
  technician_id UUID REFERENCES employees(id),
  file_id UUID NOT NULL REFERENCES files(id),
  signer_name TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_signatures_appointment ON signatures(appointment_id);

CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id),
  appointment_id UUID REFERENCES appointments(id),
  author_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_notes_customer ON notes(customer_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_appointment ON notes(appointment_id) WHERE deleted_at IS NULL;
