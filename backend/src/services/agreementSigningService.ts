import PDFDocument from 'pdfkit';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db';
import { config } from '../config';
import { ApiError } from '../utils/errors';
import { storage } from '../integrations/storage';
import { invoiceService } from './invoiceService';
import { paymentService } from './paymentService';

const SIGNING_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const UNSIGNED_AGREEMENT_PREFIX = 'service-agreement-unsigned-';
const SIGNED_AGREEMENT_PREFIX = 'service-agreement-signed-';
const AGREEMENT_SIGNATURE_PREFIX = 'service-agreement-signature-';

interface SigningTokenPayload {
  type: 'agreement_sign';
  customerId: string;
  fileId: string;
}

interface AgreementLineItem {
  label: string;
  initial: number;
  regular: number;
}

interface AgreementSnapshot {
  lineItems: AgreementLineItem[];
  initialDiscount: number | null;
  initialTotal: number | null;
  recurringTotal: number | null;
  termMonths: number;
  coveredPests: string[];
}

const AGREEMENT_TERM_MONTHS_DEFAULT = 12;
const COMPANY_NAME = 'Boxer Solutions Pest Control';

function issueSigningToken(payload: SigningTokenPayload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: SIGNING_TOKEN_TTL_SECONDS });
}

function parseSigningToken(token: string): SigningTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch {
    throw ApiError.badRequest('This signing link is invalid or has expired.');
  }
  const parsed = decoded as Partial<SigningTokenPayload> | null;
  if (!parsed || parsed.type !== 'agreement_sign' || !parsed.customerId || !parsed.fileId) {
    throw ApiError.badRequest('This signing link is invalid.');
  }
  return parsed as SigningTokenPayload;
}

function agreementSignedFileName(original: string | null | undefined) {
  const fallback = `${SIGNED_AGREEMENT_PREFIX}${Date.now()}.pdf`;
  if (!original) return fallback;
  const normalized = original.startsWith(UNSIGNED_AGREEMENT_PREFIX)
    ? original.replace(UNSIGNED_AGREEMENT_PREFIX, SIGNED_AGREEMENT_PREFIX)
    : original.startsWith(SIGNED_AGREEMENT_PREFIX)
      ? original
      : fallback;
  return normalized.toLowerCase().endsWith('.pdf')
    ? normalized
    : normalized.replace(/\.[^.]+$/, '') + '.pdf';
}

function isUnsignedAgreementFileName(fileName: string | null | undefined) {
  return Boolean(fileName && fileName.startsWith(UNSIGNED_AGREEMENT_PREFIX));
}

function isSignedAgreementFileName(fileName: string | null | undefined) {
  return Boolean(fileName && fileName.startsWith(SIGNED_AGREEMENT_PREFIX));
}

function parseSignatureDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw ApiError.badRequest('Signature must be a PNG image.');
  return Buffer.from(match[1], 'base64');
}

function parseAmount(raw: string) {
  const normalized = raw.replace(/[$,]/g, '').trim();
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function customerTypeLabel(raw: string | null | undefined) {
  if (!raw) return 'Account';
  return `${raw.slice(0, 1).toUpperCase()}${raw.slice(1)} Account`;
}

function parseClientSignedAt(raw: string | undefined) {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatSignedAtForAgreement(signedAt: Date, signerTimeZone: string | undefined) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZoneName: 'short',
      ...(signerTimeZone ? { timeZone: signerTimeZone } : {}),
    }).format(signedAt);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZoneName: 'short',
    }).format(signedAt);
  }
}

