-- 023_bank_account_type
-- North's ACH token sale / refund / void require account_type (checking|savings)
-- and North does not echo it back, so the customer's choice is stored with the
-- vaulted bank method.
ALTER TABLE payment_methods
  ADD COLUMN bank_account_type TEXT CHECK (bank_account_type IN ('checking','savings'));
