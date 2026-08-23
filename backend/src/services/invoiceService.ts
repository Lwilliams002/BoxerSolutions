import PDFDocument from 'pdfkit';
import { PoolClient } from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pool, withTransaction, Queryable } from '../config/db';
import { ApiError } from '../utils/errors';
import { recordAudit } from './auditService';
import { rowsToCamel, toCamel } from './customerService';
import { storage } from '../integrations/storage';
import { notifications } from '../integrations/notifications';
import { communicationService, safelyQueueCommunication } from './communicationService';
import { DEFAULT_SETTINGS, getCompanySettings } from './settingsService';

const COMPANY = {
  name: DEFAULT_SETTINGS.companyName,
  address: DEFAULT_SETTINGS.address,
  phone: DEFAULT_SETTINGS.phone,
  email: 'billing@antserve.example.com',
};

interface InvoiceItemInput {
  serviceId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxable?: boolean;
}

function computeTotals(items: InvoiceItemInput[], taxRate: number) {
  let subtotal = 0;
  let taxableBase = 0;
  let discountTotal = 0;
  const lines = items.map((it) => {
    const gross = it.quantity * it.unitPrice;
    const discount = it.discount ?? 0;
    const lineTotal = Math.max(0, gross - discount);
    subtotal += gross;
    discountTotal += discount;
    if (it.taxable !== false) taxableBase += lineTotal;
    return { ...it, lineTotal };
  });
  const taxAmount = Math.round(taxableBase * taxRate * 100) / 100;
  const total = Math.round((subtotal - discountTotal + taxAmount) * 100) / 100;
  return { lines, subtotal: Math.round(subtotal * 100) / 100, discountTotal, taxAmount, total };
}

async function nextInvoiceNumber(db: Queryable) {
  const { rows } = await db.query("SELECT 'INV-' || nextval('invoice_number_seq') AS num");
  return rows[0].num as string;
}

async function insertInvoice(
  db: Queryable,
  data: {
    customerId: string; serviceLocationId?: string | null; appointmentId?: string | null;
    technicianId?: string | null; dueDate: string; taxRate: number; notes?: string | null;
    items: InvoiceItemInput[]; status?: string;
  },
  userId: string,
) {
  const { lines, subtotal, discountTotal, taxAmount, total } = computeTotals(data.items, data.taxRate);
  const invoiceNumber = await nextInvoiceNumber(db);
  const { rows } = await db.query(
    `INSERT INTO invoices (invoice_number, customer_id, service_location_id, appointment_id, technician_id,
       due_date, status, subtotal, discount_amount, tax_rate, tax_amount, total, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [invoiceNumber, data.customerId, data.serviceLocationId ?? null, data.appointmentId ?? null,
     data.technicianId ?? null, data.dueDate, data.status ?? 'open', subtotal, discountTotal,
     data.taxRate, taxAmount, total, data.notes ?? null, userId],
  );
  const invoice = rows[0];
  for (const line of lines) {
    await db.query(
      `INSERT INTO invoice_items (invoice_id, service_id, description, quantity, unit_price, discount, taxable, line_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [invoice.id, line.serviceId ?? null, line.description, line.quantity, line.unitPrice,
       line.discount ?? 0, line.taxable !== false, line.lineTotal],
    );
  }
  // keep customer balance in sync
  await db.query('UPDATE customers SET balance = balance + $1, updated_at = now() WHERE id = $2', [total, data.customerId]);
  return toCamel(invoice);
}

const INVOICE_SELECT = `
  SELECT i.*, c.first_name || ' ' || c.last_name AS customer_name, c.company AS customer_company,
         c.first_name AS customer_first_name,
         c.last_name AS customer_last_name,
         c.email AS customer_email,
         c.phone AS customer_phone,
         (i.total - i.amount_paid) AS balance_due,
         sl.address_line1 || ', ' || sl.city || ', ' || sl.state || ' ' || sl.postal_code AS service_address,
         (SELECT json_agg(json_build_object('id', ii.id, 'description', ii.description, 'quantity', ii.quantity,
            'unitPrice', ii.unit_price, 'discount', ii.discount, 'taxable', ii.taxable, 'lineTotal', ii.line_total))
          FROM invoice_items ii WHERE ii.invoice_id = i.id) AS items,
         f.storage_object_key AS pdf_object_key
  FROM invoices i
  JOIN customers c ON c.id = i.customer_id
  LEFT JOIN service_locations sl ON sl.id = i.service_location_id
  LEFT JOIN files f ON f.id = i.pdf_file_id`;

