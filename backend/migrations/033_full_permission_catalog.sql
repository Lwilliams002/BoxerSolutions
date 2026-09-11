-- 033: production only had the technician-level permission codes. Create the
-- full catalog the API checks against, the ADMIN / OFFICE_MANAGER roles, and
-- give trusted technicians invoices:write_assigned (agreement signing).
INSERT INTO permissions (code, description) VALUES
  ('customers:read', 'Read all customers'), ('customers:read_assigned', 'Read assigned customers'),
  ('customers:write', 'Create and edit customers'), ('customers:delete', 'Delete customers'),
  ('services:read', 'Read service catalog'), ('services:write', 'Manage service catalog'),
  ('appointments:read', 'Read all appointments'), ('appointments:read_assigned', 'Read assigned appointments'),
  ('appointments:write', 'Manage all appointments'), ('appointments:write_assigned', 'Manage assigned appointments'),
  ('routes:read', 'Read all routes'), ('routes:read_assigned', 'Read assigned routes'), ('routes:write', 'Manage routes'),
  ('invoices:read', 'Read all invoices'), ('invoices:read_assigned', 'Read assigned customers'' invoices'),
  ('invoices:write', 'Manage all invoices'), ('invoices:write_assigned', 'Manage assigned customers'' invoices'),
  ('payments:read', 'Read payments'), ('payments:write', 'Manage payments and refunds'),
  ('payments:collect', 'Collect payments'), ('payments:collect_info', 'Save payment methods'),
  ('files:read', 'Read files'), ('files:write', 'Upload files'), ('notes:read', 'Read notes'), ('notes:write', 'Write notes'),
  ('users:read', 'Read users'), ('users:write', 'Manage users'), ('settings:read', 'Read company settings'), ('settings:write', 'Update company settings'),
  ('dashboard:read', 'View dashboard'), ('reports:read', 'View reports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (code, name, description) VALUES
  ('ADMIN', 'Admin', 'Office administrator with full access except owner-only actions'),
  ('OFFICE_MANAGER', 'Office Manager', 'Scheduling, billing and customer management')
ON CONFLICT (code) DO NOTHING;

-- ADMIN: everything in the catalog (owner-only actions are gated by role, not permission).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN' AND p.code <> '*'
ON CONFLICT DO NOTHING;

-- OFFICE_MANAGER: everything except user management, settings changes and deletes.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'OFFICE_MANAGER' AND p.code <> '*' AND p.code NOT IN ('users:write', 'settings:write', 'customers:delete')
ON CONFLICT DO NOTHING;

-- Trusted technicians invoice their own customers (initial charge + recurring plan at signing).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'invoices:write_assigned'
WHERE r.code = 'TRUSTED_TECHNICIAN'
ON CONFLICT DO NOTHING;
