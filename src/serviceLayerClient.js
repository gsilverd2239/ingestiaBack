const axios = require('axios');
const https = require('https');
const { getConfig } = require('./config');
const { logger } = require('./logger');

class ServiceLayerClient {
  constructor() {
    this.agent = new https.Agent({ rejectUnauthorized: false });
    this.sessionCookies = null;
    this.sessionId = null;
    this.sessionExpiresAt = null;
    this.isLoggingIn = false;
  }

  getConfig() {
    return getConfig().sapServiceLayer;
  }

  async login(force = false) {
    if (this.sessionCookies && !force && this.sessionExpiresAt && Date.now() < this.sessionExpiresAt) {
      return this.sessionCookies;
    }

    if (this.isLoggingIn) {
      // Wait for ongoing login
      while (this.isLoggingIn) {
        await new Promise(r => setTimeout(r, 200));
      }
      return this.sessionCookies;
    }

    this.isLoggingIn = true;
    try {
      const config = this.getConfig();
      logger.info('Iniciando sesión en SAP Service Layer...', { url: config.baseUrl, companyDb: config.companyDb });

      const response = await axios.post(`${config.baseUrl}/Login`, {
        CompanyDB: config.companyDb,
        UserName: config.userName,
        Password: config.password
      }, {
        httpsAgent: this.agent,
        timeout: 10000
      });

      const setCookies = response.headers['set-cookie'];
      if (!setCookies || setCookies.length === 0) {
        throw new Error('No se recibieron cookies de sesión desde SAP Service Layer');
      }

      this.sessionCookies = setCookies.join('; ');
      this.sessionId = response.data.SessionId;
      const timeoutMinutes = response.data.SessionTimeout || 30;
      // Expire 2 minutes earlier to prevent edge cases
      this.sessionExpiresAt = Date.now() + (timeoutMinutes - 2) * 60 * 1000;

      logger.info('Sesión en SAP Service Layer establecida con éxito', {
        sessionId: this.sessionId,
        version: response.data.Version
      });

      return this.sessionCookies;
    } catch (err) {
      const errorMsg = err.response?.data?.error?.message?.value || err.message;
      logger.error('Error al iniciar sesión en SAP Service Layer', { error: errorMsg });
      throw new Error(`Error Service Layer Login: ${errorMsg}`);
    } finally {
      this.isLoggingIn = false;
    }
  }

  async requestWithAuth(requestFn) {
    try {
      await this.login();
      return await requestFn(this.sessionCookies);
    } catch (err) {
      // If 401 Unauthorized or session expired, retry once after forcing login
      if (err.response && (err.response.status === 401 || err.response.data?.error?.code === 301)) {
        logger.warn('Sesión de Service Layer expirada. Reintentando login...');
        this.sessionCookies = null;
        await this.login(true);
        return await requestFn(this.sessionCookies);
      }
      throw err;
    }
  }

  async testConnection() {
    try {
      const config = this.getConfig();
      const loginRes = await axios.post(`${config.baseUrl}/Login`, {
        CompanyDB: config.companyDb,
        UserName: config.userName,
        Password: config.password
      }, {
        httpsAgent: this.agent,
        timeout: 10000
      });

      return {
        success: true,
        message: 'Conexión y autenticación a SAP Service Layer exitosa',
        sessionId: loginRes.data.SessionId,
        version: loginRes.data.Version,
        companyDb: config.companyDb
      };
    } catch (err) {
      const errorMsg = err.response?.data?.error?.message?.value || err.message;
      logger.error('Error al probar conexión Service Layer', { error: errorMsg });
      return {
        success: false,
        message: errorMsg,
        companyDb: this.getConfig().companyDb
      };
    }
  }

  async getObjectByTemplate(objectType, entryKey) {
    const rootConfig = getConfig();
    const config = rootConfig.sapServiceLayer || {};
    const slTemplates = rootConfig.templates?.sl || config.templates || [];
    const template = slTemplates.find(t => 
      String(t.ObjectType || '').trim() === String(objectType).trim() && 
      String(t.MetodoHttpt || '').toUpperCase() === 'GET'
    );

    let endpointPattern = "/BusinessPartners('{EntryKey}')";
    if (template && template.EndPoint) {
      endpointPattern = template.EndPoint;
    }

    const safeKey = encodeURIComponent(String(entryKey).replace(/'/g, "''"));
    let path = endpointPattern
      .replace(/\{(EntryKey|CardCode|ItemCode|Code|ListNum|Number|ItmsGrpCod|GroupCode|DocNum|AbsEntry|Key|Id|DocEntry)\}/gi, safeKey)
      .replace(/\(['"]?(EntryKey|CardCode|ItemCode|Code|ListNum|Number|ItmsGrpCod|GroupCode|DocNum|AbsEntry|Key|Id|DocEntry)['"]?\)/gi, `('${safeKey}')`)
      .replace(/['"](EntryKey|CardCode|ItemCode|Code|ListNum|Number|ItmsGrpCod|GroupCode|DocNum|AbsEntry|Key|Id|DocEntry)['"]/gi, `'${safeKey}'`)
      .replace(/\/(EntryKey|CardCode|ItemCode|Code|ListNum|Number|ItmsGrpCod|GroupCode|DocNum|AbsEntry|Key|Id|DocEntry)$/gi, `/${safeKey}`)
      .replace(/\{[a-zA-Z0-9_-]+\}/g, safeKey);

    const url = `${config.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

    logger.debug(`Consultando Service Layer para ObjectType='${objectType}' (${path})...`);

    return await this.requestWithAuth(async (cookies) => {
      try {
        const response = await axios.get(url, {
          httpsAgent: this.agent,
          headers: { Cookie: cookies },
          timeout: 15000
        });
        return response.data;
      } catch (err) {
        // Smart fallback: If Service Layer returned 400 (Bad Request - Error in query syntax),
        // and url has single quotes around a numeric key, retry without quotes (e.g. /PriceLists('17') -> /PriceLists(17))
        const isSyntaxError = err.response && err.response.status === 400 && 
          (err.response.data?.error?.code === 203 || /syntax/i.test(err.response.data?.error?.message?.value || ''));

        if (isSyntaxError && /\('\d+'\)/.test(url)) {
          const unquotedUrl = url.replace(/\('(\d+)'\)/, '($1)');
          logger.warn(`Service Layer rechazó comillas en clave numérica (Error 203). Reintentando sin comillas: ${unquotedUrl}`);
          const retryRes = await axios.get(unquotedUrl, {
            httpsAgent: this.agent,
            headers: { Cookie: cookies },
            timeout: 15000
          });
          return retryRes.data;
        }
        throw err;
      }
    });
  }

  async getBusinessPartner(cardCode) {
    return await this.getObjectByTemplate('2', cardCode);
  }

  async getItem(itemCode) {
    const config = this.getConfig();
    const safeItemCode = encodeURIComponent(itemCode.replace(/'/g, "''"));
    const url = `${config.baseUrl}/Items('${safeItemCode}')`;

    logger.debug(`Consultando Service Layer Items('${itemCode}')...`);

    return await this.requestWithAuth(async (cookies) => {
      const response = await axios.get(url, {
        httpsAgent: this.agent,
        headers: { Cookie: cookies },
        timeout: 15000
      });
      return response.data;
    });
  }
}

module.exports = new ServiceLayerClient();
