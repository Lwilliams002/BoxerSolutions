-- 027_clear_placeholder_company_settings
-- The seed shipped a sample address and license; blank them so documents show
-- nothing (address) or "---------" (license) until the owner enters real values.
UPDATE settings
SET value = value
  || CASE WHEN value->>'address' = '2500 Bee Cave Rd, Austin, TX 78746' THEN '{"address":""}'::jsonb ELSE '{}'::jsonb END
  || CASE WHEN value->>'licenseNumber' = 'TPCL-0099421' THEN '{"licenseNumber":""}'::jsonb ELSE '{}'::jsonb END
  || CASE WHEN value->>'email' IS NULL THEN '{"email":"service@boxersolutionspestcontrol.com"}'::jsonb ELSE '{}'::jsonb END,
    updated_at = now()
WHERE key = 'company';
