-- 024_checkout_session_mode_pay
-- Every checkout is now a STORAGE session; the customer picks card or bank
-- inside North's form, so the ledger records the flow ('pay' | 'store')
-- rather than a pre-chosen method.
ALTER TABLE north_checkout_sessions DROP CONSTRAINT IF EXISTS north_checkout_sessions_mode_check;
ALTER TABLE north_checkout_sessions
  ADD CONSTRAINT north_checkout_sessions_mode_check CHECK (mode IN ('card','bank','store','pay'));
