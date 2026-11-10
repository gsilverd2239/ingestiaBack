/**
 * Transformer module to map SAP B1 Service Layer responses
 * into the required Ingestion API payloads.
 */

/**
 * Normalizes boolean/yes-no values.
 * Supports SAP Service Layer enums ('tYES', 'tNO'), standard DB flags ('Y', 'N'),
 * boolean true/false, numbers (1/0), and Spanish variations ('S', 'TSI').
 * 
 * @param {*} val - Input value to normalize
 * @param {string} [format='Y_N'] - Output format: 'Y_N' ('Y'/'N') or 'tYES'/'tNO' ('tYES'/'tNO')
 * @returns {string} Normalized string
 */
function toYesNo(val, format = 'Y_N') {
  const isTFormat = (
    String(format).toUpperCase() === 'TYES' || 
    String(format).toUpperCase() === 'TNO' || 
    String(format).toUpperCase() === 'TYES_TNO'
  );

  if (val === undefined || val === null) {
    return isTFormat ? 'tNO' : 'N';
  }

  const str = String(val).trim().toUpperCase();
  const isYes = (str === 'TYES' || str === 'Y' || str === 'TRUE' || str === '1' || str === 'S' || str === 'TSI');

  if (isTFormat) {
    return isYes ? 'tYES' : 'tNO';
  }
  return isYes ? 'Y' : 'N';
}

function toTYesNo(val) {
  return toYesNo(val, 'tYES');
}

function toStringOrNull(val) {
  if (val === undefined || val === null || val === '') return null;
  return String(val);
}

