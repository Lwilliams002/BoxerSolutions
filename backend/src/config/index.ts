import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
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
  north: {
    functionsBaseUrl: process.env.NORTH_FUNCTIONS_BASE_URL ?? 'https://proxy.payanywhere.com',
    billingBaseUrl: process.env.NORTH_BILLING_BASE_URL ?? 'https://billing.epxuap.com',
    mid: process.env.NORTH_MID ?? '',
    developerKey: process.env.NORTH_DEVELOPER_KEY ?? '',
    password: process.env.NORTH_PASSWORD ?? '',
    appSource: process.env.NORTH_APPSOURCE ?? '',
    signatureSecret: process.env.NORTH_SIGNATURE_SECRET ?? '',
  },
  routeOptimizer: process.env.ROUTE_OPTIMIZER ?? 'nearest-neighbor',
};
