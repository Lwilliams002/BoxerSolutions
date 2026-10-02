-- 046_owner_as_technician: the owner can be assigned visits and routes like a technician.
-- Every active owner gets an employee record (routes and appointments hang off employees).
INSERT INTO employees (user_id, job_title, hire_date, work_start_time, work_end_time, color)
SELECT u.id, 'Owner', CURRENT_DATE, '08:00', '17:00', '#111827'
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id AND r.code = 'OWNER'
WHERE u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id);

-- Route start point: employees still on the original placeholder (Austin, TX)
-- start from the office in Miami Gardens instead.
UPDATE employees
SET home_base_lat = 25.964, home_base_lng = -80.229, updated_at = now()
WHERE (home_base_lat IS NULL AND home_base_lng IS NULL)
   OR (abs(home_base_lat - 30.2672) < 0.0001 AND abs(home_base_lng - (-97.7431)) < 0.0001);