export const invoiceService = {
  async list(
    filters: {
      customerId?: string;
      status?: string;
      from?: string;
      to?: string;
      pastDue?: boolean;
      technicianId?: string | null;
    },
    limit: number,
    offset: number,
  ) {
    const where: string[] = ['i.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filters.customerId) { params.push(filters.customerId); where.push(`i.customer_id = $${params.length}`); }
    if (filters.status) { params.push(filters.status); where.push(`i.status = $${params.length}`); }
    if (filters.from) { params.push(filters.from); where.push(`i.invoice_date >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); where.push(`i.invoice_date <= $${params.length}`); }
    if (filters.pastDue) where.push(`i.status IN ('open','sent','partially_paid','past_due') AND i.due_date < CURRENT_DATE`);
    if (filters.technicianId) {
      params.push(filters.technicianId);
      where.push(`(
        EXISTS (
          SELECT 1 FROM customers c
          WHERE c.id = i.customer_id
            AND c.assigned_technician_id = $${params.length}
        )
        OR EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.customer_id = i.customer_id
            AND a.technician_id = $${params.length}
            AND a.deleted_at IS NULL
        )
      )`);
    }
    const whereSql = where.join(' AND ');
    const count = await pool.query(`SELECT count(*)::int AS total FROM invoices i WHERE ${whereSql}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `${INVOICE_SELECT} WHERE ${whereSql} ORDER BY i.invoice_date DESC, i.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rowsToCamel(rows), total: count.rows[0].total };
  },

  async getById(id: string, technicianId?: string | null) {
    const where = ['i.id = $1', 'i.deleted_at IS NULL'];
    const params: unknown[] = [id];
    if (technicianId) {
      params.push(technicianId);
      where.push(`(
        EXISTS (
          SELECT 1 FROM customers c
          WHERE c.id = i.customer_id
            AND c.assigned_technician_id = $${params.length}
        )
        OR EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.customer_id = i.customer_id
            AND a.technician_id = $${params.length}
            AND a.deleted_at IS NULL
        )
      )`);
    }
    const { rows } = await pool.query(`${INVOICE_SELECT} WHERE ${where.join(' AND ')}`, params);
    if (!rows[0]) throw ApiError.notFound('Invoice not found');
    return toCamel(rows[0]);
  },

  async create(data: {
    customerId: string; serviceLocationId?: string | null; appointmentId?: string | null;
    technicianId?: string | null; dueDate?: string; taxRate?: number; notes?: string | null;
    items: InvoiceItemInput[];
  }, userId: string) {
    const invoice = await withTransaction(async (tx) => {
      const settings = await getCompanySettings(tx);
      const dueDate = data.dueDate ?? (() => {
        const d = new Date();
        d.setDate(d.getDate() + settings.invoiceDueDays);
        return d.toISOString().slice(0, 10);
      })();
      const invoice = await insertInvoice(tx, { ...data, dueDate, taxRate: data.taxRate ?? settings.defaultTaxRate }, userId);
      await recordAudit({ userId, action: 'invoice.created', entityType: 'invoice', entityId: (invoice as any).id, newValue: { total: (invoice as any).total } }, tx);
      return invoice;
    });
    safelyQueueCommunication(() => communicationService.sendInvoiceTemplate((invoice as any).id, 'invoice_created', null));
    return invoice;
  },

  /** Automatic invoice generation from a completed appointment (spec §24). */
  async createFromAppointment(tx: PoolClient, appointment: any, userId: string, taxRate?: number) {
    const settings = await getCompanySettings(tx);
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + settings.invoiceDueDays);
    const items: InvoiceItemInput[] = (appointment.services ?? []).map((s: any) => ({
      serviceId: s.serviceId,
      description: s.name,
      quantity: s.quantity,
      unitPrice: Number(s.unitPrice),
      taxable: s.taxable !== false,
    }));
    const invoice = await insertInvoice(tx, {
      customerId: appointment.customerId,
      serviceLocationId: appointment.serviceLocationId,
      appointmentId: appointment.id,
      technicianId: appointment.technicianId,
      dueDate: dueDate.toISOString().slice(0, 10),
      taxRate: taxRate ?? settings.defaultTaxRate,
      items,
    }, userId);
    await recordAudit({ userId, action: 'invoice.auto_generated', entityType: 'invoice', entityId: (invoice as any).id, newValue: { appointmentId: appointment.id } }, tx);
    return invoice;
  },

  /**
   * Render a professional PDF, upload it to object storage (Wasabi in prod),
   * record file metadata in the DB, and link it to the invoice.
   */
  async generatePdf(invoiceId: string, userId: string) {
    const invoice = (await this.getById(invoiceId)) as any;
    const settings = await getCompanySettings();
    const company = { ...COMPANY, name: settings.companyName, address: settings.address, phone: settings.phone };

    const buffer: Buffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const brand = {
        black: '#0D0D0D',
        teal: '#2DC4A2',
        tealDark: '#24957D',
        slate: '#5F7F7B',
        card: '#F5FAF8',
        line: '#D8E8E4',
        text: '#111827',
      };
      const left = 50;
      const right = 562;
      const fullWidth = right - left;

      // Branded top bar
      doc.rect(0, 0, 612, 96).fill(brand.black);
      const logoCandidates = [
        path.resolve(__dirname, '../../../mobile/assets/logo.png'),
        path.resolve(__dirname, '../../../mobile/assets/logo-mark.png'),
      ];
      const logoPath = logoCandidates.find((p) => fs.existsSync(p));
      if (logoPath) {
        try {
          doc.image(logoPath, left, 20, { fit: [48, 48] });
        } catch {
          // Continue without logo if image cannot be loaded.
        }
      }
      doc
        .fillColor('#FFFFFF')
        .fontSize(20)
        .text(company.name, left + 58, 24, { width: 330, lineBreak: false })
        .fontSize(10)
        .fillColor('#B9D7D0')
        .text(`${company.phone}  ·  ${company.email}`, left + 58, 50, { width: 340, lineBreak: false });
      doc
        .fontSize(22)
        .fillColor('#FFFFFF')
        .text('INVOICE', 420, 26, { width: 140, align: 'right' })
        .fontSize(11)
        .fillColor('#B9D7D0')
        .text(invoice.invoiceNumber, 420, 54, { width: 140, align: 'right' });

      doc.y = 110;

      // Invoice summary card
      doc.roundedRect(left, doc.y, fullWidth, 102, 12).fill(brand.card);
      const summaryTop = doc.y + 14;
      doc.fillColor(brand.slate).fontSize(10).text('BILL TO', left + 14, summaryTop);
      doc.fillColor(brand.text).fontSize(13).text(invoice.customerName, left + 14, summaryTop + 14);
      if (invoice.customerCompany) doc.fillColor('#374151').fontSize(10).text(invoice.customerCompany, left + 14, summaryTop + 32);
      if (invoice.serviceAddress) doc.fillColor('#4B5563').fontSize(9).text(invoice.serviceAddress, left + 14, summaryTop + 46, { width: 310 });

      const statusLabel = String(invoice.status).replace('_', ' ').toUpperCase();
      const statusWidth = doc.widthOfString(statusLabel) + 20;
      doc.roundedRect(right - statusWidth - 14, summaryTop, statusWidth, 22, 10).fill('#D9F4ED');
      doc.fillColor(brand.tealDark).fontSize(10).text(statusLabel, right - statusWidth - 4, summaryTop + 6, { width: statusWidth - 8, align: 'center' });
      doc
        .fillColor('#4B5563')
        .fontSize(9)
        .text(`Invoice Date`, 400, summaryTop + 34, { width: 70 })
        .text(`Due Date`, 493, summaryTop + 34, { width: 60 });
      doc
        .fillColor(brand.text)
        .fontSize(11)
        .text(new Date(invoice.invoiceDate).toLocaleDateString('en-US'), 400, summaryTop + 48, { width: 84 })
        .text(new Date(invoice.dueDate).toLocaleDateString('en-US'), 486, summaryTop + 48, { width: 76 });
      doc.y += 122;

      // Line-item table
      const startX = left;
      const headerHeight = 20;
      const rowHeight = 18;
      const headerToRowGap = 6;
      const rowTextTop = 3;
      let y = doc.y;
      doc.fontSize(9).fillColor('#fff');
      doc.rect(startX, y, 512, headerHeight).fill(brand.black);
      doc
        .fillColor('#fff')
        .text('DESCRIPTION', startX + 6, y + 5, { width: 250 })
        .text('QTY', startX + 260, y + 5, { width: 50, align: 'right' })
        .text('UNIT PRICE', startX + 320, y + 5, { width: 80, align: 'right' })
        .text('AMOUNT', startX + 410, y + 5, { width: 96, align: 'right' });
      y += headerHeight + headerToRowGap;

      doc.fillColor('#000');
      (invoice.items ?? []).forEach((item: any, index: number) => {
        const rowBg = index % 2 === 0 ? '#FFFFFF' : '#F7FBFA';
        doc.rect(startX, y, 512, rowHeight).fill(rowBg);
        doc.fontSize(9)
          .fillColor(brand.text)
          .text(item.description, startX + 6, y + rowTextTop, { width: 250 })
          .text(String(item.quantity), startX + 260, y + rowTextTop, { width: 50, align: 'right' })
          .text(`$${Number(item.unitPrice).toFixed(2)}`, startX + 320, y + rowTextTop, { width: 80, align: 'right' })
          .text(`$${Number(item.lineTotal).toFixed(2)}`, startX + 410, y + rowTextTop, { width: 96, align: 'right' });
        y += rowHeight;
      });
      doc.rect(startX, y, 512, 1).fill(brand.line);

      y += 10;
      const totals: [string, string][] = [
        ['Subtotal', `$${Number(invoice.subtotal).toFixed(2)}`],
        ...(Number(invoice.discountAmount) > 0 ? [['Discount', `-$${Number(invoice.discountAmount).toFixed(2)}`] as [string, string]] : []),
        [`Tax (${(Number(invoice.taxRate) * 100).toFixed(2)}%)`, `$${Number(invoice.taxAmount).toFixed(2)}`],
        ['TOTAL', `$${Number(invoice.total).toFixed(2)}`],
        ['Amount Paid', `$${Number(invoice.amountPaid).toFixed(2)}`],
        ['Balance Due', `$${(Number(invoice.total) - Number(invoice.amountPaid)).toFixed(2)}`],
      ];
      for (const [label, value] of totals) {
        const bold = label === 'TOTAL' || label === 'Balance Due';
        const valueColor = label === 'Balance Due' && Number(invoice.total) - Number(invoice.amountPaid) > 0 ? '#C2410C' : brand.text;
        doc.fontSize(bold ? 11 : 9)
          .fillColor('#4B5563')
          .text(label, startX + 300, y, { width: 100, align: 'right' })
          .fillColor(valueColor)
          .text(value, startX + 410, y, { width: 96, align: 'right' });
        y += bold ? 18 : 15;
      }

      if (invoice.notes) {
        doc.moveDown(2);
        doc.fontSize(9).fillColor('#444').text(`Notes: ${invoice.notes}`, startX, y + 10, { width: 500 });
      }
      doc.rect(0, 740, 612, 22).fill('#ECF7F3');
      doc
        .fontSize(8)
        .fillColor(brand.tealDark)
        .text('Thank you for your business.', startX, 747, { width: 512, align: 'center' });
      doc.end();
    });

    const fileId = crypto.randomUUID();
    const objectKey = `invoices/${invoiceId}/${invoice.invoiceNumber}.pdf`;
    await storage.putObject(objectKey, buffer, 'application/pdf');

    return withTransaction(async (tx) => {
      const fileRes = await tx.query(
        `INSERT INTO files (id, customer_id, invoice_id, file_type, file_name, mime_type, file_size,
           storage_bucket, storage_object_key, upload_status, uploaded_by)
         VALUES ($1,$2,$3,'invoice_pdf',$4,'application/pdf',$5,$6,$7,'uploaded',$8)
         ON CONFLICT (storage_object_key) DO UPDATE SET file_size = EXCLUDED.file_size, updated_at = now()
         RETURNING *`,
        [fileId, invoice.customerId, invoiceId, `${invoice.invoiceNumber}.pdf`, buffer.length, storage.bucket, objectKey, userId],
      );
      await tx.query('UPDATE invoices SET pdf_file_id = $1, updated_at = now() WHERE id = $2', [fileRes.rows[0].id, invoiceId]);
      await recordAudit({ userId, action: 'invoice.pdf_generated', entityType: 'invoice', entityId: invoiceId }, tx);
      return { fileId: fileRes.rows[0].id, objectKey, size: buffer.length };
    });
  },

  async send(invoiceId: string, userId: string) {
    const invoice = (await this.getById(invoiceId)) as any;
    if (invoice.status === 'void') throw ApiError.badRequest('Cannot send a void invoice');
    if (!invoice.pdfFileId) await this.generatePdf(invoiceId, userId);
    const newStatus = ['draft'].includes(invoice.status) ? 'sent' : invoice.status;
    const { rows } = await pool.query(
      `UPDATE invoices SET status = $1, sent_at = now(), updated_at = now() WHERE id = $2 RETURNING *`,
      [newStatus, invoiceId],
    );
    safelyQueueCommunication(async () => {
      await notifications.send({
        customerId: invoice.customerId, channel: 'email', type: 'invoice_created',
        title: `Invoice ${invoice.invoiceNumber}`, body: `Your invoice for $${Number(invoice.total).toFixed(2)} is ready.`,
      });
    });
    await recordAudit({ userId, action: 'invoice.sent', entityType: 'invoice', entityId: invoiceId });
    return toCamel(rows[0]);
  },

  async voidInvoice(invoiceId: string, userId: string) {
    const invoice = (await this.getById(invoiceId)) as any;
    if (Number(invoice.amountPaid) > 0) throw ApiError.badRequest('Cannot void an invoice with payments');
    return withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE invoices SET status = 'void', updated_at = now() WHERE id = $1 RETURNING *`,
        [invoiceId],
      );
      await tx.query('UPDATE customers SET balance = balance - $1, updated_at = now() WHERE id = $2', [invoice.total, invoice.customerId]);
      await recordAudit({ userId, action: 'invoice.voided', entityType: 'invoice', entityId: invoiceId, previousValue: { status: invoice.status } }, tx);
      return toCamel(rows[0]);
    });
  },
};
