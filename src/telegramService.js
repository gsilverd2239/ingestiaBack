const axios = require('axios');
const configRepo = require('./db/configRepository');
const { logger } = require('./logger');

class TelegramService {
  constructor() {
    this.cachedBotInfo = null;
    this.lastInfoCheck = 0;
  }

  /**
   * Obtiene la configuración actual de Telegram desde PostgreSQL (o default)
   */
  async getConfig() {
    return await configRepo.getTelegramConfig();
  }

  /**
   * Obtiene la información del bot de Telegram (getMe)
   */
  async getBotInfo(forceRefresh = false) {
    const cfg = await this.getConfig();
    const token = cfg.bot_token;
    if (!token) {
      return { success: false, error: 'Token del bot no configurado' };
    }

    const now = Date.now();
    if (!forceRefresh && this.cachedBotInfo && (now - this.lastInfoCheck < 60000)) {
      return { success: true, bot: this.cachedBotInfo, phone: cfg.phone };
    }

    try {
      const response = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 8000 });
      if (response.data && response.data.ok) {
        this.cachedBotInfo = response.data.result;
        this.lastInfoCheck = now;
        return {
          success: true,
          bot: response.data.result,
          phone: cfg.phone,
          chatIds: this.parseChatIds(cfg.chat_ids),
          alertFallback: cfg.alert_fallback,
          alertError: cfg.alert_error,
          isActive: cfg.is_active
        };
      }
      return { success: false, error: 'Respuesta inválida de Telegram' };
    } catch (err) {
      const errMsg = err.response?.data?.description || err.message;
      logger.error('Error al consultar info del bot Telegram', { error: errMsg });
      return { success: false, error: errMsg };
    }
  }

  /**
   * Parsea los chat_ids guardados en BD (array o string JSON)
   */
  parseChatIds(chatIdsRaw) {
    if (!chatIdsRaw) return [];
    if (Array.isArray(chatIdsRaw)) return chatIdsRaw;
    try {
      const parsed = JSON.parse(chatIdsRaw);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      return String(chatIdsRaw).split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  /**
   * Consulta getUpdates de Telegram para detectar usuarios que enviaron /start o mensajes al bot.
   * Si encuentra nuevos chat_id, los registra en BD y les envía un mensaje de bienvenida.
   */
  async detectAndRegisterChats() {
    const cfg = await this.getConfig();
    const token = cfg.bot_token;
    if (!token) return { success: false, error: 'Token del bot no configurado' };

    try {
      const res = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`, { timeout: 10000 });
      const updates = res.data?.result || [];

      if (updates.length === 0) {
        return {
          success: true,
          newChatsCount: 0,
          message: 'No se encontraron nuevos mensajes en el bot. Abra Telegram, busque @' + (this.cachedBotInfo?.username || 'GrupoGlobalZabbixBot') + ' y presione Iniciar o escriba un mensaje.',
          chatIds: this.parseChatIds(cfg.chat_ids)
        };
      }

      let currentChatIds = this.parseChatIds(cfg.chat_ids).map(String);
      const discoveredChats = [];

      for (const upd of updates) {
        const msg = upd.message || upd.channel_post || upd.my_chat_member?.chat;
        if (!msg) continue;
        const chat = msg.chat || msg;
        if (!chat || !chat.id) continue;

        const chatIdStr = String(chat.id);
        const userName = chat.username ? `@${chat.username}` : (chat.first_name || 'Usuario');
        const userPhone = msg.contact?.phone_number || null;

        if (!discoveredChats.some(c => c.id === chatIdStr)) {
          discoveredChats.push({
            id: chatIdStr,
            name: userName,
            type: chat.type,
            phone: userPhone,
            lastMessage: msg.text || null
          });
        }
      }

      const newlyAdded = [];
      for (const discovered of discoveredChats) {
        if (!currentChatIds.includes(discovered.id)) {
          currentChatIds.push(discovered.id);
          newlyAdded.push(discovered);

          // Enviar confirmación de bienvenida inmediata al chat detectado
          await this.sendWelcomeMessage(token, discovered.id, discovered.name, cfg.phone);
        }
      }

      if (newlyAdded.length > 0) {
        await configRepo.updateTelegramConfig({
          chat_ids: currentChatIds
        });
        logger.info(`[Telegram] Se vincularon ${newlyAdded.length} nuevo(s) chat(s): ${newlyAdded.map(c => c.id).join(', ')}`);
      }

      return {
        success: true,
        newChatsCount: newlyAdded.length,
        newlyAdded,
        discoveredChats,
        chatIds: currentChatIds,
        message: newlyAdded.length > 0
          ? `¡Éxito! Se vincularon ${newlyAdded.length} chat(s) de Telegram para recibir alertas en ${cfg.phone}.`
          : `Se revisaron los mensajes del bot. Los chats detectados ya se encuentran vinculados.`
      };
    } catch (err) {
      const errMsg = err.response?.data?.description || err.message;
      logger.error('Error al detectar chats en Telegram', { error: errMsg });
      return { success: false, error: errMsg };
    }
  }

  /**
   * Envia mensaje de confirmación de vinculación
   */
  async sendWelcomeMessage(token, chatId, userName, targetPhone) {
    try {
      const welcomeText = [
        '🔔 *ingestIA - Notificaciones Activadas*',
        '━━━━━━━━━━━━━━━━━━━━━━',
        `¡Hola *${userName}*!`,
        `Tu cuenta de Telegram ha sido vinculada exitosamente al servicio *ingestIA* para el número móvil *${targetPhone || '+595982304930'}*.`,
        '',
        '🎯 *Monitoreo Activo:* Eventos con *Smart Fallback*',
        'Recibirás alertas en tiempo real cuando un registro de SAP B1 sea resuelto mediante fallback (ej. POST 409 ➔ PUT o PUT 404 ➔ POST).',
        '━━━━━━━━━━━━━━━━━━━━━━',
        '⚡ *Estado:* Sistema listo y operativo.'
      ].join('\n');

      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text: welcomeText,
        parse_mode: 'Markdown'
      }, { timeout: 8000 });
    } catch (e) {
      logger.warn(`No se pudo enviar mensaje de bienvenida a chatId ${chatId}: ${e.message}`);
    }
  }

  /**
   * Agrega un chat_id manualmente
   */
  async addChatIdManually(chatId) {
    if (!chatId) return { success: false, error: 'Chat ID es obligatorio' };
    const cleanId = String(chatId).trim();
    const cfg = await this.getConfig();
    let currentChatIds = this.parseChatIds(cfg.chat_ids).map(String);

    if (!currentChatIds.includes(cleanId)) {
      currentChatIds.push(cleanId);
      await configRepo.updateTelegramConfig({ chat_ids: currentChatIds });
    }

    // Intentar enviar confirmación
    if (cfg.bot_token) {
      await this.sendWelcomeMessage(cfg.bot_token, cleanId, 'Usuario', cfg.phone);
    }

    return {
      success: true,
      message: `Chat ID ${cleanId} registrado exitosamente.`,
      chatIds: currentChatIds
    };
  }

  /**
   * Elimina un chat_id de la lista
   */
  async removeChatId(chatId) {
    const cleanId = String(chatId).trim();
    const cfg = await this.getConfig();
    let currentChatIds = this.parseChatIds(cfg.chat_ids).map(String);
    currentChatIds = currentChatIds.filter(id => id !== cleanId);

    await configRepo.updateTelegramConfig({ chat_ids: currentChatIds });
    return {
      success: true,
      message: `Chat ID ${cleanId} removido.`,
      chatIds: currentChatIds
    };
  }

  /**
   * Envia una alerta de FALLBACK cuando el motor de ingestión detecta que se usó un método alternativo
   */
  async sendFallbackAlert({ eventId, objectType, entryKey, action, method, durationMs, statusCode, details }) {
    const cfg = await this.getConfig();
    if (!cfg || !cfg.is_active || !cfg.alert_fallback) {
      logger.debug('[Telegram] Alerta de Fallback omitida (inactiva o desactivada en configuración).');
      return { skipped: true, reason: 'Alertas de fallback inactivas' };
    }

    const token = cfg.bot_token;
    if (!token) {
      logger.warn('[Telegram] No se puede enviar alerta de Fallback: Token no configurado.');
      return { skipped: true, reason: 'Token no configurado' };
    }

    const chatIds = this.parseChatIds(cfg.chat_ids);
    const targetPhone = cfg.phone || '+595982304930';

    if (chatIds.length === 0) {
      logger.warn(`[Telegram] Se detectó Fallback para EventID=${eventId} (${entryKey}), pero aún no hay ningún Chat ID vinculado para el teléfono ${targetPhone}.`);
      await configRepo.logAlert({
        alert_type: 'FALLBACK',
        event_id: eventId,
        object_type: objectType,
        entry_key: entryKey,
        message: `Fallback detectado (${method}), pendiente vincular chat_id para ${targetPhone}.`,
        recipients: targetPhone,
        status: 'PENDING_CHAT_ID'
      });
      return { success: false, reason: 'No hay chat_id vinculado aún' };
    }

    const objectDescMap = {
      '2': 'Socios de Negocio (OCRD/CRD1)',
      'OCRD': 'Socios de Negocio (OCRD/CRD1)',
      '4': 'Artículos y Precios (OITM/ITM1)',
      'OITM': 'Artículos y Precios (OITM/ITM1)'
    };
    const objectDesc = objectDescMap[String(objectType).trim().toUpperCase()] || `ObjectType ${objectType}`;
    const actionDesc = String(action).toUpperCase() === 'A' ? 'Creación (ADD)' : 'Actualización (UPDATE)';

    const nowAsuncion = new Date().toLocaleString('es-PY', {
      timeZone: 'America/Asuncion',
      dateStyle: 'short',
      timeStyle: 'medium'
    });

    const alertLines = [
      '⚠️ *ALERTA: FALLBACK EN INGESTIA*',
      '━━━━━━━━━━━━━━━━━━━━━━',
      `📋 *Evento SAP:* \`#${eventId}\``,
      `📦 *Objeto:* *${objectType}* (${objectDesc})`,
      `🔑 *Clave (EntryKey):* \`${entryKey}\``,
      `⚡ *Acción SAP:* *${action}* (${actionDesc})`,
      `🔄 *Método Fallback:* *${method}*`,
      statusCode ? `🔢 *Código HTTP:* \`${statusCode}\`` : '',
      durationMs ? `⏱️ *Duración:* \`${durationMs}ms\`` : '',
      details ? `ℹ️ *Detalles:* ${details}` : '',
      `🕒 *Fecha/Hora:* ${nowAsuncion}`,
      '━━━━━━━━━━━━━━━━━━━━━━',
      `📱 *Destinatario:* \`${targetPhone}\``
    ].filter(Boolean);

    const messageText = alertLines.join('\n');
    const sendResults = [];

    for (const chatId of chatIds) {
      try {
        const response = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: chatId,
          text: messageText,
          parse_mode: 'Markdown'
        }, { timeout: 8000 });

        sendResults.push({ chatId, success: true, messageId: response.data?.result?.message_id });
      } catch (err) {
        const errDetail = err.response?.data?.description || err.message;
        logger.error(`[Telegram] Falló envío de alerta a chatId ${chatId}`, { error: errDetail });
        sendResults.push({ chatId, success: false, error: errDetail });
      }
    }

    const anySuccess = sendResults.some(r => r.success);
    await configRepo.logAlert({
      alert_type: 'FALLBACK',
      event_id: eventId,
      object_type: objectType,
      entry_key: entryKey,
      message: messageText,
      recipients: JSON.stringify(chatIds),
      status: anySuccess ? 'SENT' : 'FAILED',
      error: anySuccess ? null : JSON.stringify(sendResults)
    });

    return {
      success: anySuccess,
      results: sendResults
    };
  }

  /**
   * Envia una alerta de error general (si está habilitado alert_error)
   */
  async sendErrorAlert(eventData) {
    const cfg = await this.getConfig();
    if (!cfg || !cfg.is_active || !cfg.alert_error) return { skipped: true };

    const token = cfg.bot_token;
    const chatIds = this.parseChatIds(cfg.chat_ids);
    if (!token || chatIds.length === 0) return { skipped: true };

    const { eventId, objectType, entryKey, action, error } = eventData;
    const nowAsuncion = new Date().toLocaleString('es-PY', { timeZone: 'America/Asuncion' });

    const messageText = [
      '🚨 *ERROR EN MOTOR INGESTIA*',
      '━━━━━━━━━━━━━━━━━━━━━━',
      `📋 *Evento:* \`#${eventId || 'N/A'}\``,
      `📦 *Objeto:* \`${objectType || 'N/A'}\``,
      `🔑 *Clave:* \`${entryKey || 'N/A'}\``,
      `⚡ *Acción:* \`${action || 'N/A'}\``,
      `💥 *Error:* ${error || 'Error desconocido'}`,
      `🕒 *Fecha/Hora:* ${nowAsuncion}`,
      '━━━━━━━━━━━━━━━━━━━━━━',
      `📱 *Móvil:* \`${cfg.phone || '+595982304930'}\``
    ].join('\n');

    for (const chatId of chatIds) {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: chatId,
          text: messageText,
          parse_mode: 'Markdown'
        }, { timeout: 8000 });
      } catch (err) {
        // Log quietly
      }
    }
  }

  /**
   * Envia un mensaje de prueba a un chatId específico o a todos los configurados
   */
  async sendTestAlert(targetChatId = null) {
    const cfg = await this.getConfig();
    const token = cfg.bot_token;
    if (!token) return { success: false, error: 'Token no configurado en el sistema' };

    const botInfoRes = await this.getBotInfo();
    const botUsername = botInfoRes.bot?.username || 'GrupoGlobalZabbixBot';

    let recipients = [];
    if (targetChatId) {
      recipients = [String(targetChatId).trim()];
    } else {
      recipients = this.parseChatIds(cfg.chat_ids);
    }

    if (recipients.length === 0) {
      return {
        success: false,
        error: `No hay ningún Chat ID configurado. Abra Telegram en su móvil (+595982304930), busque @${botUsername} e inicie el bot para detectarlo.`
      };
    }

    const nowAsuncion = new Date().toLocaleString('es-PY', {
      timeZone: 'America/Asuncion',
      dateStyle: 'short',
      timeStyle: 'medium'
    });

    const testText = [
      '🧪 *PRUEBA DE ALERTA - INGESTIA*',
      '━━━━━━━━━━━━━━━━━━━━━━',
      `🤖 *Bot:* @${botUsername}`,
      `📱 *Móvil Registrado:* \`${cfg.phone || '+595982304930'}\``,
      `🔔 *Filtro Configurado:* Alertas de *Smart Fallback* activas`,
      `🕒 *Hora del Servidor:* ${nowAsuncion}`,
      '━━━━━━━━━━━━━━━━━━━━━━',
      '✅ *¡Conexión verificada exitosamente!*',
      'Este canal recibirá alertas automáticas cada vez que se ejecute un Fallback en el motor de ingesta.'
    ].join('\n');

    const results = [];
    for (const cid of recipients) {
      try {
        const res = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
          chat_id: cid,
          text: testText,
          parse_mode: 'Markdown'
        }, { timeout: 8000 });
        results.push({ chatId: cid, success: true, messageId: res.data?.result?.message_id });
      } catch (err) {
        const errDetail = err.response?.data?.description || err.message;
        results.push({ chatId: cid, success: false, error: errDetail });
      }
    }

    const anySuccess = results.some(r => r.success);
    await configRepo.logAlert({
      alert_type: 'TEST',
      message: testText,
      recipients: JSON.stringify(recipients),
      status: anySuccess ? 'SENT' : 'FAILED',
      error: anySuccess ? null : JSON.stringify(results)
    });

    return {
      success: anySuccess,
      results,
      message: anySuccess
        ? 'Mensaje de prueba enviado exitosamente a Telegram.'
        : `Fallo al enviar mensaje: ${results[0]?.error}`
    };
  }
}

const telegramService = new TelegramService();
module.exports = telegramService;
