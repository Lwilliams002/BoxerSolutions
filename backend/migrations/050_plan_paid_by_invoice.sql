-- 050: a plan whose current cycle was paid through a hand-made invoice should not show as due.
-- One-time backfill of the rule now enforced in planCoverage.ts: for every active plan that is
-- due today or earlier, if the customer has a fully paid invoice (not the signing-time invoice and
-- not one the plan created itself) covering the plan amount and dated within the current cycle,
-- link it and roll the due date forward past today.
DO $$
DECLARE
  rc RECORD;
  inv RECORD;
  step INTERVAL;
  next_due DATE;
BEGIN
  FOR rc IN
    SELECT id, customer_id, frequency, amount, next_due_date, created_at, last_charged_at
    FROM recurring_charges WHERE active AND next_due_date IS NOT NULL AND next_due_date <= CURRENT_DATE
  LOOP
    step := CASE rc.frequency
      WHEN 'weekly' THEN INTERVAL '7 days' WHEN 'biweekly' THEN INTERVAL '14 days'
      WHEN 'bimonthly' THEN INTERVAL '2 months' WHEN 'quarterly' THEN INTERVAL '3 months'
      ELSE INTERVAL '1 month' END;
    IF rc.last_charged_at IS NOT NULL AND rc.last_charged_at::date >= (rc.next_due_date - step)::date THEN CONTINUE; END IF;
    SELECT i.id, i.created_at INTO inv FROM invoices i
     WHERE i.customer_id = rc.customer_id AND i.deleted_at IS NULL AND i.status = 'paid'
       AND i.total >= rc.amount - 0.01
       AND i.created_at > rc.created_at + INTERVAL '1 minute'
       AND i.created_at::date >= (rc.next_due_date - step)::date
       AND coalesce(i.notes, '') NOT IN ('Recurring service charge', 'Initial agreement charge')
     ORDER BY i.created_at DESC LIMIT 1;
    IF inv.id IS NULL THEN CONTINUE; END IF;
    next_due := rc.next_due_date;
    WHILE next_due <= CURRENT_DATE LOOP next_due := (next_due + step)::date; END LOOP;
    UPDATE recurring_charges SET last_charged_invoice_id = inv.id, last_charged_at = inv.created_at, next_due_date = next_due, updated_at = now()
     WHERE id = rc.id;
    RAISE NOTICE 'plan % covered by invoice %, due moved to %', rc.id, inv.id, next_due;
  END LOOP;
END $$;