async function buildSignedAgreementPdf(input: {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerType: string | null;
  serviceAddress: string | null;
  agreement: AgreementSnapshot | null;
  signerName: string;
  initials: string;
  signedAtLabel: string;
  signaturePng: Buffer;
}) {
  const termMonths = input.agreement?.termMonths ?? AGREEMENT_TERM_MONTHS_DEFAULT;
  const lineItems = input.agreement?.lineItems ?? [];
  const initialDiscount = Math.max(0, input.agreement?.initialDiscount ?? 0);
  const initialTotal = input.agreement?.initialTotal ?? lineItems.reduce((sum, item) => sum + item.initial, 0);
  const recurringTotal = input.agreement?.recurringTotal ?? lineItems.reduce((sum, item) => sum + item.regular, 0);
  const initialSubtotal = initialTotal + initialDiscount;
  const coveredPests = input.agreement?.coveredPests?.length
    ? input.agreement.coveredPests.join(', ')
    : 'No covered pests were listed.';

  const terms =
    `This agreement is for an initial period of ${termMonths} month(s). You, the customer, may cancel this transaction any time prior to midnight of the third business day after the date of this transaction by giving written notice of cancellation to ${COMPANY_NAME}. Upon completion of the initial service, the customer agrees to pay the full initial service charge. Recurring treatments continue at the agreed frequency until canceled by the customer. ${COMPANY_NAME} will re-treat at no additional charge between scheduled visits if covered pest activity persists. If this agreement is terminated before the end of the ${termMonths}-month term, the customer agrees to repay any initial service discount applied under this agreement.`;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0D0D0D').text('SERVICE AGREEMENT');
    doc.fontSize(11).fillColor('#2B5F54').text(COMPANY_NAME);
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(10).fillColor('#0D0D0D')
      .text(`Customer: ${input.customerName}`)
      .text(`Email: ${input.customerEmail ?? 'No email on file'}`)
      .text(`Phone: ${input.customerPhone ?? 'No phone on file'}`)
      .text(`Account Type: ${customerTypeLabel(input.customerType)}`)
      .text(`Service Address: ${input.serviceAddress ?? 'Not provided'}`);

    doc.moveDown(0.9);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0D0D0D').text('Services & Pricing');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor('#0D0D0D');
    if (!lineItems.length) {
      doc.text('No service pricing details were found for this agreement.');
    } else {
      for (const item of lineItems) {
        doc.text(`${item.label}`);
        doc.text(`  Initial ${formatMoney(item.initial)}  |  Regular ${formatMoney(item.regular)}`);
      }
    }
    doc.moveDown(0.5);
    doc.text(`Initial Subtotal: ${formatMoney(initialSubtotal)}`);
    if (initialDiscount > 0) doc.text(`Initial Discount: -${formatMoney(initialDiscount)}`);
    doc.text(`Initial Total: ${formatMoney(initialTotal)}`);
    doc.text(`Recurring Total: ${formatMoney(recurringTotal)}/service`);

    doc.moveDown(0.9);
    doc.font('Helvetica-Bold').fontSize(11).text('Covered Pests');
    doc.font('Helvetica').fontSize(10).text(coveredPests);

    doc.moveDown(0.9);
    doc.font('Helvetica-Bold').fontSize(11).text('Terms & Conditions');
    doc.font('Helvetica').fontSize(9).fillColor('#30433F').text(terms, { lineGap: 2 });
    doc.moveDown(0.6);
    doc.text(
      'I have read and agree to the terms and conditions of this agreement, including any additional disclosures listed above. I confirm my contact information is entered correctly and agree to receive account notifications electronically.',
      { lineGap: 2 },
    );

    if (doc.y > 620) doc.addPage();
    doc.moveDown(0.9);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0D0D0D').text('Customer Signature');
    doc.font('Helvetica').fontSize(10)
      .text(`Signed at: ${input.signedAtLabel}`)
      .text(`Signer Name: ${input.signerName}`)
      .text(`Initials: ${input.initials}`);
    doc.moveDown(0.5);
    doc.image(input.signaturePng, { fit: [220, 90] });

    doc.end();
  });
}

async function buildSignedAgreementPdfFromOriginalImage(input: {
  originalImage: Buffer;
  signerName: string;
  initials: string;
  signedAtLabel: string;
  signaturePng: Buffer;
  customerName: string;
}) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const pageHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom - 28;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#607D78')
      .text('Original agreement content', { align: 'left' });
    doc.moveDown(0.4);
    doc.image(input.originalImage, { fit: [pageWidth, pageHeight], align: 'center' });

    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#0D0D0D').text('SERVICE AGREEMENT SIGNATURE CERTIFICATE');
    doc.moveDown(0.7);
    doc.font('Helvetica').fontSize(11).fillColor('#0D0D0D')
      .text(`Customer: ${input.customerName}`)
      .text(`Signed at: ${input.signedAtLabel}`)
      .text(`Signer Name: ${input.signerName}`)
      .text(`Initials: ${input.initials}`)
      .text('Agreement status: Signed electronically');
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(11).text('Drawn Signature');
    doc.moveDown(0.4);
    doc.image(input.signaturePng, { fit: [240, 100] });

    doc.end();
  });
}

