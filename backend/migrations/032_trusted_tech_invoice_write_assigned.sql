-- 032: trusted technicians can create/adjust invoices for their own customers
-- (needed for in-app agreement signing: initial invoice + recurring plan registration)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'invoices:write_assigned'
WHERE r.code = 'TRUSTED_TECHNICIAN'
ON CONFLICT DO NOTHING;
