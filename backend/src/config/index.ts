import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function normalizedOptional(name: string, fallback = ''): string {
  const value = process.env[name] ?? fallback;
  return value.trim().replace(/^[<>"']+|[<>"']+$/g, '');
}

/**
 * Embedded Checkout (Fields) credentials resolve as a SET, not per variable: a
 * checkout id from one credential set must never be paired with the private API
 * key of another. When the NORTH_EMBEDDED_FIELDS_* alias set is in use the key
 * must come from that set too; only the profile id (the merchant, shared across
 * checkouts) may fall back to the canonical name.
 *
 * console.warn rather than the app logger: utils/logger imports this module.
 */
function resolveEmbeddedCredentials() {
  const aliasCheckoutId = normalizedOptional('NORTH_EMBEDDED_FIELDS_CHECKOUT_ID');
  if (aliasCheckoutId) {
    const privateApiKey = normalizedOptional('NORTH_EMBEDDED_FIELDS_PRIVATE_API_KEY');
    if (!privateApiKey) throw new Error('Missing NORTH_EMBEDDED_FIELDS_PRIVATE_API_KEY for the Fields checkout');
    let profileId = normalizedOptional('NORTH_EMBEDDED_FIELDS_PROFILE_ID');
    if (!profileId) {
      profileId = normalizedOptional('NORTH_EMBEDDED_PROFILE_ID');
      if (profileId) {
        console.warn('NORTH_EMBEDDED_FIELDS_PROFILE_ID is not set; falling back to NORTH_EMBEDDED_PROFILE_ID for the Fields checkout.');
      }
    }
    return { checkoutId: aliasCheckoutId, profileId, privateApiKey };
  }
  return {
    checkoutId: normalizedOptional('NORTH_EMBEDDED_CHECKOUT_ID'),
    profileId: normalizedOptional('NORTH_EMBEDDED_PROFILE_ID'),
    privateApiKey: normalizedOptional('NORTH_EMBEDDED_PRIVATE_API_KEY'),
  };
}

const embeddedCredentials = resolveEmbeddedCredentials();

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '4000', 10),
  databaseUrl: required('DATABASE_URL'),
  jwt: {
    secret: required('JWT_SECRET'),
    accessTtlSeconds: parseInt(process.env.JWT_ACCESS_TTL ?? '900', 10),
    refreshTtlSeconds: parseInt(process.env.JWT_REFRESH_TTL ?? '2592000', 10),
  },
  storage: {
    endpoint: required('STORAGE_ENDPOINT'),
    region: process.env.STORAGE_REGION ?? 'us-east-1',
    bucket: required('STORAGE_BUCKET'),
    accessKey: required('STORAGE_ACCESS_KEY'),
    secretKey: required('STORAGE_SECRET_KEY'),
    forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE ?? 'false') === 'true',
    urlTtlSeconds: parseInt(process.env.STORAGE_URL_TTL ?? '300', 10),
  },
  payments: {
    provider: process.env.PAYMENT_PROVIDER ?? 'mock',
    secretKey: process.env.PAYMENT_SECRET_KEY ?? '',
  },
  email: {
    provider: process.env.EMAIL_PROVIDER ?? 'mock',
    from: process.env.EMAIL_FROM ?? '',
    replyTo: process.env.EMAIL_REPLY_TO ?? '',
    sesRegion: process.env.EMAIL_SES_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
    sesAccessKeyId: process.env.EMAIL_SES_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? '',
    sesSecretAccessKey: process.env.EMAIL_SES_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
  north: {
    functionsBaseUrl: normalizedOptional('NORTH_FUNCTIONS_BASE_URL', 'https://proxy.payanywhere.com'),
    billingBaseUrl: normalizedOptional('NORTH_BILLING_BASE_URL', 'https://billing.epxuap.com'),
    embeddedBaseUrl: normalizedOptional('NORTH_EMBEDDED_BASE_URL', 'https://checkout.north.com'),
    mid: normalizedOptional('NORTH_MID'),
    developerKey: normalizedOptional('NORTH_DEVELOPER_KEY'),
    password: normalizedOptional('NORTH_PASSWORD'),
    appSource: normalizedOptional('NORTH_APPSOURCE'),
    signatureSecret: normalizedOptional('NORTH_SIGNATURE_SECRET'),
    transactionsUsername: normalizedOptional('NORTH_TRANSACTIONS_USERNAME'),
    // One Embedded Checkout (Fields type) handles SALE and STORAGE sessions.
    // The NORTH_EMBEDDED_FIELDS_* names are read first, as a complete set, so
    // deployments that already hold the Fields credentials there keep working
    // without an env change; NORTH_EMBEDDED_* (no FIELDS) is the fallback set
    // for older setups. See resolveEmbeddedCredentials above.
    embeddedCheckoutId: embeddedCredentials.checkoutId,
    embeddedProfileId: embeddedCredentials.profileId,
    embeddedPrivateApiKey: embeddedCredentials.privateApiKey,
    webhookSecret: normalizedOptional('NORTH_EMBEDDED_FIELDS_WEBHOOK_SECRET', process.env.NORTH_WEBHOOK_SECRET ?? process.env.NORTH_SIGNATURE_SECRET ?? ''),
    legacyWebhookSecret: normalizedOptional('NORTH_WEBHOOK_SECRET'),
    achTermsVersion: normalizedOptional('NORTH_ACH_TERMS_VERSION', '2026-09-05'),
    // Raw request/response certification logging (text file North asks for).
    certLogEnabled: (process.env.NORTH_CERT_LOG_ENABLED ?? 'true') === 'true',
    certLogPath: normalizedOptional('NORTH_CERT_LOG_PATH', 'logs/north-cert.log'),
  },
  cognito: {
    employeeAuthEnabled: (process.env.COGNITO_EMPLOYEE_AUTH_ENABLED ?? 'false') === 'true',
    customerOtpEnabled: (process.env.COGNITO_CUSTOMER_OTP_ENABLED ?? 'false') === 'true',
    autoCreateCustomerUsers: (process.env.COGNITO_AUTO_CREATE_CUSTOMER_USERS ?? 'true') === 'true',
    autoCreateEmployeeUsers: (process.env.COGNITO_AUTO_CREATE_EMPLOYEE_USERS ?? 'true') === 'true',
    region: process.env.COGNITO_REGION ?? '',
    userPoolId: process.env.COGNITO_USER_POOL_ID ?? '',
    userPoolClientId: process.env.COGNITO_USER_POOL_CLIENT_ID ?? '',
    userPoolClientSecret: process.env.COGNITO_USER_POOL_CLIENT_SECRET ?? '',
  },
  routeOptimizer: process.env.ROUTE_OPTIMIZER ?? 'nearest-neighbor',
};
