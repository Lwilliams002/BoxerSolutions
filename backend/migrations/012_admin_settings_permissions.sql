INSERT INTO permissions (code, description) VALUES
  ('settings:read', 'Read company settings'),
  ('settings:write', 'Update company settings')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('settings:read', 'settings:write')
WHERE r.code IN ('ADMIN', 'OFFICE_MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO settings (key, value) VALUES
  ('company', '{"companyName":"Boxer Solutions Pest Control","phone":"(512) 555-0142","address":"2500 Bee Cave Rd, Austin, TX 78746","licenseNumber":"TPCL-0099421","defaultTaxRate":0.0825}'),
  ('invoicing', '{"invoiceDueDays":15,"autoGenerateOnComplete":true}'),
  ('appointments', '{"appointmentReminderHours":24}')
ON CONFLICT (key) DO NOTHING;

