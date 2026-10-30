const { Pool } = require('pg');
const { logger } = require('../logger');

const pgConfig = {
  host: process.env.POSTGRES_HOST || '172.19.0.232',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'ingestia',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '1234',
  connectionTimeoutMillis: 3000
};

const pool = new Pool(pgConfig);

pool.on('error', (err) => {
  logger.error('Error inesperado en el pool de PostgreSQL', { error: err.message });
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug('Consulta ejecutada en PostgreSQL', { text, duration, rows: res.rowCount });
  return res;
}

async function testPgConnection() {
  try {
    const res = await query('SELECT version(), current_database(), current_schema()');
    return {
      success: true,
      message: 'Conexión a PostgreSQL exitosa',
      host: pgConfig.host,
      database: pgConfig.database,
      version: res.rows[0].version
    };
  } catch (err) {
    logger.error('Error probando conexión a PostgreSQL', { error: err.message });
    return {
      success: false,
      message: err.message,
      host: pgConfig.host,
      database: pgConfig.database
    };
  }
}

module.exports = {
  pool,
  query,
  pgConfig,
  testPgConnection
};
