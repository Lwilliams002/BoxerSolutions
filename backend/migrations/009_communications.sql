-- 009_communications: outbound customer communications log
CREATE TABLE communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  appointment_id UUID REFERENCES appointments(id),
  invoice_id UUID REFERENCES invoices(id),
  channel TEXT NOT NULL CHECK (channel IN ('sms','email','push')),
  template_key TEXT NOT NULL CHECK (template_key IN (
    'appointment_confirmation',
    'appointment_reminder',
    'technician_on_my_way',
    'appointment_rescheduled',
    'invoice_created',
    'payment_received',
    'payment_failed'
  )),
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  sent_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX idx_communications_customer ON communications(customer_id, created_at DESC);
CREATE INDEX idx_communications_appointment ON communications(appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX idx_communications_invoice ON communications(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_communications_status ON communications(status);
CREATE UNIQUE INDEX idx_communications_appointment_reminder_once
  ON communications(appointment_id, template_key)
  WHERE appointment_id IS NOT NULL AND template_key = 'appointment_reminder' AND status IN ('queued','sent');
