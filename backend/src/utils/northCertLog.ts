import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from './logger';

/**
 * North certification logging.
 *
 * North's certification team asks integrators using the Server Post API,
 * CustomPay API, or Gateway Functions API to submit a TEXT FILE with the raw
 * request and response logs for each transaction type (Storage, Token Sale,
 * Refund, Reversal). This module appends a human-readable block per API call
 * to NORTH_CERT_LOG_PATH (default: logs/north-cert.log).
 *
 * PCI note: credentials and any card data fields are redacted before writing.
 * The BRIC-based flows never contain a PAN, but the legacy Recurring Billing
 * vault call does — those fields are always masked.
 */

const SENSITIVE_KEYS = [
  // Credentials / secrets
  'password', 'developerKey', 'authorization', 'x-api-key',
  // Session tokens grant access to the checkout session itself
  'SessionToken', 'sessionToken', 'token',
  // Card / bank data (PCI) — never allowed in logs
  'AccountNumber', 'CVV', 'cvv', 'RoutingNumber', 'number', 'accountNumber', 'routingNumber',
  'account_nbr', 'routing_nbr', 'auth_account_nbr', 'auth_card_nbr', 'cvv2', 'exp_date',
];

/** Rotate the log once it passes this size so it cannot fill the disk. */
const MAX_LOG_BYTES = 20 * 1024 * 1024;

function rotateIfLarge(filePath: string) {
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return; // no file yet
  }
  if (size <= MAX_LOG_BYTES) return;
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14); // yyyymmddHHMMSS
  fs.renameSync(filePath, `${filePath}.${stamp}.log`);
}

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.some((k) => k.toLowerCase() === key.toLowerCase())) {
    const str = String(value ?? '');
    if (/^\d{6,}$/.test(str)) return `****${str.slice(-4)}`;
    return '***REDACTED***';
  }
  return value;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const redacted = redactValue(k, v);
      out[k] = redacted === v ? redact(v) : redacted;
    }
    return out;
  }
  return value;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (/authorization|api-key|password|session-?token/i.test(k)) {
      out[k] = v.startsWith('Bearer ') ? 'Bearer ***REDACTED***' : '***REDACTED***';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Redact sensitive values in a url-encoded form body (EPX Server Post). */
function redactFormBody(body: string): string {
  return body
    .split('&')
    .map((pair) => {
      const [k, v = ''] = pair.split('=');
      if (SENSITIVE_KEYS.some((s) => s.toLowerCase() === decodeURIComponent(k).toLowerCase())) {
        return `${k}=***REDACTED***`;
      }
      return `${k}=${v}`;
    })
    .join('&');
}

export interface NorthCertLogEntry {
  api: string; // e.g. 'Embedded Checkout', 'Server Post', 'Gateway Functions', 'Recurring Billing'
  label: string; // e.g. 'STORAGE session create', 'TOKEN SALE', 'REFUND', 'REVERSAL (VOID)'
  method: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown; // object (JSON APIs) or string (form-encoded)
  status: number;
  statusText?: string;
  responseBody?: unknown; // object or raw string
}

export function northCertLog(entry: NorthCertLogEntry) {
  if (!config.north.certLogEnabled) return;
  try {
    const filePath = path.isAbsolute(config.north.certLogPath)
      ? config.north.certLogPath
      : path.resolve(process.cwd(), config.north.certLogPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    rotateIfLarge(filePath);

    const requestBody = typeof entry.requestBody === 'string'
      ? redactFormBody(entry.requestBody)
      : JSON.stringify(redact(entry.requestBody), null, 2);
    const responseBody = typeof entry.responseBody === 'string'
      ? entry.responseBody
      : JSON.stringify(redact(entry.responseBody), null, 2);

    const block = [
      '================================================================================',
      `[${new Date().toISOString()}] ${entry.api} — ${entry.label}`,
      '--- REQUEST ---',
      `${entry.method} ${entry.url}`,
      ...(entry.requestHeaders
        ? Object.entries(redactHeaders(entry.requestHeaders)).map(([k, v]) => `${k}: ${v}`)
        : []),
      '',
      requestBody ?? '(empty body)',
      '--- RESPONSE ---',
      `HTTP ${entry.status}${entry.statusText ? ` ${entry.statusText}` : ''}`,
      '',
      responseBody ?? '(empty body)',
      '',
    ].join('\n');
    fs.appendFileSync(filePath, `${block}\n`);
  } catch (error) {
    logger.warn({ err: error }, 'failed to write North certification log');
  }
}


