INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'customers:write'
WHERE r.code IN ('TRUSTED_TECHNICIAN', 'TECHNICIAN')
ON CONFLICT DO NOTHING;
