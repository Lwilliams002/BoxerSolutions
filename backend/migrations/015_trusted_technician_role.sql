INSERT INTO roles (code, name, description)
VALUES ('TRUSTED_TECHNICIAN', 'Trusted Technician', 'Technician with expanded field permissions')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'customers:read_assigned',
  'appointments:read_assigned',
  'appointments:write_assigned',
  'routes:read_assigned',
  'invoices:read_assigned',
  'payments:read',
  'payments:collect',
  'payments:collect_info',
  'files:read',
  'files:write',
  'notes:read',
  'notes:write',
  'services:read'
)
WHERE r.code = 'TRUSTED_TECHNICIAN'
ON CONFLICT DO NOTHING;
