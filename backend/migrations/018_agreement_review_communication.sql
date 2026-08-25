-- 018_agreement_review_communication: add customer agreement review email template key
ALTER TABLE communications DROP CONSTRAINT communications_template_key_check;
ALTER TABLE communications
  ADD CONSTRAINT communications_template_key_check CHECK (template_key IN (
    'appointment_confirmation',
    'appointment_reminder',
    'technician_on_my_way',
    'appointment_rescheduled',
    'invoice_created',
    'payment_received',
    'payment_failed',
    'payment_refunded',
    'agreement_review_sign'
  ));
