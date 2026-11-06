const express = require('express');
const cors = require('cors');
const { getConfig, reloadConfig } = require('./config');
const { logger, getRecentLogs, clearRecentLogs } = require('./logger');
const engine = require('./engine');
const hanaClient = require('./hanaClient');
const serviceLayerClient = require('./serviceLayerClient');
const ingestionClient = require('./ingestionClient');
const { transformBusinessPartner, transformByObjectType } = require('./transformer');
const { testPgConnection } = require('./db/pg');
const configRepo = require('./db/configRepository');
const telegramService = require('./telegramService');

function createServer() {
  const app = express();

  app.use(cors({ origin: '*' }));
  app.use(express.json());

  // 1. System & Engine Status
  app.get('/api/status', async (req, res) => {
    try {
      const engineStatus = engine.getStatus();
      let hanaStats = { total: 0, pending: 0, processed: 0 };
      try {
        hanaStats = await hanaClient.getStats();
      } catch (err) {
        // HANA might be temporarily unreachable
      }

      res.json({
        service: 'ingestIA Service',
        uptime: process.uptime(),
        nodeVersion: process.version,
        engine: engineStatus,
        hanaStats,
        config: getConfig(),
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Engine Control
  app.post('/api/engine/start', (req, res) => {
    engine.start();
    res.json({ success: true, message: 'Motor de ingesta iniciado', status: engine.getStatus() });
  });

  app.post('/api/engine/stop', (req, res) => {
    engine.stop();
    res.json({ success: true, message: 'Motor de ingesta detenido', status: engine.getStatus() });
  });

  app.post('/api/engine/poll-now', async (req, res) => {
    try {
      await engine.pollCycle();
      res.json({ success: true, message: 'Ciclo de ingesta ejecutado exitosamente' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. PostgreSQL CRUD & Config Management
  app.get('/api/db/all', async (req, res) => {
    try {
      const [instances, dbsapList, empresas, templateEmpresas, templateSLList] = await Promise.all([
        configRepo.getAllInstances(),
        configRepo.getAllDBSAP(),
        configRepo.getAllEmpresas(),
        configRepo.getAllTemplateEmpresas(),
        configRepo.getAllTemplateSLSAP()
      ]);
      res.json({
        success: true,
        instances,
        dbsapList,
        empresas,
        templateEmpresas,
        templateSLList
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Reload config into active engine from PostgreSQL
  app.post('/api/db/reload', async (req, res) => {
    try {
      const updatedConfig = await reloadConfig();
      if (engine.isRunning) {
        await engine.restart();
      }
      res.json({ success: true, message: 'Configuración recargada desde PostgreSQL exitosamente', config: updatedConfig });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // DBINSTANCES CRUD
  app.get('/api/db/instances', async (req, res) => {
    try {
      const data = await configRepo.getAllInstances();
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/db/instances', async (req, res) => {
    try {
      const created = await configRepo.createInstance(req.body);
      await reloadConfig();
      res.json({ success: true, data: created });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.put('/api/db/instances/:id', async (req, res) => {
    try {
      const updated = await configRepo.updateInstance(req.params.id, req.body);
      await reloadConfig();
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/db/instances/:id', async (req, res) => {
    try {
      const deleted = await configRepo.deleteInstance(req.params.id);
      await reloadConfig();
      res.json({ success: true, data: deleted });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // DBSAP CRUD
  app.get('/api/db/sap', async (req, res) => {
    try {
      const data = await configRepo.getAllDBSAP();
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/db/sap', async (req, res) => {
    try {
      const created = await configRepo.createDBSAP(req.body);
      await reloadConfig();
      res.json({ success: true, data: created });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.put('/api/db/sap', async (req, res) => {
    try {
      const { CodeInstances, CompanyDB, IdEmpresa } = req.body;
      const updated = await configRepo.updateDBSAP(CodeInstances, CompanyDB, IdEmpresa, req.body);
      await reloadConfig();
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/db/sap', async (req, res) => {
    try {
      const { codeInstances, companyDb, idEmpresa } = req.query;
      const deleted = await configRepo.deleteDBSAP(codeInstances, companyDb, idEmpresa);
      await reloadConfig();
      res.json({ success: true, data: deleted });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // DBEMPRESA CRUD
  app.get('/api/db/empresa', async (req, res) => {
    try {
      const data = await configRepo.getAllEmpresas();
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/db/empresa', async (req, res) => {
    try {
      const created = await configRepo.createEmpresa(req.body);
      await reloadConfig();
      res.json({ success: true, data: created });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.put('/api/db/empresa/:id', async (req, res) => {
    try {
      const updated = await configRepo.updateEmpresa(req.params.id, req.body);
      await reloadConfig();
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/db/empresa/:id', async (req, res) => {
    try {
      const deleted = await configRepo.deleteEmpresa(req.params.id);
      await reloadConfig();
      res.json({ success: true, data: deleted });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // TEMPLATEEMPRESA CRUD
  app.get('/api/db/template-empresa', async (req, res) => {
    try {
      const data = await configRepo.getAllTemplateEmpresas();
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/db/template-empresa', async (req, res) => {
    try {
      const created = await configRepo.createTemplateEmpresa(req.body);
      await reloadConfig();
      res.json({ success: true, data: created });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.put('/api/db/template-empresa', async (req, res) => {
    try {
      const { IdEmpresa, MetodoHttpt } = req.body;
      const updated = await configRepo.updateTemplateEmpresa(IdEmpresa, MetodoHttpt, req.body);
      await reloadConfig();
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/db/template-empresa', async (req, res) => {
    try {
      const { idEmpresa, metodoHttpt, objectType } = req.query;
      const deleted = await configRepo.deleteTemplateEmpresa(idEmpresa, metodoHttpt, objectType);
      await reloadConfig();
      res.json({ success: true, data: deleted });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // TEMPLATESLSAP CRUD
  app.get('/api/db/template-sl', async (req, res) => {
    try {
      const data = await configRepo.getAllTemplateSLSAP();
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/db/template-sl', async (req, res) => {
    try {
      const created = await configRepo.createTemplateSLSAP(req.body);
      await reloadConfig();
      res.json({ success: true, data: created });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.put('/api/db/template-sl', async (req, res) => {
    try {
      const { CodeInstances, MetodoHttpt } = req.body;
      const updated = await configRepo.updateTemplateSLSAP(CodeInstances, MetodoHttpt, req.body);
      await reloadConfig();
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/db/template-sl', async (req, res) => {
    try {
      const { codeInstances, metodoHttpt, objectType } = req.query;
      const deleted = await configRepo.deleteTemplateSLSAP(codeInstances, metodoHttpt, objectType);
      await reloadConfig();
      res.json({ success: true, data: deleted });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 4. Connectivity Diagnostics
  app.post('/api/test/pg', async (req, res) => {
    const result = await testPgConnection();
    res.json(result);
  });

  app.post('/api/test/hana', async (req, res) => {
    const result = await hanaClient.testConnection();
    res.json(result);
  });

  app.post('/api/test/servicelayer', async (req, res) => {
    const result = await serviceLayerClient.testConnection();
    res.json(result);
  });

  app.post('/api/test/ingestion', async (req, res) => {
    const result = await ingestionClient.testConnection();
    res.json(result);
  });

  // 5. Simulation Playground (CardCode test without modifying HANA)
  app.post('/api/test/simulate-sync', async (req, res) => {
    const { cardCode, action = 'U', objectType = '2', sendToIngest = true } = req.body;
    if (!cardCode) {
      return res.status(400).json({ success: false, error: 'El campo cardCode es requerido.' });
    }

    try {
      logger.info(`Iniciando simulación de sincronización para CardCode: "${cardCode}" con Action: "${action}" y ObjectType: "${objectType}"...`);
      // 1. Fetch from SAP using template
      const startTime = Date.now();
      const sapRaw = await serviceLayerClient.getObjectByTemplate(objectType, cardCode);
      const sapDurationMs = Date.now() - startTime;

      const isItem = String(objectType) === '4' || String(objectType).toUpperCase() === 'OITM' || String(objectType).toUpperCase() === 'ITEMS';
      const isBP = String(objectType) === '2' || String(objectType).toUpperCase() === 'OCRD' || String(objectType).toUpperCase() === 'BUSINESSPARTNERS';
      let transformedPayload = null;
      let ingestionResult = null;

      if (isBP) {
        transformedPayload = transformByObjectType('2', sapRaw);
        if (sendToIngest) {
          ingestionResult = await ingestionClient.sendBusinessPartnerWithAddresses(sapRaw, action);
        }
      } else if (isItem) {
        transformedPayload = transformByObjectType('4', sapRaw);
        if (sendToIngest) {
          ingestionResult = await ingestionClient.sendItemWithPrices(sapRaw, action);
        }
      } else {
        // 2. Transform using dynamic mapper
        const rootConfig = getConfig();
        const isAdd = String(action).toUpperCase() === 'A';
        const method = isAdd ? 'POST' : 'PUT';
        const empresaTemplates = rootConfig.templates?.empresa || rootConfig.ingestion?.templates || [];
        const empTemplate = empresaTemplates.find(t => 
          String(t.ObjectType || '').trim().toUpperCase() === String(objectType).trim().toUpperCase() && 
          String(t.MetodoHttpt || '').toUpperCase() === method
        );

        transformedPayload = transformByObjectType(objectType, sapRaw, empTemplate?.BodyTemplate);

        // 3. Send to Ingestion (if requested)
        if (sendToIngest) {
          ingestionResult = await ingestionClient.sendPayload(transformedPayload, action, objectType, cardCode, sapRaw);
        }
      }

      const isCanal = String(objectType).toUpperCase() === 'JCANAL' || String(objectType).toUpperCase() === 'JCALES';
      const isPriceList = String(objectType) === '6' || String(objectType).toUpperCase() === 'OPLN';
      const isItemGroup = String(objectType) === '52' || String(objectType).toUpperCase() === 'OITB';
      const isAgent = String(objectType) === '177' || String(objectType).toUpperCase() === 'OAGP';
      res.json({
        success: true,
        cardCode,
        action,
        objectType,
        sapDurationMs,
        sapRaw: isItem ? {
          ItemCode: sapRaw.ItemCode,
          ItemName: sapRaw.ItemName,
          ItemsGroupCode: sapRaw.ItemsGroupCode,
          SalesUnitWeight: sapRaw.SalesUnitWeight,
          ArTaxCode: sapRaw.ArTaxCode,
          DefaultWarehouse: sapRaw.DefaultWarehouse,
          Valid: sapRaw.Valid,
          Frozen: sapRaw.Frozen,
          InventoryItem: sapRaw.InventoryItem,
          U_ItemQty: sapRaw.U_ItemQty,
          U_beas_vg: sapRaw.U_beas_vg,
          ItemPricesCount: Array.isArray(sapRaw.ItemPrices) ? sapRaw.ItemPrices.length : 0
        } : isCanal ? {
          Code: sapRaw.Code,
          Name: sapRaw.Name,
          DocEntry: sapRaw.DocEntry,
          Object: sapRaw.Object
        } : isPriceList ? {
          PriceListNo: sapRaw.PriceListNo,
          PriceListName: sapRaw.PriceListName,
          Active: sapRaw.Active,
          IsGrossPrice: sapRaw.IsGrossPrice
        } : isItemGroup ? {
          Number: sapRaw.Number,
          GroupName: sapRaw.GroupName
        } : isAgent ? {
          AgentCode: (sapRaw?.value?.[0] || sapRaw)?.AgentCode,
          AgentName: (sapRaw?.value?.[0] || sapRaw)?.AgentName,
          Memo: (sapRaw?.value?.[0] || sapRaw)?.Memo
        } : {
          CardCode: sapRaw.CardCode,
          CardName: sapRaw.CardName,
          CardType: sapRaw.CardType,
          GroupCode: sapRaw.GroupCode,
          FederalTaxID: sapRaw.FederalTaxID,
          Properties1: sapRaw.Properties1,
          Properties2: sapRaw.Properties2,
          Properties3: sapRaw.Properties3,
          Properties4: sapRaw.Properties4,
          Properties5: sapRaw.Properties5,
          Properties6: sapRaw.Properties6,
          Properties7: sapRaw.Properties7,
          U_Latitud: sapRaw.U_Latitud,
          U_Longitud: sapRaw.U_Longitud,
          U_jCANAL: sapRaw.U_jCANAL,
          U_jSUBCANAL: sapRaw.U_jSUBCANAL,
          AgentCode: sapRaw.AgentCode,
          Valid: sapRaw.Valid,
          Frozen: sapRaw.Frozen,
          BPAddressesCount: Array.isArray(sapRaw.BPAddresses) ? sapRaw.BPAddresses.length : 0
        },
        transformedPayload,
        ingestionResult
      });
    } catch (err) {
      logger.error(`Error en simulación para CardCode ${cardCode}`, { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. Events Explorer
  app.get('/api/events', async (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 50;
    const filter = req.query.filter || 'all'; // all | pending | processed

    try {
      const events = await hanaClient.getRecentEvents(limit, filter);
      res.json({ success: true, count: events.length, events });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/events/:id/reprocess', async (req, res) => {
    const eventId = req.params.id;
    try {
      await hanaClient.resetEvent(eventId);
      logger.info(`Evento ${eventId} marcado para reprocesamiento.`);
      // Trigger cycle
      engine.pollCycle();
      res.json({ success: true, message: `Evento ${eventId} preparado y puesto en cola.` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/events/create-test', async (req, res) => {
    const { objectType = '2', entryKey = 'CC0102868', action = 'U' } = req.body;
    try {
      await hanaClient.insertTestEvent(objectType, entryKey, action);
      logger.info(`Evento de prueba creado: ObjectType=${objectType}, EntryKey=${entryKey}, Action=${action}`);
      res.json({ success: true, message: 'Evento de prueba insertado en TBL_COMERCIA_EVENTS.' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. Recent Executions & Memory Logs
  app.get('/api/recent-executions', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 25;
    res.json({ success: true, records: engine.getRecentProcessedEvents(limit) });
  });

  app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 100;
    const level = req.query.level || null;
    const logs = getRecentLogs(limit, level);
    res.json({ success: true, count: logs.length, logs });
  });

  app.delete('/api/logs', (req, res) => {
    clearRecentLogs();
    res.json({ success: true, message: 'Logs en memoria limpiados' });
  });

  // 8. Telegram Alerts Management
  app.get('/api/telegram/status', async (req, res) => {
    try {
      const cfg = await configRepo.getTelegramConfig();
      const botRes = await telegramService.getBotInfo(true);
      res.json({
        success: true,
        config: cfg,
        botInfo: botRes,
        chatIds: telegramService.parseChatIds(cfg.chat_ids),
        phone: cfg.phone || '+595982304930'
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/telegram/config', async (req, res) => {
    try {
      const { bot_token, phone, chat_ids, alert_fallback, alert_error, is_active } = req.body;
      const updated = await configRepo.updateTelegramConfig({
        bot_token,
        phone,
        chat_ids,
        alert_fallback,
        alert_error,
        is_active
      });
      res.json({ success: true, message: 'Configuración de Telegram actualizada', config: updated });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/telegram/detect-chat', async (req, res) => {
    try {
      const detectResult = await telegramService.detectAndRegisterChats();
      res.json(detectResult);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/telegram/add-chat', async (req, res) => {
    try {
      const { chatId } = req.body;
      const result = await telegramService.addChatIdManually(chatId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/telegram/remove-chat', async (req, res) => {
    try {
      const { chatId } = req.body;
      const result = await telegramService.removeChatId(chatId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/telegram/test', async (req, res) => {
    try {
      const { chatId } = req.body || {};
      const testResult = await telegramService.sendTestAlert(chatId);
      res.json(testResult);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/telegram/alerts', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const alerts = await configRepo.getRecentAlerts(limit);
      res.json({ success: true, alerts });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return app;
}

module.exports = { createServer };
