const { initConfig, getConfig } = require('./config');
const { logger } = require('./logger');
const { createServer } = require('./server');
const engine = require('./engine');
const hanaClient = require('./hanaClient');
const serviceLayerClient = require('./serviceLayerClient');
const { testPgConnection } = require('./db/pg');

async function main() {
  logger.info('======================================================');
  logger.info('     Iniciando ingestIA - Servicio de Integración     ');
  logger.info('======================================================');

  // Load configs from PostgreSQL
  await initConfig();
  const config = getConfig();

  // Create Express App
  const app = createServer();
  const port = process.env.PORT || config.service.port || 9015;

  const server = app.listen(port, '0.0.0.0', async () => {
    logger.info(`Servidor API ingestIA escuchando en http://0.0.0.0:${port}`);

    // Quick startup diagnostics
    try {
      logger.info('Verificando conexiones iniciales...');

      const pgRes = await testPgConnection();
      if (pgRes.success) {
        logger.info(`PostgreSQL conectado OK (${pgRes.host}/${pgRes.database})`);
      } else {
        logger.warn(`PostgreSQL no respondió: ${pgRes.message}`);
      }

      const hanaRes = await hanaClient.testConnection();
      if (hanaRes.success) {
        logger.info(`HANA conectado OK (${hanaRes.serverNode}) - Versión: ${hanaRes.version}`);
      } else {
        logger.warn(`HANA no respondió: ${hanaRes.message}`);
      }

      const slRes = await serviceLayerClient.testConnection();
      if (slRes.success) {
        logger.info(`SAP Service Layer conectado OK (${slRes.companyDb}) - Versión: ${slRes.version}`);
      } else {
        logger.warn(`SAP Service Layer no respondió: ${slRes.message}`);
      }
    } catch (err) {
      logger.error('Error en diagnóstico inicial', { error: err.message });
    }

    // Auto-start engine if configured
    if (config.service.autoStart !== false) {
      engine.start();
    } else {
      logger.info('Auto-inicio deshabilitado. El motor espera activación manual desde el Front.');
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Deteniendo servicio ingestIA...');
    engine.stop();
    server.close(() => {
      logger.info('Servidor HTTP cerrado.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection detectada:', {
    message: reason?.message || String(reason),
    stack: reason?.stack
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception detectada:', {
    message: err?.message,
    stack: err?.stack
  });
});

main().catch((err) => {
  logger.error('Fallo crítico al iniciar ingestIA', { error: err.message, stack: err.stack });
  process.exit(1);
});
