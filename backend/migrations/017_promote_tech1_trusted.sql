DELETE FROM user_roles
WHERE user_id = (SELECT id FROM users WHERE email = 'tech1@antserve.dev')
  AND role_id = (SELECT id FROM roles WHERE code = 'TECHNICIAN');

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.code = 'TRUSTED_TECHNICIAN'
WHERE u.email = 'tech1@antserve.dev'
ON CONFLICT DO NOTHING;
