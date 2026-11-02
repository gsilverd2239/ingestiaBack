const { query } = require('./pg');
const { logger } = require('../logger');

// ==========================================
// 1. DBINSTANCES CRUD
// ==========================================
async function getAllInstances() {
  const res = await query(`
    SELECT "CodeInstances", "ServerName", "ServerType", "Version", "ServiceLayer", "ServerHanaPort", "HanaUser", "HanaPassword"
    FROM ingestia."DBINSTANCES"
    ORDER BY "CodeInstances" ASC
  `);
  return res.rows;
}

async function getInstanceById(id) {
  const res = await query(`
    SELECT "CodeInstances", "ServerName", "ServerType", "Version", "ServiceLayer", "ServerHanaPort", "HanaUser", "HanaPassword"
    FROM ingestia."DBINSTANCES"
    WHERE "CodeInstances" = $1
  `, [id]);
  return res.rows[0] || null;
}

async function createInstance(data) {
  const { ServerName, ServerType = 'HANA', Version = 10, ServiceLayer, ServerHanaPort = '30015', HanaUser, HanaPassword } = data;
  const res = await query(`
    INSERT INTO ingestia."DBINSTANCES" (
      "ServerName", "ServerType", "Version", "ServiceLayer", "ServerHanaPort", "HanaUser", "HanaPassword"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [ServerName, ServerType, Version, ServiceLayer, ServerHanaPort, HanaUser, HanaPassword]);
  return res.rows[0];
}

async function updateInstance(id, data) {
  const { ServerName, ServerType, Version, ServiceLayer, ServerHanaPort, HanaUser, HanaPassword } = data;
  const res = await query(`
    UPDATE ingestia."DBINSTANCES"
    SET "ServerName" = $1, "ServerType" = $2, "Version" = $3, "ServiceLayer" = $4,
        "ServerHanaPort" = $5, "HanaUser" = $6, "HanaPassword" = $7
    WHERE "CodeInstances" = $8
    RETURNING *
  `, [ServerName, ServerType, Version, ServiceLayer, ServerHanaPort, HanaUser, HanaPassword, id]);
  return res.rows[0];
}

async function deleteInstance(id) {
  const res = await query(`DELETE FROM ingestia."DBINSTANCES" WHERE "CodeInstances" = $1 RETURNING *`, [id]);
  return res.rows[0];
}

// ==========================================
// 2. DBSAP CRUD
// ==========================================
async function getAllDBSAP() {
  const res = await query(`
    SELECT "CodeInstances", "CompanyDB", "Password", "UserName", "TblEventos", "IdEmpresa"
    FROM ingestia."DBSAP"
    ORDER BY "CodeInstances" ASC, "CompanyDB" ASC
  `);
  return res.rows;
}

async function createDBSAP(data) {
  const { CodeInstances, CompanyDB, Password, UserName, TblEventos = 'TBL_COMERCIA_EVENTS', IdEmpresa } = data;
  const res = await query(`
    INSERT INTO ingestia."DBSAP" (
      "CodeInstances", "CompanyDB", "Password", "UserName", "TblEventos", "IdEmpresa"
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [CodeInstances, CompanyDB, Password, UserName, TblEventos, IdEmpresa]);
  return res.rows[0];
}

async function updateDBSAP(codeInstances, companyDb, idEmpresa, data) {
  const { Password, UserName, TblEventos } = data;
  const res = await query(`
    UPDATE ingestia."DBSAP"
    SET "Password" = $1, "UserName" = $2, "TblEventos" = $3
    WHERE "CodeInstances" = $4 AND "CompanyDB" = $5 AND "IdEmpresa" = $6
    RETURNING *
  `, [Password, UserName, TblEventos, codeInstances, companyDb, idEmpresa]);
  return res.rows[0];
}

async function deleteDBSAP(codeInstances, companyDb, idEmpresa) {
  const res = await query(`
    DELETE FROM ingestia."DBSAP"
    WHERE "CodeInstances" = $1 AND "CompanyDB" = $2 AND "IdEmpresa" = $3
    RETURNING *
  `, [codeInstances, companyDb, idEmpresa]);
  return res.rows[0];
}

// ==========================================
// 3. DBEMPRESA CRUD
// ==========================================
async function getAllEmpresas() {
  const res = await query(`
    SELECT "IdEmpresa", "URLBase", "TimeOutMS", "IntervaloPollingS", "LoteMaximoCiclo"
    FROM ingestia."DBEMPRESA"
    ORDER BY "IdEmpresa" ASC
  `);
  return res.rows;
}

async function createEmpresa(data) {
  const { IdEmpresa, URLBase, TimeOutMS = 15000, IntervaloPollingS = 10, LoteMaximoCiclo = 25 } = data;
  const res = await query(`
    INSERT INTO ingestia."DBEMPRESA" (
      "IdEmpresa", "URLBase", "TimeOutMS", "IntervaloPollingS", "LoteMaximoCiclo"
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [IdEmpresa, URLBase, TimeOutMS, IntervaloPollingS, LoteMaximoCiclo]);
  return res.rows[0];
}

async function updateEmpresa(idEmpresa, data) {
  const { URLBase, TimeOutMS, IntervaloPollingS, LoteMaximoCiclo } = data;
  const res = await query(`
    UPDATE ingestia."DBEMPRESA"
    SET "URLBase" = $1, "TimeOutMS" = $2, "IntervaloPollingS" = $3, "LoteMaximoCiclo" = $4
    WHERE "IdEmpresa" = $5
    RETURNING *
  `, [URLBase, TimeOutMS, IntervaloPollingS, LoteMaximoCiclo, idEmpresa]);
  return res.rows[0];
}

async function deleteEmpresa(idEmpresa) {
  const res = await query(`
    DELETE FROM ingestia."DBEMPRESA"
    WHERE "IdEmpresa" = $1
    RETURNING *
  `, [idEmpresa]);
  return res.rows[0];
}

// ==========================================
// 4. TEMPLATEEMPRESA CRUD
// ==========================================
async function getAllTemplateEmpresas() {
  const res = await query(`
    SELECT "IdEmpresa", "MetodoHttpt", "EndPoint", "BodyTemplate", "ObjectType"
    FROM ingestia."TEMPLATEEMPRESA"
    ORDER BY "IdEmpresa" ASC, "ObjectType" ASC, "MetodoHttpt" ASC
  `);
  return res.rows;
}

async function createTemplateEmpresa(data) {
  const {
    IdEmpresa = 2,
    MetodoHttpt = 'POST',
    EndPoint = '/socios-negocio/empresas/{IdEmpresa}/tbl_ocrd/',
    BodyTemplate = {},
    ObjectType = '2'
  } = data;
  const bodyJson = typeof BodyTemplate === 'string' ? BodyTemplate : JSON.stringify(BodyTemplate);
  const res = await query(`
    INSERT INTO ingestia."TEMPLATEEMPRESA" (
      "IdEmpresa", "MetodoHttpt", "EndPoint", "BodyTemplate", "ObjectType"
    ) VALUES ($1, $2, $3, $4::jsonb, $5)
    RETURNING *
  `, [Number(IdEmpresa) || 2, String(MetodoHttpt || 'POST').toUpperCase(), EndPoint, bodyJson, String(ObjectType)]);
  return res.rows[0];
}

async function updateTemplateEmpresa(idEmpresa, metodoHttpt, data) {
  const {
    EndPoint,
    BodyTemplate = {},
    ObjectType = '2',
    originalObjectType
  } = data;
  const matchObjectType = originalObjectType || ObjectType;
  const bodyJson = typeof BodyTemplate === 'string' ? BodyTemplate : JSON.stringify(BodyTemplate);
  const res = await query(`
    UPDATE ingestia."TEMPLATEEMPRESA"
    SET "EndPoint" = $1, "BodyTemplate" = $2::jsonb, "ObjectType" = $3
    WHERE "IdEmpresa" = $4 AND "MetodoHttpt" = $5 AND ("ObjectType" = $6 OR $6 IS NULL)
    RETURNING *
  `, [EndPoint, bodyJson, String(ObjectType), Number(idEmpresa) || 2, String(metodoHttpt || 'POST').toUpperCase(), matchObjectType]);
  return res.rows[0];
}

async function deleteTemplateEmpresa(idEmpresa, metodoHttpt, objectType) {
  const res = await query(`
    DELETE FROM ingestia."TEMPLATEEMPRESA"
    WHERE "IdEmpresa" = $1 AND "MetodoHttpt" = $2 AND ("ObjectType" = $3 OR $3 IS NULL)
    RETURNING *
  `, [Number(idEmpresa) || 2, String(metodoHttpt).toUpperCase(), objectType || null]);
  return res.rows[0];
}

// ==========================================
// 5. TEMPLATESLSAP CRUD
// ==========================================
async function getAllTemplateSLSAP() {
  const res = await query(`
    SELECT "CodeInstances", "MetodoHttpt", "EndPoint", "ObjectType", "ObjectDescr"
    FROM ingestia."TEMPLATESLSAP"
    ORDER BY "CodeInstances" ASC, "ObjectType" ASC, "MetodoHttpt" ASC
  `);
  return res.rows;
}

async function createTemplateSLSAP(data) {
  const {
    CodeInstances = 1,
    MetodoHttpt = 'GET',
    EndPoint = "/BusinessPartners('{EntryKey}')",
    ObjectType = '2',
    ObjectDescr = 'Business Partner'
  } = data;
  const res = await query(`
    INSERT INTO ingestia."TEMPLATESLSAP" (
      "CodeInstances", "MetodoHttpt", "EndPoint", "ObjectType", "ObjectDescr"
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [Number(CodeInstances) || 1, String(MetodoHttpt || 'GET').toUpperCase(), EndPoint, String(ObjectType), ObjectDescr]);
  return res.rows[0];
}

async function updateTemplateSLSAP(codeInstances, metodoHttpt, data) {
  const {
    EndPoint,
    ObjectType = '2',
    ObjectDescr = 'Business Partner',
    originalObjectType
  } = data;
  const matchObjectType = originalObjectType || ObjectType;
  const res = await query(`
    UPDATE ingestia."TEMPLATESLSAP"
    SET "EndPoint" = $1, "ObjectType" = $2, "ObjectDescr" = $3
    WHERE "CodeInstances" = $4 AND "MetodoHttpt" = $5 AND ("ObjectType" = $6 OR $6 IS NULL)
    RETURNING *
  `, [EndPoint, String(ObjectType), ObjectDescr, Number(codeInstances) || 1, String(metodoHttpt || 'GET').toUpperCase(), matchObjectType]);
  return res.rows[0];
}

async function deleteTemplateSLSAP(codeInstances, metodoHttpt, objectType) {
  const res = await query(`
    DELETE FROM ingestia."TEMPLATESLSAP"
    WHERE "CodeInstances" = $1 AND "MetodoHttpt" = $2 AND ("ObjectType" = $3 OR $3 IS NULL)
    RETURNING *
  `, [Number(codeInstances) || 1, String(metodoHttpt).toUpperCase(), objectType || null]);
  return res.rows[0];
}

// ==========================================
// 6. TELEGRAM ALERT CONFIG & LOG CRUD
// ==========================================
async function getTelegramConfig() {
  try {
    const res = await query(`
      SELECT id, bot_token, phone, chat_ids, alert_fallback, alert_error, is_active, updated_at
      FROM ingestia."TELEGRAM_CONFIG"
      ORDER BY id ASC
      LIMIT 1
    `);
    if (res.rows.length === 0) {
      const defaultInsert = await query(`
        INSERT INTO ingestia."TELEGRAM_CONFIG" (bot_token, phone, chat_ids, alert_fallback, alert_error, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, ['8968844963:AAFGhL-fMfnk4JjADMlCIwFgu5TQM4jUzh8', '+595982304930', '[]', true, false, true]);
      return defaultInsert.rows[0];
    }
    return res.rows[0];
  } catch (err) {
    logger.warn('Error leyendo TELEGRAM_CONFIG de PostgreSQL, usando valores predeterminados', { error: err.message });
    return {
      bot_token: '8968844963:AAFGhL-fMfnk4JjADMlCIwFgu5TQM4jUzh8',
      phone: '+595982304930',
      chat_ids: '[]',
      alert_fallback: true,
      alert_error: false,
      is_active: true
    };
  }
}

async function updateTelegramConfig(data) {
  const { bot_token, phone, chat_ids, alert_fallback, alert_error, is_active } = data;
  const chatIdsStr = Array.isArray(chat_ids) ? JSON.stringify(chat_ids) : (typeof chat_ids === 'string' ? chat_ids : undefined);

  const current = await getTelegramConfig();
  const res = await query(`
    UPDATE ingestia."TELEGRAM_CONFIG"
    SET bot_token = COALESCE($1, bot_token),
        phone = COALESCE($2, phone),
        chat_ids = COALESCE($3, chat_ids),
        alert_fallback = COALESCE($4, alert_fallback),
        alert_error = COALESCE($5, alert_error),
        is_active = COALESCE($6, is_active),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $7
    RETURNING *
  `, [
    bot_token !== undefined ? bot_token : null,
    phone !== undefined ? phone : null,
    chatIdsStr !== undefined ? chatIdsStr : null,
    alert_fallback !== undefined ? alert_fallback : null,
    alert_error !== undefined ? alert_error : null,
    is_active !== undefined ? is_active : null,
    current.id
  ]);
  return res.rows[0];
}

async function logAlert(data) {
  try {
    const { alert_type = 'FALLBACK', event_id, object_type, entry_key, message, recipients, status = 'SENT', error = null } = data;
    const res = await query(`
      INSERT INTO ingestia."ALERT_LOG" (
        alert_type, event_id, object_type, entry_key, message, recipients, status, error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [alert_type, event_id || null, object_type || null, entry_key || null, message, recipients, status, error]);
    return res.rows[0];
  } catch (err) {
    logger.warn('Error registrando alerta en ALERT_LOG', { error: err.message });
    return null;
  }
}

async function getRecentAlerts(limit = 50) {
  try {
    const res = await query(`
      SELECT id, alert_type, event_id, object_type, entry_key, message, recipients, status, error, created_at
      FROM ingestia."ALERT_LOG"
      ORDER BY id DESC
      LIMIT $1
    `, [limit]);
    return res.rows;
  } catch (err) {
    logger.warn('Error obteniendo alertas recientes de ALERT_LOG', { error: err.message });
    return [];
  }
}

// ==========================================
// 7. Runtime Configuration Loader from PostgreSQL
// ==========================================
async function loadRuntimeConfig() {
  try {
    const instances = await getAllInstances();
    const dbsapList = await getAllDBSAP();
    const empresas = await getAllEmpresas();
    const templateEmpresas = await getAllTemplateEmpresas();
    const templateSLList = await getAllTemplateSLSAP();
    const telegramConfig = await getTelegramConfig();

    if (instances.length === 0 || dbsapList.length === 0 || empresas.length === 0) {
      logger.warn('Tablas de configuración en PostgreSQL están incompletas. Verifique DBINSTANCES, DBSAP y DBEMPRESA.');
    }

    const primaryInstance = instances[0] || {};
    const primarySap = dbsapList[0] || {};
    const primaryEmpresa = empresas[0] || {};

    const serverHanaNode = `${primaryInstance.ServerName || '172.19.0.88'}:${primaryInstance.ServerHanaPort || '30015'}`;

    return {
      service: {
        port: 9015,
        pollIntervalSeconds: primaryEmpresa.IntervaloPollingS || 10,
        batchSize: primaryEmpresa.LoteMaximoCiclo || 25,
        autoStart: true
      },
      hana: {
        serverNode: serverHanaNode,
        uid: primaryInstance.HanaUser || 'SYSTEM',
        pwd: primaryInstance.HanaPassword || 'Admin123',
        schema: primarySap.CompanyDB || 'FG_DESARROLLO',
        table: primarySap.TblEventos || 'TBL_COMERCIA_EVENTS'
      },
      sapServiceLayer: {
        baseUrl: (primaryInstance.ServiceLayer || 'https://172.19.0.88:50000/b1s/v1').replace(/\/+$/, ''),
        companyDb: primarySap.CompanyDB || 'FG_DESARROLLO',
        userName: primarySap.UserName || 'gualber',
        password: primarySap.Password || '2300160',
        sslValidate: false,
        templates: templateSLList
      },
      ingestion: {
        baseUrl: (primaryEmpresa.URLBase || 'https://api.comercia.pro/api/v1/admin').replace(/\/+$/, ''),
        empresaId: primaryEmpresa.IdEmpresa || 2,
        timeoutMs: primaryEmpresa.TimeOutMS || 15000,
        templates: templateEmpresas
      },
      telegram: telegramConfig,
      templates: {
        sl: templateSLList,
        empresa: templateEmpresas
      },
      dbData: {
        instances,
        dbsapList,
        empresas,
        templateEmpresas,
        templateSLList,
        telegram: telegramConfig
      }
    };
  } catch (err) {
    logger.error('Error al cargar la configuración de ejecución desde PostgreSQL', { error: err.message });
    throw err;
  }
}

module.exports = {
  // DBINSTANCES
  getAllInstances,
  getInstanceById,
  createInstance,
  updateInstance,
  deleteInstance,

  // DBSAP
  getAllDBSAP,
  createDBSAP,
  updateDBSAP,
  deleteDBSAP,

  // DBEMPRESA
  getAllEmpresas,
  createEmpresa,
  updateEmpresa,
  deleteEmpresa,

  // TEMPLATEEMPRESA
  getAllTemplateEmpresas,
  createTemplateEmpresa,
  updateTemplateEmpresa,
  deleteTemplateEmpresa,

  // TEMPLATESLSAP
  getAllTemplateSLSAP,
  createTemplateSLSAP,
  updateTemplateSLSAP,
  deleteTemplateSLSAP,

  // TELEGRAM ALERT CONFIG
  getTelegramConfig,
  updateTelegramConfig,
  logAlert,
  getRecentAlerts,

  // Combined Runtime Config
  loadRuntimeConfig
};