function parseAgreementSnapshot(noteBody: string): AgreementSnapshot | null {
  const lines = noteBody
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines[0] || lines[0].toUpperCase() !== 'SERVICE AGREEMENT') return null;

  const lineItems: AgreementLineItem[] = [];
  let initialDiscount: number | null = null;
  let initialTotal: number | null = null;
  let recurringTotal: number | null = null;
  let termMonths = AGREEMENT_TERM_MONTHS_DEFAULT;
  let coveredPests: string[] = [];

  for (const line of lines) {
    const itemMatch = line.match(/^•\s*(.+?)\s+—\s+Initial\s+(.+?)\s+\/\s+Regular\s+(.+)$/i);
    if (itemMatch) {
      const initial = parseAmount(itemMatch[2]);
      const regular = parseAmount(itemMatch[3]);
      if (initial != null && regular != null) {
        lineItems.push({ label: itemMatch[1], initial, regular });
      }
      continue;
    }
    if (line.startsWith('Initial Total:')) {
      initialTotal = parseAmount(line.replace('Initial Total:', ''));
      continue;
    }
    if (line.startsWith('Initial Discount:')) {
      const parsed = parseAmount(line.replace('Initial Discount:', ''));
      initialDiscount = parsed == null ? null : Math.abs(parsed);
      continue;
    }
    if (line.startsWith('Recurring Total:')) {
      recurringTotal = parseAmount(line.replace('Recurring Total:', '').replace('/service', ''));
      continue;
    }
    if (line.startsWith('Term:')) {
      const match = line.match(/(\d+)/);
      if (match) termMonths = Number.parseInt(match[1], 10);
      continue;
    }
    if (line.startsWith('Covered pests:')) {
      const pests = line.replace('Covered pests:', '').trim();
      coveredPests = pests
        ? pests.split(',').map((p) => p.trim()).filter(Boolean)
        : [];
    }
  }

  return { lineItems, initialDiscount, initialTotal, recurringTotal, termMonths, coveredPests };
}

async function loadAgreementSnapshot(customerId: string) {
  const { rows } = await pool.query(
    `SELECT body
     FROM notes
     WHERE customer_id = $1
       AND deleted_at IS NULL
       AND body LIKE 'SERVICE AGREEMENT%'
     ORDER BY created_at DESC
     LIMIT 1`,
    [customerId],
  );
  if (!rows[0]?.body) return null;
  return parseAgreementSnapshot(String(rows[0].body));
}

async function getOwnerUserId() {
  const { rows } = await pool.query(
    `SELECT u.id
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.code = 'OWNER'
     ORDER BY u.created_at ASC
     LIMIT 1`,
  );
  return rows[0]?.id as string | undefined;
}

async function chargeSignedAgreementInitial(customerId: string, agreement: AgreementSnapshot | null) {
  if (!agreement || agreement.initialTotal == null || agreement.initialTotal <= 0) {
    return { charged: false, invoiceId: null };
  }

  const ownerUserId = await getOwnerUserId();
  if (!ownerUserId) {
    return { charged: false, invoiceId: null, reason: 'Owner account not available to record the initial charge.' };
  }

  try {
    const invoice = await invoiceService.create({
     customerId,
     dueDate: new Date().toISOString().slice(0, 10),
     taxRate: 0,
     notes: 'Initial agreement charge',
     items: [{
       description: 'Initial service agreement charge',
       quantity: 1,
       unitPrice: Number(agreement.initialTotal.toFixed(2)),
       taxable: false,
     }],
    }, ownerUserId);

    const methods = await paymentService.listMethods(customerId);
    const method = methods.find((item: any) => item.isDefault) ?? methods[0];
    if (!method) {
     return { charged: false, invoiceId: (invoice as any).id, reason: 'No saved payment method is available to charge the initial agreement.' };
    }

    try {
     const result = await paymentService.chargeInvoice((invoice as any).id, method.id, null, ownerUserId, null);
     return {
       charged: true,
       invoiceId: (invoice as any).id,
       paymentMethodId: method.id,
       receipt: result.receipt,
     };
    } catch (error) {
     return {
       charged: false,
       invoiceId: (invoice as any).id,
       reason: error instanceof Error ? error.message : 'Initial agreement charge failed.',
     };
    }
  } catch (error) {
    return {
     charged: false,
     invoiceId: null,
     reason: error instanceof Error ? error.message : 'Initial agreement invoice could not be created.',
    };
  }
}

