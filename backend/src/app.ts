import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { config } from './config';
import { logger } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/error';
import { idempotency } from './middleware/idempotency';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import customerRoutes from './routes/customers';
import locationRoutes from './routes/locations';
import serviceRoutes from './routes/services';
import appointmentRoutes from './routes/appointments';
import routeRoutes from './routes/routes';
import invoiceRoutes from './routes/invoices';
import paymentRoutes from './routes/payments';
import paymentMethodRoutes from './routes/paymentMethods';
import subscriptionRoutes from './routes/subscriptions';
import fileRoutes from './routes/files';
import noteRoutes from './routes/notes';
import notificationRoutes from './routes/notifications';
import communicationRoutes from './routes/communications';
import dashboardRoutes from './routes/dashboard';
import reportRoutes from './routes/reports';
import settingsRoutes from './routes/settings';
import roleRoutes from './routes/roles';
import auditLogRoutes from './routes/auditLogs';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger, autoLogging: config.env !== 'development' }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.env === 'production' ? 300 : 5000,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(idempotency);

  app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' }, message: null }));

  const v1 = express.Router();
  v1.use('/auth', authRoutes);
  v1.use('/users', userRoutes);
  v1.use('/customers', customerRoutes);
  v1.use('/locations', locationRoutes);
  v1.use('/services', serviceRoutes);
  v1.use('/appointments', appointmentRoutes);
  v1.use('/routes', routeRoutes);
  v1.use('/invoices', invoiceRoutes);
  v1.use('/payments', paymentRoutes);
  v1.use('/payment-methods', paymentMethodRoutes);
  v1.use('/subscriptions', subscriptionRoutes);
  v1.use('/files', fileRoutes);
  v1.use('/notes', noteRoutes);
  v1.use('/notifications', notificationRoutes);
  v1.use('/communications', communicationRoutes);
  v1.use('/dashboard', dashboardRoutes);
  v1.use('/reports', reportRoutes);
  v1.use('/settings', settingsRoutes);
  v1.use('/roles', roleRoutes);
  v1.use('/audit-logs', auditLogRoutes);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
