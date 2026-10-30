const { loadRuntimeConfig } = require('./db/configRepository');
const { logger } = require('./logger');

let currentConfig = {
  service: {
    port: 9015,
    pollIntervalSeconds: 10,
    batchSize: 25,
    autoStart: true
  },
  hana: {
    serverNode: '172.19.0.88:30015',
    uid: 'SYSTEM',
    pwd: 'Admin123',
    schema: 'FG_DESARROLLO',
    table: 'TBL_COMERCIA_EVENTS'
  },
  sapServiceLayer: {
    baseUrl: 'https://172.19.0.88:50000/b1s/v1',
    companyDb: 'FG_DESARROLLO',
    userName: 'gualber',
    password: '2300160',
    sslValidate: false
  },
  ingestion: {
    baseUrl: 'https://api.comercia.pro/api/v1/admin/socios-negocio/empresas',
    empresaId: 2,
    timeoutMs: 15000
  }
};

let isInitialized = false;

async function initConfig() {
  try {
    logger.info('Cargando configuración de la aplicación desde la base de datos PostgreSQL (ingestia)...');
    const dbConfig = await loadRuntimeConfig();
    currentConfig = {
      ...currentConfig,
      ...dbConfig
    };
    isInitialized = true;
    logger.info('Configuración cargada exitosamente desde PostgreSQL', {
      hanaServer: currentConfig.hana.serverNode,
      companyDb: currentConfig.sapServiceLayer.companyDb,
      idEmpresa: currentConfig.ingestion.empresaId,
      intervalo: currentConfig.service.pollIntervalSeconds
    });
    return currentConfig;
  } catch (err) {
    logger.warn('No se pudo cargar configuración inicial desde PostgreSQL, usando valores predeterminados', { error: err.message });
    return currentConfig;
  }
}

function getConfig() {
  return currentConfig;
}

async function reloadConfig() {
  logger.info('Recargando configuración activa desde PostgreSQL...');
  const dbConfig = await loadRuntimeConfig();
  currentConfig = {
    ...currentConfig,
    ...dbConfig
  };
  return currentConfig;
}

module.exports = {
  initConfig,
  getConfig,
  reloadConfig,
  isInitialized: () => isInitialized
};
