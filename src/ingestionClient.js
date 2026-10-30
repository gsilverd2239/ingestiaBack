const axios = require('axios');
const { getConfig } = require('./config');
const { logger } = require('./logger');
const { transformItem, transformBusinessPartner, transformAddress } = require('./transformer');

class IngestionClient {
  getConfig() {
    return getConfig().ingestion;
  }

  getEndpointUrl(action = 'U', cardCode = '', objectType = '2') {
    const rootConfig = getConfig();
    const config = rootConfig.ingestion || {};
    const empresaId = config.empresaId || 2;
    const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    const isAdd = String(action).toUpperCase() === 'A';
    const method = isAdd ? 'POST' : 'PUT';

    // Search template configured in PostgreSQL for this ObjectType and Method
    const empresaTemplates = rootConfig.templates?.empresa || config.templates || [];
    const template = empresaTemplates.find(t => 
      String(t.ObjectType || '').trim() === String(objectType).trim() && 
      String(t.MetodoHttpt || '').toUpperCase() === method
    );

    let path = '';
    if (template && template.EndPoint) {
      const safeKey = encodeURIComponent(String(cardCode).replace(/'/g, "''"));
      let endpoint = template.EndPoint
        .replace(/\{IdEmpresa\}/gi, encodeURIComponent(empresaId))
        .replace(/\{empresaId\}/gi, encodeURIComponent(empresaId))
        .replace(/\{(EntryKey|CardCode|ItemCode|Code|ListNum|Number|ItmsGrpCod|GroupCode|DocNum|AbsEntry|Key|Id|DocEntry)\}/gi, safeKey)
        .replace(/\(['"]?(EntryKey|CardCode|ItemCode|Code|ListNum|Number|ItmsGrpCod|GroupCode|DocNum|AbsEntry|Key|Id|DocEntry)['"]?\)/gi, `('${safeKey}')`)
        .replace(/['"](EntryKey|CardCode|ItemCode|Code|ListNum|Number|ItmsGrpCod|GroupCode|DocNum|AbsEntry|Key|Id|DocEntry)['"]/gi, `'${safeKey}'`)
        .replace(/\/(EntryKey|CardCode|ItemCode|Code|ListNum|Number|ItmsGrpCod|GroupCode|DocNum|AbsEntry|Key|Id|DocEntry)$/gi, `/${safeKey}`)
        .replace(/\{[a-zA-Z0-9_-]+\}/g, safeKey);

      if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
        return endpoint;
      }
      path = endpoint;
    } else {
      // Fallback
      if (isAdd) {
        path = `/socios-negocio/empresas/${encodeURIComponent(empresaId)}/tbl_ocrd/`;
      } else {
        path = `/socios-negocio/empresas/${encodeURIComponent(empresaId)}/tbl_ocrd/${encodeURIComponent(cardCode)}`;
      }
    }

    // Defensive check: If baseUrl already ends with /socios-negocio/empresas and path starts with /socios-negocio/empresas, avoid duplicating
    if (baseUrl.endsWith('/socios-negocio/empresas') && path.startsWith('/socios-negocio/empresas/')) {
      path = path.substring('/socios-negocio/empresas'.length);
    }

    return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  async sendBusinessPartner(payload, action = 'U', objectType = '2', entryKey = '') {
    return await this.sendPayload(payload, action, objectType, entryKey);
  }

  /**
   * Sincronización ENDURO para ObjectType 4 (Artículos / OITM)
   * Impacta en dos tablas distintas de la Ingestión API sin depender de TEMPLATEEMPRESA:
   * 1. Cabecera del Artículo -> tbl_oitm (POST para 'A', PUT para 'U', con smart fallback)
   * 2. Lista de Precios -> tbl_itm1 (POST para 'A', PUT para 'U', con smart fallback por cada PriceList)
   */
  async sendItemWithPrices(sapRawItem, action = 'U') {
    const rootConfig = getConfig();
    const config = rootConfig.ingestion || {};
    const empresaId = config.empresaId || 2;
    const baseUrl = (config.baseUrl || 'https://api.comercia.pro/api/v1/admin').replace(/\/+$/, '');
    const timeoutMs = config.timeoutMs || 15000;
    const isAdd = String(action).toUpperCase() === 'A';
    const itemCode = String(sapRawItem?.ItemCode || '').trim();

    if (!itemCode) {
      return {
        success: false,
        error: 'Datos del Artículo inválidos: ItemCode es requerido.',
        statusCode: 400
      };
    }

    const startTime = Date.now();

    try {
      // 1. Cabecera OITM
      const oitmPayload = transformItem(sapRawItem);
      const oitmPostUrl = `${baseUrl}/catalogo/empresas/${encodeURIComponent(empresaId)}/tbl_oitm`;
      const oitmPutUrl = `${baseUrl}/catalogo/empresas/${encodeURIComponent(empresaId)}/tbl_oitm/${encodeURIComponent(itemCode)}`;

      logger.info(`[ObjectType 4 - ENDURO] Sincronizando cabecera tbl_oitm para ${itemCode} (${isAdd ? 'ADD' : 'UPDATE'})...`);

      let oitmRes = null;
      let oitmMethod = isAdd ? 'POST' : 'PUT';
      let oitmUrl = isAdd ? oitmPostUrl : oitmPutUrl;
      let wasFallback = false;

      if (isAdd) {
        try {
          oitmRes = await axios.post(oitmPostUrl, oitmPayload, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            timeout: timeoutMs
          });
          logger.info(`[tbl_oitm] Inserción POST exitosa para ${itemCode}`);
        } catch (err) {
          if (err.response && err.response.status === 409) {
            logger.warn(`[tbl_oitm] ${itemCode} ya existe (409 Conflict). Aplicando actualización PUT de respaldo...`);
            wasFallback = true;
            oitmMethod = 'PUT';
            oitmUrl = oitmPutUrl;
            oitmRes = await axios.put(oitmPutUrl, oitmPayload, {
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              timeout: timeoutMs
            });
          } else {
            throw err;
          }
        }
      } else {
        try {
          oitmRes = await axios.put(oitmPutUrl, oitmPayload, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            timeout: timeoutMs
          });
          logger.info(`[tbl_oitm] Actualización PUT exitosa para ${itemCode}`);
        } catch (err) {
          if (err.response && err.response.status === 404) {
            logger.warn(`[tbl_oitm] ${itemCode} no encontrado (404 Not Found). Aplicando inserción POST de respaldo...`);
            wasFallback = true;
            oitmMethod = 'POST';
            oitmUrl = oitmPostUrl;
            oitmRes = await axios.post(oitmPostUrl, oitmPayload, {
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              timeout: timeoutMs
            });
          } else {
            throw err;
          }
        }
      }

      // 2. Precios en tbl_itm1
      const itemPrices = Array.isArray(sapRawItem.ItemPrices) ? sapRawItem.ItemPrices : [];
      const itm1PostUrl = `${baseUrl}/catalogo/empresas/${encodeURIComponent(empresaId)}/tbl_itm1`;

      logger.info(`[ObjectType 4 - ENDURO] Sincronizando ${itemPrices.length} listas de precios en tbl_itm1 para ${itemCode}...`);

      const pricePromises = itemPrices.map(async (p) => {
        const priceList = parseInt(p.PriceList, 10);
        if (isNaN(priceList)) return null;

        const priceNum = Number(p.Price || 0);
        const priceFormatted = priceNum.toFixed(6);
        const itm1Payload = {
          ItemCode: itemCode,
          PriceList: priceList,
          Price: priceFormatted
        };
        const itm1PutUrl = `${baseUrl}/catalogo/empresas/${encodeURIComponent(empresaId)}/tbl_itm1/${encodeURIComponent(itemCode)}/${encodeURIComponent(priceList)}`;

        // Si el precio es 0 y es inserción nueva (Action 'A'), se omite para no llenar tbl_itm1 de ceros
        if (priceNum === 0 && isAdd) {
          return null;
        }

        try {
          if (isAdd) {
            try {
              const res = await axios.post(itm1PostUrl, itm1Payload, {
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                timeout: timeoutMs
              });
              return { priceList, method: 'POST', status: res.status, price: priceFormatted };
            } catch (postErr) {
              if (postErr.response && postErr.response.status === 409) {
                const res = await axios.put(itm1PutUrl, itm1Payload, {
                  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                  timeout: timeoutMs
                });
                return { priceList, method: 'PUT (fallback)', status: res.status, price: priceFormatted };
              }
              logger.warn(`[tbl_itm1] Error insertando PriceList ${priceList} para ${itemCode}`, { error: postErr.message });
              return { priceList, error: postErr.message };
            }
          } else {
            try {
              const res = await axios.put(itm1PutUrl, itm1Payload, {
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                timeout: timeoutMs
              });
              return { priceList, method: 'PUT', status: res.status, price: priceFormatted };
            } catch (putErr) {
              if (putErr.response && putErr.response.status === 404) {
                // Si el precio > 0 y no existía en la tabla, lo insertamos con POST
                if (priceNum > 0) {
                  const res = await axios.post(itm1PostUrl, itm1Payload, {
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    timeout: timeoutMs
                  });
                  return { priceList, method: 'POST (fallback)', status: res.status, price: priceFormatted };
                }
                return null; // Precio en 0 que no existía, omitir
              }
              logger.warn(`[tbl_itm1] Error actualizando PriceList ${priceList} para ${itemCode}`, { error: putErr.message });
              return { priceList, error: putErr.message };
            }
          }
        } catch (lineErr) {
          logger.warn(`[tbl_itm1] Excepción en PriceList ${priceList} para ${itemCode}`, { error: lineErr.message });
          return { priceList, error: lineErr.message };
        }
      });

      const settledPrices = (await Promise.all(pricePromises)).filter(Boolean);
      const durationMs = Date.now() - startTime;

      logger.info(`[ObjectType 4 - ENDURO] Sincronización exitosa (${durationMs}ms) para ${itemCode}. tbl_oitm OK (${oitmMethod}), tbl_itm1 sincronizadas: ${settledPrices.filter(r => r.status).length}`);

      return {
        success: true,
        method: oitmMethod,
        statusCode: oitmRes?.status || 200,
        durationMs,
        wasFallback,
        url: oitmUrl,
        oitm: oitmPayload,
        itm1Count: settledPrices.filter(r => r.status).length,
        itm1Results: settledPrices
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const status = err.response ? err.response.status : 500;
      logger.error(`[ObjectType 4 - ENDURO] Error en Ingestión API para ${itemCode} (${durationMs}ms)`, {
        error: err.message,
        statusCode: status,
        responseData: err.response?.data
      });
      return {
        success: false,
        error: err.message,
        statusCode: status,
        durationMs,
        responseData: err.response?.data
      };
    }
  }

  /**
   * Sincronización ENDURO para ObjectType 2 (Socios de Negocio / OCRD)
   * Impacta en dos tablas distintas de la Ingestión API sin depender de TEMPLATEEMPRESA:
   * 1. Cabecera del Socio -> tbl_ocrd (POST para 'A', PUT para 'U', con smart fallback)
   * 2. Direcciones del Socio -> tbl_crd1 (POST para 'A', PUT para 'U', con selector de dirección existente)
   */
  async sendBusinessPartnerWithAddresses(sapRawBP, action = 'U') {
    const rootConfig = getConfig();
    const config = rootConfig.ingestion || {};
    const empresaId = config.empresaId || 2;
    const baseUrl = (config.baseUrl || 'https://api.comercia.pro/api/v1/admin').replace(/\/+$/, '');
    const timeoutMs = config.timeoutMs || 15000;
    const isAdd = String(action).toUpperCase() === 'A';
    const cardCode = String(sapRawBP?.CardCode || '').trim();

    if (!cardCode) {
      return {
        success: false,
        error: 'Datos del Socio inválidos: CardCode es requerido.',
        statusCode: 400
      };
    }

    const startTime = Date.now();

    try {
      // 1. Cabecera OCRD
      const ocrdPayload = transformBusinessPartner(sapRawBP);
      const ocrdPostUrl = `${baseUrl}/socios-negocio/empresas/${encodeURIComponent(empresaId)}/tbl_ocrd`;
      const ocrdPutUrl = `${baseUrl}/socios-negocio/empresas/${encodeURIComponent(empresaId)}/tbl_ocrd/${encodeURIComponent(cardCode)}`;

      logger.info(`[ObjectType 2 - ENDURO] Sincronizando cabecera tbl_ocrd para ${cardCode} (${isAdd ? 'ADD' : 'UPDATE'})...`);

      let ocrdRes = null;
      let ocrdMethod = isAdd ? 'POST' : 'PUT';
      let ocrdUrl = isAdd ? ocrdPostUrl : ocrdPutUrl;
      let wasFallback = false;

      if (isAdd) {
        try {
          ocrdRes = await axios.post(ocrdPostUrl, ocrdPayload, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            timeout: timeoutMs
          });
          logger.info(`[tbl_ocrd] Inserción POST exitosa para ${cardCode}`);
        } catch (err) {
          if (err.response && err.response.status === 409) {
            logger.warn(`[tbl_ocrd] ${cardCode} ya existe (409 Conflict). Aplicando actualización PUT de respaldo...`);
            wasFallback = true;
            ocrdMethod = 'PUT';
            ocrdUrl = ocrdPutUrl;
            ocrdRes = await axios.put(ocrdPutUrl, ocrdPayload, {
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              timeout: timeoutMs
            });
          } else {
            throw err;
          }
        }
      } else {
        try {
          ocrdRes = await axios.put(ocrdPutUrl, ocrdPayload, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            timeout: timeoutMs
          });
          logger.info(`[tbl_ocrd] Actualización PUT exitosa para ${cardCode}`);
        } catch (err) {
          if (err.response && err.response.status === 404) {
            logger.warn(`[tbl_ocrd] ${cardCode} no encontrado (404 Not Found). Aplicando inserción POST de respaldo...`);
            wasFallback = true;
            ocrdMethod = 'POST';
            ocrdUrl = ocrdPostUrl;
            ocrdRes = await axios.post(ocrdPostUrl, ocrdPayload, {
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              timeout: timeoutMs
            });
          } else {
            throw err;
          }
        }
      }

      // 2. Direcciones en tbl_crd1
      const bpAddresses = Array.isArray(sapRawBP.BPAddresses) ? sapRawBP.BPAddresses : [];
      const crd1PostUrl = `${baseUrl}/socios-negocio/empresas/${encodeURIComponent(empresaId)}/tbl_crd1`;
      const crd1BasePutUrl = `${baseUrl}/socios-negocio/empresas/${encodeURIComponent(empresaId)}/tbl_crd1/${encodeURIComponent(cardCode)}`;

      logger.info(`[ObjectType 2 - ENDURO] Sincronizando ${bpAddresses.length} direcciones en tbl_crd1 para ${cardCode}...`);

      let existingItems = [];
      try {
        const getExistingRes = await axios.get(crd1BasePutUrl, {
          headers: { 'Accept': 'application/json' },
          timeout: timeoutMs
        });
        existingItems = getExistingRes.data?.items || [];
      } catch (getErr) {
        existingItems = [];
      }

      const addressPromises = bpAddresses.map(async (addr) => {
        const crd1Payload = transformAddress(cardCode, addr);
        if (!crd1Payload.Address) return null;

        const existing = existingItems.find(item => item.Address === crd1Payload.Address);

        try {
          if (existing) {
            const selector = JSON.stringify({
              Address: existing.Address,
              Street: existing.Street ?? null,
              AdresType: existing.AdresType ?? 'S'
            });
            const crd1PutUrl = `${crd1BasePutUrl}?direccion=${encodeURIComponent(selector)}`;
            const res = await axios.put(crd1PutUrl, crd1Payload, {
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              timeout: timeoutMs
            });
            return { address: crd1Payload.Address, method: 'PUT', status: res.status, adresType: crd1Payload.AdresType };
          } else {
            try {
              const res = await axios.post(crd1PostUrl, crd1Payload, {
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                timeout: timeoutMs
              });
              return { address: crd1Payload.Address, method: 'POST', status: res.status, adresType: crd1Payload.AdresType };
            } catch (postErr) {
              if (postErr.response && postErr.response.status === 409) {
                const res = await axios.put(crd1BasePutUrl, crd1Payload, {
                  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                  timeout: timeoutMs
                });
                return { address: crd1Payload.Address, method: 'PUT (fallback)', status: res.status, adresType: crd1Payload.AdresType };
              }
              logger.warn(`[tbl_crd1] Error insertando Address "${crd1Payload.Address}" para ${cardCode}`, { error: postErr.message });
              return { address: crd1Payload.Address, error: postErr.message };
            }
          }
        } catch (addrErr) {
          logger.warn(`[tbl_crd1] Excepción en Address "${crd1Payload.Address}" para ${cardCode}`, { error: addrErr.message });
          return { address: crd1Payload.Address, error: addrErr.message };
        }
      });

      const settledAddresses = (await Promise.all(addressPromises)).filter(Boolean);
      const durationMs = Date.now() - startTime;

      logger.info(`[ObjectType 2 - ENDURO] Sincronización exitosa (${durationMs}ms) para ${cardCode}. tbl_ocrd OK (${ocrdMethod}), tbl_crd1 sincronizadas: ${settledAddresses.filter(r => r.status).length}`);

      return {
        success: true,
        method: ocrdMethod,
        statusCode: ocrdRes?.status || 200,
        durationMs,
        wasFallback,
        url: ocrdUrl,
        ocrd: ocrdPayload,
        crd1Count: settledAddresses.filter(r => r.status).length,
        crd1Results: settledAddresses
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const status = err.response ? err.response.status : 500;
      logger.error(`[ObjectType 2 - ENDURO] Error en Ingestión API para ${cardCode} (${durationMs}ms)`, {
        error: err.message,
        statusCode: status,
        responseData: err.response?.data
      });
      return {
        success: false,
        error: err.message,
        statusCode: status,
        durationMs,
        responseData: err.response?.data
      };
    }
  }

  async sendPayload(payload, action = 'U', objectType = '2', entryKey = '', rawData = null) {
    const typeStr = String(objectType || '').trim().toUpperCase();

    // Si es ObjectType 2 (Socios de Negocio / OCRD), ejecutar lógica ENDURO dual (tbl_ocrd + tbl_crd1)
    if (typeStr === '2' || typeStr === 'OCRD' || typeStr === 'BUSINESSPARTNERS') {
      return await this.sendBusinessPartnerWithAddresses(rawData || payload, action);
    }

    // Si es ObjectType 4 (Artículos), ejecutar lógica ENDURO dual (tbl_oitm + tbl_itm1)
    if (typeStr === '4' || typeStr === 'OITM' || typeStr === 'ITEMS') {
      return await this.sendItemWithPrices(rawData || payload, action);
    }

    const recordKey = entryKey || payload?.CardCode || payload?.ItemCode || payload?.Code || payload?.ListNum || payload?.Number || payload?.ItmsGrpCod || payload?.EntryKey || payload?.Id || '';
    if (!payload || !recordKey) {
      throw new Error('Payload inválido: CardCode, ItemCode, Code, ListNum o Number es requerido.');
    }

    const config = this.getConfig();
    let isAdd = String(action).toUpperCase() === 'A';
    let method = isAdd ? 'POST' : 'PUT';
    let url = this.getEndpointUrl(action, recordKey, objectType);

    // Smart technical ID resolution:
    // If the configured endpoint uses {id} (e.g. tbl_opln/{id}, tbl_oslp/{id}, tbl_ocrg/{id}),
    // the route parameter {id} is the surrogate internal table ID, NOT the business key (e.g. ListNum=17).
    if (!isAdd) {
      const rootConfig = getConfig();
      const empresaTemplates = rootConfig.templates?.empresa || config.templates || [];
      const putTemplate = empresaTemplates.find(t => 
        String(t.ObjectType || '').trim() === String(objectType).trim() && 
        String(t.MetodoHttpt || '').toUpperCase() === 'PUT'
      );

      if (putTemplate && putTemplate.EndPoint && /\{id\}/i.test(putTemplate.EndPoint)) {
        try {
          const collectionUrl = this.getEndpointUrl('A', recordKey, objectType).replace(/\/+$/, '');
          const searchRes = await axios.get(`${collectionUrl}?buscar=${encodeURIComponent(recordKey)}`, {
            timeout: config.timeoutMs || 10000
          });
          const items = searchRes.data?.items || (Array.isArray(searchRes.data) ? searchRes.data : []);
          const match = items.find(it => {
            return String(it.ListNum ?? it.Code ?? it.GroupCode ?? it.SlpCode ?? it.CardCode ?? it.ItemCode ?? it.id) === String(recordKey);
          });

          if (match && match.id) {
            url = this.getEndpointUrl(action, match.id, objectType);
            logger.info(`Resuelto ID técnico para ObjectType='${objectType}' (clave=${recordKey} -> id=${match.id}): ${url}`);
          } else {
            logger.warn(`Registro con clave ${recordKey} no encontrado para ${objectType} en ${collectionUrl}. Cambiando a inserción (POST)...`);
            isAdd = true;
            method = 'POST';
            url = this.getEndpointUrl('A', recordKey, objectType);
          }
        } catch (searchErr) {
          logger.warn(`No se pudo resolver ID técnico para ${objectType} (${searchErr.message}), usando endpoint directo.`);
        }
      }
    }
    const startTime = Date.now();

    logger.info(`Enviando payload a Ingestión API...`, {
      action: isAdd ? 'ADD (A)' : 'UPDATE (U)',
      method,
      url,
      objectType,
      recordKey
    });

    try {
      const response = await axios({
        method,
        url,
        data: payload,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: config.timeoutMs || 15000
      });

      const durationMs = Date.now() - startTime;
      logger.info(`Respuesta Ingestión API exitosa (${durationMs}ms)`, {
        method,
        status: response.status,
        recordKey
      });

      return {
        success: true,
        method,
        statusCode: response.status,
        durationMs,
        data: response.data,
        url
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const statusCode = err.response ? err.response.status : null;
      const responseData = err.response ? err.response.data : null;

      // Smart Fallback 1: Si es ADD ('A') pero ya existe (HTTP 409 Conflict), intentar actualización (PUT)
      if (isAdd && statusCode === 409) {
        logger.warn(`Registro ${recordKey} ya existe en Ingestión (HTTP 409). Aplicando actualización alternativa (PUT)...`);
        const fallbackUrl = this.getEndpointUrl('U', recordKey, objectType);
        try {
          const fallbackRes = await axios.put(fallbackUrl, payload, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            timeout: config.timeoutMs || 15000
          });
          const fbDuration = Date.now() - startTime;
          logger.info(`Actualización alternativa (PUT) exitosa (${fbDuration}ms)`, {
            status: fallbackRes.status,
            recordKey
          });
          return {
            success: true,
            method: 'PUT (fallback de POST 409)',
            statusCode: fallbackRes.status,
            durationMs: fbDuration,
            data: fallbackRes.data,
            url: fallbackUrl,
            wasFallback: true
          };
        } catch (fbErr) {
          logger.error(`Falló también la actualización alternativa para ${recordKey}`, { error: fbErr.message });
        }
      }

      // Smart Fallback 2: Si es UPDATE ('U') pero no existe (HTTP 404 Not Found), intentar creación (POST)
      if (!isAdd && statusCode === 404) {
        logger.warn(`Registro ${recordKey} no encontrado para actualizar (HTTP 404). Creándolo mediante inserción alternativa (POST)...`);
        const fallbackUrl = this.getEndpointUrl('A', recordKey, objectType);
        try {
          const fallbackRes = await axios.post(fallbackUrl, payload, {
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            timeout: config.timeoutMs || 15000
          });
          const fbDuration = Date.now() - startTime;
          logger.info(`Inserción alternativa (POST) exitosa (${fbDuration}ms)`, {
            status: fallbackRes.status,
            recordKey
          });
          return {
            success: true,
            method: 'POST (fallback de PUT 404)',
            statusCode: fallbackRes.status,
            durationMs: fbDuration,
            data: fallbackRes.data,
            url: fallbackUrl,
            wasFallback: true
          };
        } catch (fbErr) {
          logger.error(`Falló también la inserción alternativa para ${recordKey}`, { error: fbErr.message });
        }
      }

      logger.error(`Error en Ingestión API (${durationMs}ms)`, {
        method,
        statusCode,
        error: err.message,
        responseData,
        url,
        recordKey
      });

      return {
        success: false,
        method,
        statusCode,
        durationMs,
        error: err.message,
        responseData,
        url
      };
    }
  }

  async testConnection() {
    try {
      const config = this.getConfig();
      // Test sample reachability on the base URL
      const testUrl = this.getEndpointUrl('TEST_CONNECTIVITY');
      const startTime = Date.now();

      let status = null;
      let ok = false;
      let errorDetail = null;

      try {
        const res = await axios.get(testUrl, { timeout: 8000 });
        status = res.status;
        ok = true;
      } catch (err) {
        if (err.response) {
          // If server responded with 404/400/200, the server is reachable and active!
          status = err.response.status;
          ok = true; // Reachable!
        } else {
          errorDetail = err.message;
        }
      }

      const durationMs = Date.now() - startTime;
      return {
        success: ok,
        message: ok ? `Endpoint alcanzable (HTTP ${status})` : `No se pudo conectar: ${errorDetail}`,
        statusCode: status,
        durationMs,
        testedUrl: testUrl
      };
    } catch (err) {
      return {
        success: false,
        message: err.message,
        testedUrl: this.getConfig().baseUrl
      };
    }
  }
}

module.exports = new IngestionClient();
