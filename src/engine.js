const hanaClient = require('./hanaClient');
const serviceLayerClient = require('./serviceLayerClient');
const ingestionClient = require('./ingestionClient');
const { transformBusinessPartner, transformByObjectType } = require('./transformer');
const { getConfig } = require('./config');
const { logger } = require('./logger');
const telegramService = require('./telegramService');

class IngestionEngine {
  constructor() {
    this.timer = null;
    this.isPolling = false;
    this.isRunning = false;
    this.startedAt = null;
    this.lastPollAt = null;
    this.stats = {
      totalPolled: 0,
      totalSuccess: 0,
      totalFailed: 0,
      totalSkipped: 0
    };
    this.recentProcessedEvents = []; // Last 50 event summaries for UI
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      isPolling: this.isPolling,
      startedAt: this.startedAt,
      lastPollAt: this.lastPollAt,
      pollIntervalSeconds: getConfig().service.pollIntervalSeconds || 10,
      stats: this.stats,
      recentProcessedCount: this.recentProcessedEvents.length
    };
  }

  getRecentProcessedEvents(limit = 25) {
    return this.recentProcessedEvents.slice(-limit).reverse();
  }

  start() {
    if (this.isRunning) {
      logger.warn('El motor de ingesta ya se encuentra en ejecución.');
      return;
    }

    const intervalSec = getConfig().service.pollIntervalSeconds || 10;
    this.isRunning = true;
    this.startedAt = new Date().toISOString();
    logger.info(`Iniciando motor de ingesta ingestIA (Intervalo: ${intervalSec}s)...`);

    // Run first poll shortly after start
    setTimeout(() => {
      this.pollCycle();
    }, 1000);

    this.timer = setInterval(() => {
      this.pollCycle();
    }, intervalSec * 1000);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Motor de ingesta ingestIA detenido/pausado.');
  }

  async restart() {
    this.stop();
    await new Promise(r => setTimeout(r, 500));
    this.start();
  }

  async pollCycle() {
    if (this.isPolling) {
      logger.debug('Ciclo anterior de ingesta aún en ejecución, omitiendo este turno.');
      return;
    }

    this.isPolling = true;
    this.lastPollAt = new Date().toISOString();

    try {
      const batchSize = getConfig().service.batchSize || 25;
      const pendingEvents = await hanaClient.getPendingEvents(batchSize);

      if (!pendingEvents || pendingEvents.length === 0) {
        logger.debug('No hay eventos pendientes en TBL_COMERCIA_EVENTS.');
        return;
      }

      logger.info(`Detectados ${pendingEvents.length} eventos pendientes en HANA para procesar.`);
      this.stats.totalPolled += pendingEvents.length;

      for (const event of pendingEvents) {
        await this.processEvent(event);
      }
    } catch (err) {
      logger.error('Error durante el ciclo de lectura de eventos HANA', { error: err.message });
    } finally {
      this.isPolling = false;
    }
  }

  async processEvent(event) {
    const { EventID, ObjectType, EntryKey, Action } = event;
    const objectTypeStr = String(ObjectType).trim();
    const entryKeyClean = String(EntryKey || '').trim();
    const startTime = Date.now();

    logger.info(`Procesando EventID=${EventID} | ObjectType=${objectTypeStr} | EntryKey=${entryKeyClean} | Action=${Action}`);

    try {
      // 1. Fetch from SAP B1 Service Layer using dynamic template for ObjectType
      const rawData = await serviceLayerClient.getObjectByTemplate(objectTypeStr, entryKeyClean);

      let ingestRes;
      const isObjectType2 = objectTypeStr === '2' || objectTypeStr.toUpperCase() === 'OCRD' || objectTypeStr.toUpperCase() === 'BUSINESSPARTNERS';
      const isObjectType4 = objectTypeStr === '4' || objectTypeStr.toUpperCase() === 'OITM' || objectTypeStr.toUpperCase() === 'ITEMS';

      if (isObjectType2) {
        // ENDURO: Para ObjectType 2 (OCRD), sincronizar directamente tbl_ocrd y tbl_crd1 en código sin consultar TEMPLATEEMPRESA de PostgreSQL
        logger.info(`[ObjectType 2 - ENDURO] Procesando OCRD y CRD1 directamente en código para EntryKey=${entryKeyClean} (Action=${Action})...`);
        ingestRes = await ingestionClient.sendBusinessPartnerWithAddresses(rawData, Action);
      } else if (isObjectType4) {
        // ENDURO: Para ObjectType 4 (OITM), sincronizar directamente tbl_oitm y tbl_itm1 en código
        const rootConfig = getConfig();
        const isAdd = String(Action).toUpperCase() === 'A';
        const method = isAdd ? 'POST' : 'PUT';
        const empresaTemplates = rootConfig.templates?.empresa || rootConfig.ingestion?.templates || [];
        const empTemplate = empresaTemplates.find(t => 
          String(t.ObjectType || '').trim().toUpperCase() === '4' && 
          String(t.MetodoHttpt || '').toUpperCase() === method
        );
        logger.info(`[ObjectType 4 - ENDURO] Procesando OITM e ITM1 directamente en código para EntryKey=${entryKeyClean} (Action=${Action})...`);
        ingestRes = await ingestionClient.sendItemWithPrices(rawData, Action, empTemplate?.BodyTemplate);
      } else {
        // Find template for BodyTemplate shape matching if needed
        const rootConfig = getConfig();
        const isAdd = String(Action).toUpperCase() === 'A';
        const method = isAdd ? 'POST' : 'PUT';
        const empresaTemplates = rootConfig.templates?.empresa || rootConfig.ingestion?.templates || [];
        const empTemplate = empresaTemplates.find(t => 
          String(t.ObjectType || '').trim().toUpperCase() === String(objectTypeStr).trim().toUpperCase() && 
          String(t.MetodoHttpt || '').toUpperCase() === method
        );

        // 2. Transform into required Ingestion API payload
        const transformedPayload = transformByObjectType(objectTypeStr, rawData, empTemplate?.BodyTemplate);

        // 3. Send to Ingestion API (POST if Action === 'A', PUT if Action === 'U') using ObjectType template
        ingestRes = await ingestionClient.sendPayload(transformedPayload, Action, objectTypeStr, entryKeyClean, rawData);
      }

      if (ingestRes.success) {
        // 4. Mark event as processed in SAP HANA
        await hanaClient.markEventProcessed(EventID);
        this.stats.totalSuccess++;

        const record = {
          eventId: EventID,
          objectType: objectTypeStr,
          entryKey: entryKeyClean,
          action: Action,
          method: ingestRes.method || (String(Action).toUpperCase() === 'A' ? 'POST' : 'PUT'),
          status: 'SUCCESS',
          statusCode: ingestRes.statusCode,
          wasFallback: ingestRes.wasFallback || false,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString()
        };
        this.addProcessedRecord(record);

        // Disparar alerta a Telegram en segundo plano si ocurrió un Fallback
        if (record.wasFallback) {
          logger.warn(`[Fallback Detectado] Evento ${EventID} (${entryKeyClean}) usó fallback: ${record.method}. Enviando alerta a Telegram...`);
          telegramService.sendFallbackAlert({
            eventId: EventID,
            objectType: objectTypeStr,
            entryKey: entryKeyClean,
            action: Action,
            method: record.method,
            durationMs: record.durationMs,
            statusCode: record.statusCode,
            details: ingestRes.fallbackDetails || null
          }).catch(alertErr => {
            logger.warn(`Error enviando alerta Telegram para Evento ${EventID}: ${alertErr.message}`);
          });
        }

        if (isObjectType2) {
          logger.info(`Evento ${EventID} (ObjectType=2 [OCRD+CRD1], Action=${Action}) procesado exitosamente: tbl_ocrd (${ingestRes.method}), ${ingestRes.crd1Count || 0} direcciones sincronizadas en tbl_crd1.`);
        } else if (isObjectType4) {
          logger.info(`Evento ${EventID} (ObjectType=4 [OITM+ITM1], Action=${Action}) procesado exitosamente: tbl_oitm (${ingestRes.method}), ${ingestRes.itm1Count || 0} listas de precios sincronizadas en tbl_itm1.`);
        } else {
          logger.info(`Evento ${EventID} (ObjectType=${objectTypeStr}, Action=${Action}) procesado y marcado exitosamente en HANA.`);
        }
      } else {
        this.stats.totalFailed++;
        const record = {
          eventId: EventID,
          objectType: objectTypeStr,
          entryKey: entryKeyClean,
          action: Action,
          status: 'FAILED',
          error: ingestRes.error || `HTTP ${ingestRes.statusCode}`,
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString()
        };
        this.addProcessedRecord(record);
        logger.error(`Fallo en Ingestión API para Evento ${EventID}: ${record.error}`);
        telegramService.sendErrorAlert(record).catch(() => {});
      }
    } catch (err) {
      this.stats.totalFailed++;
      const record = {
        eventId: EventID,
        objectType: objectTypeStr,
        entryKey: EntryKey,
        action: Action,
        status: 'ERROR',
        error: err.message,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      this.addProcessedRecord(record);
      logger.error(`Error procesando EventID ${EventID}`, { error: err.message });
      telegramService.sendErrorAlert(record).catch(() => {});
    }
  }

  addProcessedRecord(record) {
    this.recentProcessedEvents.push(record);
    if (this.recentProcessedEvents.length > 50) {
      this.recentProcessedEvents.shift();
    }
  }
}

module.exports = new IngestionEngine();