function toNumberOrNull(val) {
  if (val === undefined || val === null || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

function mapCardType(val) {
  if (!val) return 'C';
  if (val === 'cCustomer') return 'C';
  if (val === 'cSupplier') return 'S';
  if (val === 'cLid') return 'L';
  return String(val).charAt(0).toUpperCase();
}

/**
 * Transforms BusinessPartners Service Layer object into Ingestion OC_RD payload
 * @param {Object} bp - SAP B1 BusinessPartners Service Layer JSON object
 * @returns {Object} Target ingestion payload
 */
function transformBusinessPartner(bp) {
  if (!bp) {
    throw new Error('BusinessPartner data is null or empty');
  }

  return {
    CardCode: bp.CardCode || '',
    CardName: bp.CardName || '',
    GroupCode: toNumberOrNull(bp.GroupCode),
    GroupNum: toNumberOrNull(bp.PayTermsGrpCode ?? bp.GroupNum),
    LicTradNum: toStringOrNull(bp.FederalTaxID ?? bp.LicTradNum),
    ListNum: toNumberOrNull(bp.PriceListNum ?? bp.ListNum),
    SlpCode: toNumberOrNull(bp.SalesPersonCode ?? bp.SlpCode),
    // Mapping Service Layer Properties3..7 (QryGroup3..7 in OCRD) to QryLunes..Viernes
    QryLunes: toYesNo(bp.Properties3 ?? bp.QryGroup3 ?? bp.QryLunes),
    QryMartes: toYesNo(bp.Properties4 ?? bp.QryGroup4 ?? bp.QryMartes),
    QryMiercoles: toYesNo(bp.Properties5 ?? bp.QryGroup5 ?? bp.QryMiercoles),
    QryJueves: toYesNo(bp.Properties6 ?? bp.QryGroup6 ?? bp.QryJueves),
    QryViernes: toYesNo(bp.Properties7 ?? bp.QryGroup7 ?? bp.QryViernes),
    AgentCode: toStringOrNull(bp.AgentCode),
    U_Latitud: toStringOrNull(bp.U_Latitud),
    U_Longitud: toStringOrNull(bp.U_Longitud),
    U_jCANAL: toStringOrNull(bp.U_jCANAL),
    U_jSUBCANAL: toStringOrNull(bp.U_jSUBCANAL),
    AliasName: toStringOrNull(bp.AliasName),
    CardType: mapCardType(bp.CardType),
    Currency: toStringOrNull(bp.Currency) || 'GS',
    Phone1: toStringOrNull(bp.Phone1),
    Cellular: toStringOrNull(bp.Cellular),
    E_Mail: toStringOrNull(bp.EmailAddress ?? bp.E_Mail),
    validFor: toYesNo(bp.Valid ?? bp.validFor),
    frozenFor: toYesNo(bp.Frozen ?? bp.frozenFor),
    GlblLocNum: toStringOrNull(bp.GlobalLocationNumber ?? bp.GlblLocNum),
    U_SubCanal: toStringOrNull(bp.U_SubCanal),
    U_Repositor: toStringOrNull(bp.U_Repositor)
  };
}

/**
 * Maps SAP Service Layer AddressType to Ingestion AdresType ('B' / 'S')
 */
function mapAdresType(type) {
  if (!type) return 'S';
  const str = String(type).trim();
  if (str === 'bo_ShipTo' || str.toUpperCase() === 'S' || str.toUpperCase() === 'SHIPTO') return 'S';
  if (str === 'bo_BillTo' || str.toUpperCase() === 'B' || str.toUpperCase() === 'BILLTO') return 'B';
  return str;
}

/**
 * Transforms BusinessPartners BPAddresses line into Ingestion tbl_crd1 payload
 * @param {string} cardCode
 * @param {Object} addr - SAP B1 BPAddresses object
 * @returns {Object} Target CRD1 payload
 */
function transformAddress(cardCode, addr) {
  return {
    CardCode: String(cardCode || '').trim(),
    Address: toStringOrNull(addr.AddressName ?? addr.Address) || '',
    Street: toStringOrNull(addr.Street) || null,
    AdresType: mapAdresType(addr.AddressType ?? addr.AdresType)
  };
}

/**
 * Transforms Items Service Layer object into Ingestion OITM payload
 * @param {Object} item - SAP B1 Items Service Layer JSON object
 * @param {Object} [options={}] - Options or bodyTemplate (supports booleanFormat: 'Y_N' | 'tYES')
 * @returns {Object} Target ingestion payload
 */
function transformItem(item, options = {}) {
  if (!item) {
    throw new Error('Item data is null or empty');
  }

  // Detect requested boolean format: 'Y_N' (default, currently required by Ingestion API varchar(1))
  // or 'tYES' if requested in options or bodyTemplate
  let boolFormat = 'Y_N';
  if (options && typeof options === 'object') {
    if (options.booleanFormat) {
      boolFormat = options.booleanFormat;
    } else if (options.useTYesNo) {
      boolFormat = 'tYES';
    } else if (
      String(options.validFor || options.valid || '').toUpperCase() === 'TYES' ||
      String(options.QryInventario || '').toUpperCase() === 'TYES'
    ) {
      boolFormat = 'tYES';
    }
  }

  let taxCode = 10;
  if (item.ArTaxCode) {
    const match = String(item.ArTaxCode).match(/\d+/);
    if (match) taxCode = parseInt(match[0], 10);
  } else if (item.TaxCodeAR !== undefined) {
    taxCode = toNumberOrNull(item.TaxCodeAR) || 10;
  }

  const weight = item.SalesUnitWeight !== undefined ? item.SalesUnitWeight : (item.SWeight1 !== undefined ? item.SWeight1 : 0);

  // U_ItemQty como entero numérico (ej: 1)
  let itemQty = 1;
  if (item.U_ItemQty !== undefined && item.U_ItemQty !== null) {
    const parsedQty = parseInt(item.U_ItemQty, 10);
    if (!isNaN(parsedQty)) {
      itemQty = parsedQty;
    }
  }

  // U_beas_vg como string (ej: "1" o "2")
  let beasVg = '1';
  if (item.U_beas_vg !== undefined && item.U_beas_vg !== null) {
    const strVg = String(item.U_beas_vg).trim();
    if (strVg) beasVg = strVg;
  }

  // Mapeo Properties3 en SAP Service Layer / QryGroup3 en HANA -> QryInventario en Ingestion API
  // Soporta tanto 'tYES'/'tNO' como 'Y'/'N'
  const rawQryInventario = item.Properties3 ?? item.properties3 ?? item.Properties_3 ?? item.QryGroup3 ?? item.qrygroup3 ?? item.QryInventario ?? item.qryinventario;
  const finalQryInventario = (rawQryInventario !== undefined && rawQryInventario !== null)
    ? rawQryInventario
    : (item.InventoryItem ?? 'Y');

  return {
    DfltWH: toStringOrNull(item.DefaultWarehouse ?? item.DfltWH) || '01',
    ItemCode: String(item.ItemCode || '').trim(),
    ItemName: String(item.ItemName || '').trim(),
    SWeight1: Number(weight).toFixed(6),
    validFor: toYesNo(item.Valid ?? item.validFor ?? item.validfor ?? item.valid ?? 'Y', boolFormat),
    TaxCodeAR: taxCode,
    U_ItemQty: itemQty,
    U_beas_vg: beasVg,
    frozenFor: toYesNo(item.Frozen ?? item.frozenFor ?? item.frozenfor ?? item.frozen ?? 'N', boolFormat),
    ItmsGrpCod: toNumberOrNull(item.ItemsGroupCode ?? item.ItmsGrpCod) || 100,
    QryInventario: toYesNo(finalQryInventario, boolFormat)
  };
}

/**
 * Transforms JCANAL (Canales de Venta / JCALES) Service Layer object into Ingestion tbl_jcanales payload
 * Validates and converts Code to numeric integer as required by Ingestion API.
 * @param {Object} data - SAP B1 JCANAL Service Layer JSON object
 * @returns {Object} Target ingestion payload with numeric Code and trimmed string Name
 */
function transformJCanal(data) {
  if (!data) {
    throw new Error('JCANAL data is null or empty');
  }

  // Service Layer returns Code as string (e.g. "4"), Ingestion API requires integer number (e.g. 4)
  let code = data.Code ?? data.EntryKey ?? data.DocEntry;
  if (code !== undefined && code !== null) {
    const parsed = parseInt(String(code).trim(), 10);
    if (!isNaN(parsed)) {
      code = parsed;
    }
  }

  return {
    Code: code,
    Name: toStringOrNull(data.Name) || ''
  };
}

/**
 * Transforms PriceLists (OPLN / ObjectType 6) Service Layer object into Ingestion tbl_opln payload
 * @param {Object} data - SAP B1 PriceLists Service Layer JSON object
 * @returns {Object} Target ingestion payload { ListNum, ListName }
 */
function transformPriceList(data) {
  if (!data) {
    throw new Error('PriceList data is null or empty');
  }

  const rawNum = data.PriceListNo ?? data.ListNum ?? data.EntryKey;
  const listNum = rawNum !== undefined && rawNum !== null ? parseInt(String(rawNum).trim(), 10) : null;
  const listName = toStringOrNull(data.PriceListName ?? data.ListName) || '';

  return {
    ListNum: listNum,
    ListName: listName
  };
}

/**
 * Transforms ItemGroups (OITB / ObjectType 52) Service Layer object into Ingestion tbl_oitb payload
 * @param {Object} data - SAP B1 ItemGroups Service Layer JSON object
 * @returns {Object} Target ingestion payload { Number, GroupName }
 */
function transformItemGroup(data) {
  if (!data) {
    throw new Error('ItemGroup data is null or empty');
  }

  const rawNum = data.Number ?? data.ItmsGrpCod ?? data.GroupCode ?? data.EntryKey;
  const num = rawNum !== undefined && rawNum !== null ? parseInt(String(rawNum).trim(), 10) : null;
  const groupName = toStringOrNull(data.GroupName ?? data.ItmsGrpNam ?? data.Name) || '';

  return {
    Number: num,
    GroupName: groupName
  };
}

/**
 * Intelligent transformer using BodyTemplate from PostgreSQL configuration
/**
 * Intelligent transformer using BodyTemplate from PostgreSQL configuration
 * Ensures data types match the template (e.g., numeric Code, boolean, string)
 */
function transformByTemplate(rawData, bodyTemplate) {
  if (!rawData || !bodyTemplate || typeof bodyTemplate !== 'object') {
    return rawData;
  }

  // 1. Unwrap OData collection or SQLQueryResult { value: [ ... ] } or array [ ... ]
  let source = rawData;
  if (rawData && rawData.value && Array.isArray(rawData.value)) {
    source = rawData.value[0] || {};
  } else if (Array.isArray(rawData)) {
    source = rawData[0] || {};
  }

  const ALIASES = {
    listnum: ['pricelistno', 'pricelistnum', 'listnum'],
    listname: ['pricelistname', 'listname'],
    number: ['number', 'itmsgrpcod', 'groupcode', 'code'],
    groupname: ['groupname', 'itmsgrpnam', 'name', 'descr', 'description'],
    code: ['code', 'docentry', 'number', 'agentcode', 'groupnumber'],
    name: ['name', 'descr', 'description', 'groupname', 'agentname', 'paymenttermsgroupname'],
    agentcode: ['agentcode', 'code', 'number', 'id', 'entrykey'],
    agentname: ['agentname', 'name', 'descr', 'description'],
    memo: ['memo', 'description', 'comments'],
    qryinventario: ['properties3', 'properties_3', 'qrygroup3', 'qryinventario', 'inventoryitem'],
    validfor: ['valid', 'validfor'],
    frozenfor: ['frozen', 'frozenfor']
  };

  const result = {};

  for (const [key, sampleVal] of Object.entries(bodyTemplate)) {
    const keyLower = key.toLowerCase();
    const candidateKeys = ALIASES[keyLower] || [keyLower];

    // Find matching key in source (case-insensitive and alias-aware)
    const rawKey = Object.keys(source).find(k => candidateKeys.includes(k.toLowerCase()));
    const val = rawKey ? source[rawKey] : undefined;

    if (val === undefined || val === null) {
      // Avoid injecting dummy template placeholder text into real payloads
      if (typeof sampleVal === 'string' && /ejemplo|zona centro|sup01|test/i.test(sampleVal)) {
        result[key] = '';
      } else {
        result[key] = sampleVal;
      }
      continue;
    }

    // Type coercion matching sampleVal in bodyTemplate
    if (typeof sampleVal === 'number') {
      const num = Number(val);
      result[key] = isNaN(num) ? 0 : (Number.isInteger(sampleVal) ? Math.round(num) : num);
    } else if (typeof sampleVal === 'boolean') {
      result[key] = toYesNo(val) === 'Y';
    } else if (typeof sampleVal === 'string') {
      const sampleTrim = sampleVal.trim();
      if (/^t(yes|no)$/i.test(sampleTrim)) {
        result[key] = toYesNo(val, 'tYES');
      } else if (/^[yn]$/i.test(sampleTrim) && /^(validfor|frozenfor|qryinventario|qrylunes|qrymartes|qrymiercoles|qryjueves|qryviernes)$/i.test(keyLower)) {
        result[key] = toYesNo(val, 'Y_N');
      } else {
        result[key] = String(val).trim();
      }
    } else {
      result[key] = val;
    }
  }

  // Safety: If 'Code' in result is numeric string, cast to integer
  if (result.Code !== undefined && typeof result.Code === 'string' && /^\d+$/.test(result.Code.trim())) {
    result.Code = parseInt(result.Code.trim(), 10);
  }

  // Safety: If 'ListNum' in result is numeric string, cast to integer
  if (result.ListNum !== undefined && typeof result.ListNum === 'string' && /^\d+$/.test(result.ListNum.trim())) {
    result.ListNum = parseInt(result.ListNum.trim(), 10);
  }

  // Safety: If 'Number' in result is numeric string, cast to integer
  if (result.Number !== undefined && typeof result.Number === 'string' && /^\d+$/.test(result.Number.trim())) {
    result.Number = parseInt(result.Number.trim(), 10);
  }

  return result;
}

/**
 * Transforms Agent (OAGP - ObjectType 177) data from Service Layer
 * @param {Object} data - Service Layer SQLQueryResult or entity object
 * @returns {Object} Target payload { AgentCode, AgentName, Memo }
 */
function transformAgent(data) {
  let source = data;
  if (data && data.value && Array.isArray(data.value)) {
    source = data.value[0] || {};
  } else if (Array.isArray(data)) {
    source = data[0] || {};
  }

  return {
    AgentCode: String(source.AgentCode ?? source.Code ?? source.EntryKey ?? '').trim(),
    AgentName: String(source.AgentName ?? source.Name ?? source.AgentCode ?? '').trim(),
    Memo: toStringOrNull(source.Memo ?? source.Description ?? '') || ''
  };
}

/**
 * Extensible dispatcher for different SAP ObjectTypes
 * '2' = OCRD (Socios de Negocios)
 * '4' = OITM (Artículos)
 * '6' = OPLN (Listas de Precios)
 * '52' = OITB (Grupos de Artículos)
 * '177' = OAGP (Agentes de Venta / Routing Agents)
 * 'JCANAL' / 'JCALES' = Canales de Venta
 */
function transformByObjectType(objectType, rawData, bodyTemplate = null) {
  const typeStr = String(objectType || '').trim().toUpperCase();
  switch (typeStr) {
    case '2':
    case 'OCRD':
    case 'BUSINESSPARTNERS':
      return transformBusinessPartner(rawData);
    case '4':
    case 'OITM':
    case 'ITEMS':
      return transformItem(rawData, bodyTemplate);
    case '6':
    case 'OPLN':
    case 'PRICELISTS':
    case 'PRICELIST':
      return transformPriceList(rawData);
    case '52':
    case 'OITB':
    case 'ITEMGROUPS':
    case 'ITEMGROUP':
      return transformItemGroup(rawData);
    case '177':
    case 'OAGP':
    case 'AGENTS':
    case 'AGENT':
      return transformAgent(rawData);
    case 'JCANAL':
    case 'JCALES':
    case 'TBL_JCANALES':
    case 'CANALES':
      return transformJCanal(rawData);
    default:
      if (bodyTemplate && typeof bodyTemplate === 'object') {
        return transformByTemplate(rawData, bodyTemplate);
      }
      return rawData;
  }
}

module.exports = {
  transformBusinessPartner,
  transformAddress,
  mapAdresType,
  transformItem,
  transformPriceList,
  transformItemGroup,
  transformAgent,
  transformJCanal,
  transformByTemplate,
  transformByObjectType,
  toYesNo,
  toTYesNo,
  mapCardType
};
