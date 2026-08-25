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

function signedAgreementPdf(data: {
  customerName: string;
  signedAt: Date;
  signerName: string;
  initials: string;
  signaturePng: Buffer;
}) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(22).text('Service Agreement Signature Confirmation');
    doc.moveDown(1);
    doc.fontSize(12).text(`Customer: ${data.customerName}`);
    doc.text(`Signed At: ${data.signedAt.toLocaleString('en-US')}`);
    doc.text(`Signer Name: ${data.signerName}`);
    doc.text(`Initials: ${data.initials}`);
    doc.moveDown(1);
    doc.text('Signature:');
    doc.image(data.signaturePng, { fit: [320, 120] });
    doc.moveDown(7);
    doc.text('This document confirms the customer reviewed and signed the agreement via secure email link.');
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
              c.first_name, c.last_name, c.company
       FROM files f
       JOIN customers c ON c.id = f.customer_id
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
    };
    const customerName = row.company || `${row.first_name} ${row.last_name}`;
    return {
      token,
      fileId: row.id,
      customerId: row.customer_id,
      customerName,
      fileName: row.file_name,
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
      `SELECT f.*, c.first_name, c.last_name, c.company
       FROM files f
       JOIN customers c ON c.id = f.customer_id
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
    };
    if (row.upload_status === 'uploaded') {
      return { alreadySigned: true, customerId: row.customer_id };
    }
    const customerName = row.company || `${row.first_name} ${row.last_name}`;
    const pdf = await signedAgreementPdf({
      customerName,
      signedAt: new Date(),
      signerName,
      initials,
      signaturePng,
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
