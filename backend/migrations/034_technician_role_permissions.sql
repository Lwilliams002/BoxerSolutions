-- 034: TECHNICIAN role permissions (same as trusted technicians, without collecting payments or writing invoices)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'customers:read_assigned','customers:write','appointments:read_assigned','appointments:write_assigned',
  'routes:read_assigned','invoices:read_assigned','payments:read','payments:collect_info',
  'files:read','files:write','notes:read','notes:write','services:read'
)
WHERE r.code = 'TECHNICIAN'
ON CONFLICT DO NOTHING;