export const agreementSigningService = {
  async getLatestUnsignedAgreement(customerId: string) {
    const { rows } = await pool.query(
      `SELECT id, customer_id
       FROM files
       WHERE customer_id = $1
         AND file_type = 'document'
         AND file_name LIKE 'service-agreement-unsigned-%'
         AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [customerId],
    );
    return rows[0] as { id: string; customer_id: string } | undefined;
  },

  async buildReviewUrl(customerId: string, apiBaseUrl: string) {
    const unsigned = await this.getLatestUnsignedAgreement(customerId);
    if (!unsigned) throw ApiError.badRequest('No unsigned agreement found for this customer.');
    const token = issueSigningToken({
      type: 'agreement_sign',
      customerId,
      fileId: unsigned.id,
    });
    return `${apiBaseUrl}/api/v1/agreements/sign?token=${encodeURIComponent(token)}`;
  },

  async getSigningContext(token: string) {
    const payload = parseSigningToken(token);
    const { rows } = await pool.query(
      `SELECT f.id, f.customer_id, f.file_name, f.upload_status,
             c.first_name, c.last_name, c.company, c.customer_type, c.email, c.phone,
             sl.address_line1, sl.address_line2, sl.city, sl.state, sl.postal_code
       FROM files f
       JOIN customers c ON c.id = f.customer_id
       LEFT JOIN LATERAL (
         SELECT address_line1, address_line2, city, state, postal_code
         FROM service_locations
         WHERE customer_id = c.id
          AND deleted_at IS NULL
         ORDER BY is_primary DESC, created_at ASC
         LIMIT 1
       ) sl ON true
       WHERE f.id = $1
         AND f.customer_id = $2
         AND f.deleted_at IS NULL`,
      [payload.fileId, payload.customerId],
    );
    if (!rows[0]) throw ApiError.notFound('Agreement not found.');
    const row = rows[0] as {
      id: string;
      customer_id: string;
      file_name: string | null;
      upload_status: string;
      first_name: string;
      last_name: string;
      company: string | null;
      customer_type: string;
      email: string | null;
      phone: string | null;
      address_line1: string | null;
      address_line2: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
    };
    const customerName = row.company || `${row.first_name} ${row.last_name}`;
    const addressParts = [row.address_line1, row.address_line2, row.city, row.state, row.postal_code]
      .filter((part): part is string => !!part && part.trim().length > 0);
    const agreement = await loadAgreementSnapshot(row.customer_id);
    return {
      token,
      fileId: row.id,
      customerId: row.customer_id,
      customerName,
      customerEmail: row.email,
      customerPhone: row.phone,
      customerType: row.customer_type,
      serviceAddress: addressParts.length ? addressParts.join(', ') : null,
      fileName: row.file_name,
      agreement,
      alreadySigned: row.upload_status === 'uploaded' && isSignedAgreementFileName(row.file_name),
    };
  },

  async signFromToken(data: {
    token: string;
    signerName: string;
    initials: string;
    signatureDataUrl: string;
    acceptedTerms: boolean;
    signedAtIso?: string;
    signerTimeZone?: string;
  }) {
    if (!data.acceptedTerms) throw ApiError.badRequest('You must accept the agreement terms before signing.');
    const signerName = data.signerName.trim();
    const initials = data.initials.trim().toUpperCase();
    if (!signerName) throw ApiError.badRequest('Signer name is required.');
    if (!/^[A-Za-z]{1,4}$/.test(initials)) throw ApiError.badRequest('Initials must be 1-4 letters.');
    if (!data.signatureDataUrl) throw ApiError.badRequest('Drawn signature is required.');
    const signaturePng = parseSignatureDataUrl(data.signatureDataUrl);
    if (signaturePng.length > 1_500_000) throw ApiError.badRequest('Signature image is too large.');

    const payload = parseSigningToken(data.token);
    const { rows } = await pool.query(
      `SELECT f.*
       FROM files f
       WHERE f.id = $1
         AND f.customer_id = $2
         AND f.deleted_at IS NULL`,
      [payload.fileId, payload.customerId],
    );
    if (!rows[0]) throw ApiError.notFound('Agreement not found.');
    const row = rows[0] as {
      id: string;
      customer_id: string;
      file_name: string | null;
      storage_object_key: string;
      storage_bucket: string;
      upload_status: string;
      mime_type: string | null;
    };
    if (row.upload_status === 'uploaded' && isSignedAgreementFileName(row.file_name)) {
      return { alreadySigned: true, customerId: row.customer_id };
    }
    const sourceMime = row.mime_type?.toLowerCase() ?? null;
    const sourceIsPdf = sourceMime === 'application/pdf';
    const sourceIsImage = sourceMime === 'image/png' || sourceMime === 'image/jpeg';
    if (sourceMime && !sourceIsPdf && !sourceIsImage) {
      throw ApiError.badRequest('Agreement file must be a PDF or PNG/JPEG image.');
    }
    const signedAt = parseClientSignedAt(data.signedAtIso) ?? new Date();
    const signedAtLabel = formatSignedAtForAgreement(signedAt, data.signerTimeZone);
    const signedAtMs = Date.now();
    const signerSlug = signerName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'customer';
    const signatureObjectKey = `signatures/agreements/${row.customer_id}/${signedAtMs}-${row.id}.png`;
    await storage.putObject(signatureObjectKey, signaturePng, 'image/png');
    const customerRes = await pool.query(
      `SELECT c.first_name, c.last_name, c.company, c.customer_type, c.email, c.phone,
              sl.address_line1, sl.address_line2, sl.city, sl.state, sl.postal_code
       FROM customers c
       LEFT JOIN LATERAL (
         SELECT address_line1, address_line2, city, state, postal_code
         FROM service_locations
         WHERE customer_id = c.id
           AND deleted_at IS NULL
         ORDER BY is_primary DESC, created_at ASC
         LIMIT 1
       ) sl ON true
       WHERE c.id = $1
         AND c.deleted_at IS NULL`,
      [row.customer_id],
    );
    if (!customerRes.rows[0]) throw ApiError.notFound('Customer not found for agreement.');
    const customer = customerRes.rows[0] as {
      first_name: string;
      last_name: string;
      company: string | null;
      customer_type: string | null;
      email: string | null;
      phone: string | null;
      address_line1: string | null;
      address_line2: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
    };
    const addressParts = [customer.address_line1, customer.address_line2, customer.city, customer.state, customer.postal_code]
      .filter((part): part is string => !!part && part.trim().length > 0);
    const agreement = await loadAgreementSnapshot(row.customer_id);
    const customerName = customer.company || `${customer.first_name} ${customer.last_name}`;
    let signedPdf: Buffer;
    if (sourceIsImage) {
      const originalImage = await storage.getObject(row.storage_object_key);
      if (!originalImage.length) throw ApiError.badRequest('Agreement file is empty and cannot be signed.');
      signedPdf = await buildSignedAgreementPdfFromOriginalImage({
        originalImage,
        signerName,
        initials,
        signedAtLabel,
        signaturePng,
        customerName,
      });
    } else {
      signedPdf = await buildSignedAgreementPdf({
        customerName,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        customerType: customer.customer_type,
        serviceAddress: addressParts.length ? addressParts.join(', ') : null,
        agreement,
        signerName,
        initials,
        signedAtLabel,
        signaturePng,
      });
    }
    await storage.putObject(row.storage_object_key, signedPdf, 'application/pdf');
    await pool.query(
      `INSERT INTO files (
        customer_id, file_type, file_name, mime_type, file_size,
        storage_bucket, storage_object_key, upload_status
       )
       VALUES ($1, 'signature', $2, 'image/png', $3, $4, $5, 'uploaded')`,
      [
       row.customer_id,
       `${AGREEMENT_SIGNATURE_PREFIX}${signedAtMs}-${signerSlug}-${initials.toLowerCase()}.png`,
       signaturePng.length,
       row.storage_bucket || storage.bucket,
       signatureObjectKey,
      ],
    );
    await pool.query(
      `UPDATE files
       SET upload_status = 'uploaded',
           file_name = $2,
           mime_type = 'application/pdf',
           file_size = $3,
           updated_at = now()
       WHERE id = $1`,
      [row.id, agreementSignedFileName(row.file_name), signedPdf.length],
    );

    const initialCharge = await chargeSignedAgreementInitial(row.customer_id, agreement);
    return {
      alreadySigned: false,
      customerId: row.customer_id,
      initialInvoiceId: initialCharge.invoiceId,
      initialInvoiceCharged: initialCharge.charged,
      initialInvoiceChargeError: initialCharge.reason ?? null,
    };
  },
};
