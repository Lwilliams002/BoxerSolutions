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
    embeddedCheckoutId: normalizedOptional('NORTH_EMBEDDED_CHECKOUT_ID'),
    // "Fields"-type checkout — used for STORAGE (card vaulting) sessions per
    // North certification guidance. Each checkout has its own profile id and
    // private API key; all fall back to the main checkout's values.
    embeddedFieldsCheckoutId: normalizedOptional('NORTH_EMBEDDED_FIELDS_CHECKOUT_ID', process.env.NORTH_EMBEDDED_CHECKOUT_ID ?? ''),
    embeddedFieldsProfileId: normalizedOptional('NORTH_EMBEDDED_FIELDS_PROFILE_ID', process.env.NORTH_EMBEDDED_PROFILE_ID ?? ''),
    embeddedFieldsPrivateApiKey: normalizedOptional('NORTH_EMBEDDED_FIELDS_PRIVATE_API_KEY', process.env.NORTH_EMBEDDED_PRIVATE_API_KEY ?? ''),
    embeddedProfileId: normalizedOptional('NORTH_EMBEDDED_PROFILE_ID'),
    embeddedPrivateApiKey: normalizedOptional('NORTH_EMBEDDED_PRIVATE_API_KEY'),
    webhookSecret: normalizedOptional('NORTH_WEBHOOK_SECRET', process.env.NORTH_SIGNATURE_SECRET ?? ''),
    // Webhook secret for the Fields-type (STORAGE) checkout — webhooks are
    // verified against either secret.
    fieldsWebhookSecret: normalizedOptional('NORTH_EMBEDDED_FIELDS_WEBHOOK_SECRET'),
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
