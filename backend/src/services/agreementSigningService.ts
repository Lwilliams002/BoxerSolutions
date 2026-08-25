import jwt from 'jsonwebtoken';
import PDFDocument from 'pdfkit';
import { pool } from '../config/db';
import { config } from '../config';
import { ApiError } from '../utils/errors';
import { storage } from '../integrations/storage';

const SIGNING_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

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
  if (!original) return `service-agreement-signed-${Date.now()}.pdf`;
  if (original.startsWith('service-agreement-unsigned-')) {
    return original.replace('service-agreement-unsigned-', 'service-agreement-signed-');
  }
  return original;
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

function parseAgreementSnapshot(noteBody: string): AgreementSnapshot | null {
  const lines = noteBody
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines[0] || lines[0].toUpperCase() !== 'SERVICE AGREEMENT') return null;

  const lineItems: AgreementLineItem[] = [];
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

  return { lineItems, initialTotal, recurringTotal, termMonths, coveredPests };
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

function money(v: number) {
  return `$${v.toFixed(2)}`;
}

function signedAgreementPdf(data: {
  customerName: string;
  signedAt: Date;
  signerName: string;
  initials: string;
  signaturePng: Buffer;
  customerEmail: string | null;
  customerPhone: string | null;
  customerType: string;
  serviceAddress: string | null;
  agreement: AgreementSnapshot | null;
}) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).text('Service Agreement');
    doc.moveDown(1);
    doc.fontSize(10).fillColor('#607D78').text(COMPANY_NAME);
    doc.fillColor('#000');
    doc.fontSize(12).text(`Customer: ${data.customerName}`);
    if (data.customerEmail) doc.text(`Email: ${data.customerEmail}`);
    if (data.customerPhone) doc.text(`Phone: ${data.customerPhone}`);
    doc.text(`Account Type: ${data.customerType}`);
    if (data.serviceAddress) doc.text(`Service Address: ${data.serviceAddress}`);
    doc.moveDown(1);

    doc.fontSize(13).text('Services & Pricing');
    doc.moveDown(0.4);
    if (data.agreement?.lineItems.length) {
      for (const item of data.agreement.lineItems) {
        doc.fontSize(11).text(
          `• ${item.label} — Initial ${money(item.initial)} / Regular ${money(item.regular)}`,
        );
      }
    } else {
      doc.fontSize(11).text('No service pricing details were provided in the saved agreement summary.');
    }
    if (data.agreement?.initialTotal != null) doc.fontSize(11).text(`Initial Total: ${money(data.agreement.initialTotal)}`);
    if (data.agreement?.recurringTotal != null) doc.fontSize(11).text(`Recurring Total: ${money(data.agreement.recurringTotal)}/service`);
    doc.moveDown(1);

    doc.fontSize(13).text('Covered Pests');
    doc.moveDown(0.4);
    if (data.agreement?.coveredPests.length) {
      doc.fontSize(11).text(data.agreement.coveredPests.join(', '));
    } else {
      doc.fontSize(11).text('No covered pests were listed.');
    }
    doc.moveDown(1);

    const termMonths = data.agreement?.termMonths ?? AGREEMENT_TERM_MONTHS_DEFAULT;
    doc.fontSize(13).text('Terms & Conditions');
    doc.moveDown(0.4);
    doc.fontSize(10.5).text(
      `This agreement is for an initial period of ${termMonths} month(s). You, the customer, may cancel this transaction any time prior to midnight of the third business day after the date of this transaction by giving written notice of cancellation to ${COMPANY_NAME}. Upon completion of the initial service, the customer agrees to pay the full initial service charge. Recurring treatments continue at the agreed frequency until canceled by the customer. ${COMPANY_NAME} will re-treat at no additional charge between scheduled visits if covered pest activity persists.`,
      { lineGap: 2 },
    );
    doc.moveDown(0.4);
    doc.text(
      'I have read and agree to the terms and conditions of this agreement, including any additional disclosures listed above. I confirm my contact information is entered correctly and agree to receive account notifications electronically.',
      { lineGap: 2 },
    );
    doc.moveDown(1);

    doc.fontSize(13).text('Customer Signature');
    doc.moveDown(0.4);
    doc.text(`Signed At: ${data.signedAt.toLocaleString('en-US')}`);
    doc.text(`Signer Name: ${data.signerName}`);
    doc.text(`Initials: ${data.initials}`);
    doc.moveDown(1);
    doc.text('Signature:');
    doc.image(data.signaturePng, { fit: [320, 120] });
    doc.end();
  });
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
      alreadySigned: row.upload_status === 'uploaded',
    };
  },

  async signFromToken(data: {
    token: string;
    signerName: string;
    initials: string;
    signatureDataUrl: string;
    acceptedTerms: boolean;
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
      `SELECT f.*, c.first_name, c.last_name, c.company, c.customer_type, c.email, c.phone,
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
      storage_object_key: string;
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
    if (row.upload_status === 'uploaded') {
      return { alreadySigned: true, customerId: row.customer_id };
    }
    const customerName = row.company || `${row.first_name} ${row.last_name}`;
    const addressParts = [row.address_line1, row.address_line2, row.city, row.state, row.postal_code]
      .filter((part): part is string => !!part && part.trim().length > 0);
    const agreement = await loadAgreementSnapshot(row.customer_id);
    const pdf = await signedAgreementPdf({
      customerName,
      signedAt: new Date(),
      signerName,
      initials,
      signaturePng,
      customerEmail: row.email,
      customerPhone: row.phone,
      customerType: row.customer_type,
      serviceAddress: addressParts.length ? addressParts.join(', ') : null,
      agreement,
    });
    await storage.putObject(row.storage_object_key, pdf, 'application/pdf');
    await pool.query(
      `UPDATE files
       SET upload_status = 'uploaded',
           mime_type = 'application/pdf',
           file_size = $2,
           file_name = $3,
           updated_at = now()
       WHERE id = $1`,
      [row.id, pdf.length, agreementSignedFileName(row.file_name)],
    );
    return { alreadySigned: false, customerId: row.customer_id };
  },
};
