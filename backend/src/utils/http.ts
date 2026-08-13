import { Response } from 'express';

export function ok(res: Response, data: unknown, message: string | null = null, status = 200) {
  return res.status(status).json({ success: true, data, message });
}

export function fail(res: Response, status: number, message: string, data: unknown = null) {
  return res.status(status).json({ success: false, data, message });
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function parsePagination(query: Record<string, unknown>, defaultPageSize = 25) {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(query.pageSize ?? String(defaultPageSize)), 10) || defaultPageSize));
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}
