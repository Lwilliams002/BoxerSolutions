import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { runMigrations } from './scripts/migrate';
import { startJobScheduler } from './jobs';

async function main() {
  await runMigrations();
  const app = createApp();
  app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.env }, 'ServiceFinanceAnt API listening');
  });
  startJobScheduler();
}

main().catch((err) => {
  logger.error(err, 'fatal startup error');
  process.exit(1);
});
