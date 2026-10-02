-- 047_schedule_emails: schedule summary emails (built / updated) and the
-- 3-day "upcoming visit and payment" notice join the allowed templates.
ALTER TABLE communications DROP CONSTRAINT IF EXISTS communications_template_key_check;
ALTER TABLE communications
  ADD CONSTRAINT communications_template_key_check CHECK (template_key IN (
    'appointment_confirmation','appointment_reminder','technician_on_my_way','appointment_rescheduled',
    'invoice_created','payment_received','payment_failed','payment_refunded',
    'agreement_review_sign','agreement_signed_copy','service_completed','service_request_declined',
    'payment_method_request','late_fee_added','schedule_created','schedule_updated','upcoming_visit_notice'
  ));

-- The scheduled date the 3-day notice was last sent for. A rescheduled visit
-- no longer matches, so it gets a fresh notice before its new date.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_notice_date DATE;
