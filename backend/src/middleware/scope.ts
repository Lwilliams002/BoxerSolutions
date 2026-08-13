import { Request } from 'express';
import { ApiError } from '../utils/errors';
import { pool } from '../config/db';

/**
 * Data scoping for field technicians: users who only hold "*_assigned"
 * permissions are restricted to records tied to their employee id.
 * Returns the employeeId to scope by, or null for unrestricted access.
 */
export function technicianScope(req: Request, fullPermission: string): string | null {
  const user = req.user!;
  if (user.permissions.includes('*') || user.permissions.includes(fullPermission)) return null;
  if (!user.employeeId) throw ApiError.forbidden('No employee profile linked to this account');
  return user.employeeId;
}

/** Assert the technician is allowed to touch this customer (assigned, or has an appointment with them). */
export async function assertCustomerAccess(employeeId: string | null, customerId: string) {
  if (!employeeId) return;
  const { rows } = await pool.query(
    `SELECT 1 FROM customers c
     WHERE c.id = $1 AND (
       c.assigned_technician_id = $2
       OR EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = c.id AND a.technician_id = $2 AND a.deleted_at IS NULL)
     )`,
    [customerId, employeeId],
  );
  if (!rows[0]) throw ApiError.forbidden('You do not have access to this customer');
}

export async function assertAppointmentAccess(employeeId: string | null, appointmentId: string) {
  if (!employeeId) return;
  const { rows } = await pool.query(
    'SELECT 1 FROM appointments WHERE id = $1 AND technician_id = $2 AND deleted_at IS NULL',
    [appointmentId, employeeId],
  );
  if (!rows[0]) throw ApiError.forbidden('You do not have access to this appointment');
}
