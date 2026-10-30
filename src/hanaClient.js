const hana = require('@sap/hana-client');
const { getConfig } = require('./config');
const { logger } = require('./logger');

class HanaClient {
  constructor() {
    this.connection = null;
  }

  getConnParams() {
    const config = getConfig().hana;
    return {
      serverNode: config.serverNode,
      uid: config.uid,
      pwd: config.pwd,
      sslValidateCertificate: false
    };
  }

  getSchemaAndTable() {
    const config = getConfig().hana;
    const schema = config.schema || 'FG_DESARROLLO';
    const table = config.table || 'TBL_COMERCIA_EVENTS';
    return `"${schema}"."${table}"`;
  }

  async createConnection() {
    return new Promise((resolve, reject) => {
      const conn = hana.createConnection();
      conn.connect(this.getConnParams(), (err) => {
        if (err) {
          return reject(err);
        }
        resolve(conn);
      });
    });
  }

  async executeQuery(sql, params = []) {
    let conn = null;
    try {
      conn = await this.createConnection();
      return await new Promise((resolve, reject) => {
        conn.exec(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        });
      });
    } finally {
      if (conn) {
        try {
          conn.disconnect();
        } catch (e) {
          // ignore disconnect error
        }
      }
    }
  }

  async testConnection() {
    try {
      const conn = await this.createConnection();
      const versionResult = await new Promise((resolve, reject) => {
        conn.exec('SELECT VERSION FROM SYS.M_DATABASE', (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        });
      });
      conn.disconnect();
      return {
        success: true,
        message: 'Conexión a SAP HANA exitosa',
        version: versionResult && versionResult[0] ? versionResult[0].VERSION : 'HANA DB',
        serverNode: this.getConnParams().serverNode
      };
    } catch (err) {
      logger.error('Error al probar conexión HANA', { error: err.message });
      return {
        success: false,
        message: err.message,
        serverNode: this.getConnParams().serverNode
      };
    }
  }

  async getPendingEvents(batchSize = 25) {
    const table = this.getSchemaAndTable();
    const sql = `
      SELECT "EventID", "ObjectType", "EntryKey", "Action", "CreatedAt", "Processed", "ProcessedAt"
      FROM ${table}
      WHERE "Processed" = 0 OR "Processed" IS NULL
      ORDER BY "EventID" ASC
      LIMIT ?
    `;
    return await this.executeQuery(sql, [batchSize]);
  }

  async getRecentEvents(limit = 50, filter = 'all') {
    const table = this.getSchemaAndTable();
    let whereClause = '';
    if (filter === 'pending') {
      whereClause = 'WHERE "Processed" = 0 OR "Processed" IS NULL';
    } else if (filter === 'processed') {
      whereClause = 'WHERE "Processed" = 1';
    }

    const sql = `
      SELECT "EventID", "ObjectType", "EntryKey", "Action", "CreatedAt", "Processed", "ProcessedAt"
      FROM ${table}
      ${whereClause}
      ORDER BY "EventID" DESC
      LIMIT ?
    `;
    return await this.executeQuery(sql, [limit]);
  }

  async markEventProcessed(eventId) {
    const table = this.getSchemaAndTable();
    const sql = `
      UPDATE ${table}
      SET "Processed" = 1, "ProcessedAt" = CURRENT_TIMESTAMP
      WHERE "EventID" = ?
    `;
    return await this.executeQuery(sql, [eventId]);
  }

  async resetEvent(eventId) {
    const table = this.getSchemaAndTable();
    const sql = `
      UPDATE ${table}
      SET "Processed" = 0, "ProcessedAt" = NULL
      WHERE "EventID" = ?
    `;
    return await this.executeQuery(sql, [eventId]);
  }

  async insertTestEvent(objectType = '2', entryKey = 'CC0102868', action = 'U') {
    const table = this.getSchemaAndTable();
    const sql = `
      INSERT INTO ${table} ("ObjectType", "EntryKey", "Action", "CreatedAt", "Processed")
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, 0)
    `;
    return await this.executeQuery(sql, [objectType, entryKey, action]);
  }

  async getStats() {
    const table = this.getSchemaAndTable();
    const sql = `
      SELECT 
        COUNT(*) AS "total",
        SUM(CASE WHEN "Processed" = 1 THEN 1 ELSE 0 END) AS "processed",
        SUM(CASE WHEN "Processed" = 0 OR "Processed" IS NULL THEN 1 ELSE 0 END) AS "pending"
      FROM ${table}
    `;
    const rows = await this.executeQuery(sql);
    if (rows && rows.length > 0) {
      return {
        total: Number(rows[0].total || 0),
        processed: Number(rows[0].processed || 0),
        pending: Number(rows[0].pending || 0)
      };
    }
    return { total: 0, processed: 0, pending: 0 };
  }
}

module.exports = new HanaClient();
