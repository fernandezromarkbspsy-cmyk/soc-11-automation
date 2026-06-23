/**
 * Google Apps Script implementation for the soc11-workstation SeaTalk bot.
 *
 * Configure values in Project Settings > Script properties, then run
 * installThreeHourlyTrigger() once from the Apps Script editor.
 */

const DEFAULTS = {
  BOT_NAME: 'soc11-workstation',
  TIME_ZONE: 'Asia/Manila',
  SEATALK_API_BASE: 'https://openapi.seatalk.io',
  SEATALK_GROUP_ID: '',
  SEATALK_EXTRA_GROUP_IDS: '',
  SEATALK_WELCOME_ON_ADD: 'false',
  GOOGLE_SPREADSHEET_ID: '1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8',
  GOOGLE_GROUP_IDS_RANGE: 'bot_groupid!I2:I',
  GOOGLE_CAPTURE_RANGE: 'workstation!A1:J42',
  GOOGLE_NON_COMPLIANT_RANGE_1: 'ws-idle!A1',
  GOOGLE_NON_COMPLIANT_RANGE_2: 'ws-idle!T1',
  GOOGLE_EXPORT_LANDSCAPE: 'true',
  REPORT_TITLE_PREFIX: 'SOC 11 Workstation Compliance as of',
  REPORT_TIMESTAMP_FORMAT: 'h:mm a MMM-dd',
  REPORT_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1UX7Wxjlp1cED9S8dboj-mEDgoNOPixsevgjdQenJdv4/edit?gid=1098721836#gid=1098721836',
  REPORT_SEND_IMAGE: 'true',
  REPORT_REQUIRE_IMAGE: 'true',
  REPORT_EXCLUDE_BLANK_CAPTURE_ROWS: 'false',
  REPORT_MAX_CAPTURE_ROW_HEIGHT: '80',
  PDF_TO_PNG_SERVICE_URL: 'https://r72z2fkbntugv7yrw4kofctudy0xtyqh.lambda-url.ap-southeast-1.on.aws/convert/pdf-to-png',
  PDF_TO_PNG_SERVICE_TOKEN: 'PkbenUfrfqo77V8gRgdFeC7kXsky4UYeMBuM52aTF7g',
  BOT_PDF_DPI: '220',
  BOT_IMAGE_RESIZE_WIDTH: '2200',
  BOT_IMAGE_BORDER_PX: '20',
  SEATALK_MAX_BASE64_BYTES: String(5 * 1024 * 1024),
  BOT_EXPECTED_SEND_INTERVAL_MINUTES: '180',
  BOT_LOGS_SHEET_NAME: 'bot_logs',
  BOT_DELAY_GRACE_MINUTES: '5',
};

const WORKSTATION_REPORT_TITLE_PREFIX = 'SOC 11 Workstation Compliance as of';

function sendWorkstationReport() {
  const cfg = loadConfig_();
  const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
  return sendWorkstationReportWithConfig_(cfg, spreadsheet);
}

function sendReportNow() {
  return sendWorkstationReport();
}

function sendTestReportToWorkstationGroupNow() {
  const cfg = loadConfig_();
  const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
  const elements = buildWorkstationCardElements_(cfg, spreadsheet);
  const result = sendToGroups_(cfg, spreadsheet, ['NjkwNjYwNzkyMjI3'], elements);
  if (result.sent === 0) {
    throw new Error('Workstation test report was not sent. ' + result.errors.join(' | '));
  }
  if (result.errors.length > 0) {
    console.warn('Workstation test report sent, with skipped/failed groups: ' + result.errors.join(' | '));
  }
  return result;
}

function installThreeHourlyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      const handler = trigger.getHandlerFunction();
      return handler === 'sendWorkstationReport' ||
        handler === 'pollWorkstationWatchRange';
    })
    .forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger('sendWorkstationReport')
    .timeBased()
    .inTimezone(DEFAULTS.TIME_ZONE)
    .everyHours(3)
    .create();

  console.log('Installed three-hour trigger for sendWorkstationReport.');
}

function installPollingTrigger() {
  return installThreeHourlyTrigger();
}

function checkWorkstationSetup() {
  const cfg = loadConfig_();
  const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
  const groupIds = readGroupIds_(spreadsheet, cfg);
  const sendTriggers = ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return trigger.getHandlerFunction() === 'sendWorkstationReport';
    });
  const summary = {
    botName: cfg.BOT_NAME,
    threeHourlyTriggerInstalled: sendTriggers.length > 0,
    sendWorkstationReportTriggers: sendTriggers.length,
    groupIdCount: groupIds.length,
    pdfToPngConfigured: Boolean(cfg.PDF_TO_PNG_SERVICE_URL),
    imageRequired: cfg.REPORT_SEND_IMAGE && cfg.REPORT_REQUIRE_IMAGE,
    spreadsheetId: cfg.GOOGLE_SPREADSHEET_ID,
    captureRange: cfg.GOOGLE_CAPTURE_RANGE,
    nonCompliantRange1: cfg.GOOGLE_NON_COMPLIANT_RANGE_1,
    nonCompliantRange2: cfg.GOOGLE_NON_COMPLIANT_RANGE_2,
    reportSheetUrl: cfg.REPORT_SHEET_URL,
    excludeBlankCaptureRows: cfg.REPORT_EXCLUDE_BLANK_CAPTURE_ROWS,
    groupIdsRange: cfg.GOOGLE_GROUP_IDS_RANGE,
    extraGroupIds: splitList_(cfg.SEATALK_EXTRA_GROUP_IDS),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (sendTriggers.length === 0) {
    throw new Error('No three-hour trigger found. Run installThreeHourlyTrigger once from the Apps Script editor.');
  }
  if (groupIds.length === 0) {
    throw new Error('No SeaTalk group IDs found in ' + cfg.GOOGLE_GROUP_IDS_RANGE + '. Add a group ID or set SEATALK_GROUP_ID.');
  }
  if (summary.imageRequired && !cfg.PDF_TO_PNG_SERVICE_URL) {
    throw new Error('Report images are required, but PDF_TO_PNG_SERVICE_URL is not configured.');
  }

  return summary;
}

function sendWorkstationReportWithConfig_(cfg, spreadsheet) {
  const groupIds = readGroupIds_(spreadsheet, cfg);
  if (groupIds.length === 0) {
    throw new Error('No SeaTalk group IDs found in ' + cfg.GOOGLE_GROUP_IDS_RANGE);
  }

  const elements = buildWorkstationCardElements_(cfg, spreadsheet);
  const result = sendToGroups_(cfg, spreadsheet, groupIds, elements);
  if (result.sent === 0) {
    throw new Error('Workstation report was not sent to any SeaTalk group. ' + result.errors.join(' | '));
  }
  if (result.errors.length > 0) {
    console.warn('Workstation report sent to ' + result.sent + ' group(s), with skipped/failed groups: ' + result.errors.join(' | '));
  }

  return result;
}

function buildWorkstationCardElements_(cfg, spreadsheet) {
  const elements = [
    titleElement_(buildWorkstationTitle_(cfg)),
    descriptionElement_(buildWorkstationDescription_(cfg, spreadsheet)),
  ];
  const imageBase64 = buildWorkstationImage_(cfg, spreadsheet);
  if (imageBase64) {
    elements.push(imageElement_(imageBase64));
  }
  if (cfg.REPORT_SHEET_URL) {
    elements.push(redirectButtonElement_('View Report Link', cfg.REPORT_SHEET_URL));
  }
  return elements;
}

function buildWorkstationTitle_(cfg) {
  const timestamp = Utilities.formatDate(new Date(), cfg.TIME_ZONE, cfg.REPORT_TIMESTAMP_FORMAT);
  return WORKSTATION_REPORT_TITLE_PREFIX + ' ' + timestamp;
}

function buildWorkstationDescription_(cfg, spreadsheet) {
  const value1 = readRangeDisplayValue_(spreadsheet, cfg.GOOGLE_NON_COMPLIANT_RANGE_1);
  const value2 = readRangeDisplayValue_(spreadsheet, cfg.GOOGLE_NON_COMPLIANT_RANGE_2);
  const workstationLabel = (value1 ? value1 + ' ' : '') + 'Workstation';

  if (!value2 || isSpreadsheetErrorValue_(value2)) {
    return '**' + workstationLabel + '** **100% COMPLIANCE**';
  }

  return [
    '-----------------------------------------------------------------',
    '**' + workstationLabel + '**',
    '**NON-COMPLIANCE**',
    '',
    value2,
  ].join('\n');
}

function buildWorkstationImage_(cfg, spreadsheet) {
  if (!cfg.REPORT_SEND_IMAGE) {
    return '';
  }
  const pdfBlob = exportCaptureRangePdf_(spreadsheet, cfg);
  return tryConvertPdfToPng_(cfg, pdfBlob);
}

function exportCaptureRangePdf_(spreadsheet, cfg) {
  const sourceRange = getSpreadsheetRange_(spreadsheet, cfg.GOOGLE_CAPTURE_RANGE);
  const tempSheet = spreadsheet.insertSheet('__workstation_export_' + Utilities.getUuid().slice(0, 8));

  try {
    const exportRange = buildCleanExportRange_(tempSheet, sourceRange, cfg);
    SpreadsheetApp.flush();
    return exportSheetPdfForRange_(
      spreadsheet,
      cfg,
      String(tempSheet.getSheetId()),
      exportRange.getA1Notation(),
      'workstation-report.pdf'
    );
  } finally {
    spreadsheet.setActiveSheet(sourceRange.getSheet());
    spreadsheet.deleteSheet(tempSheet);
  }
}

function buildCleanExportRange_(tempSheet, sourceRange, cfg) {
  const sourceSheet = sourceRange.getSheet();
  const startRow = sourceRange.getRow();
  const startColumn = sourceRange.getColumn();
  const numRows = sourceRange.getNumRows();
  const numColumns = sourceRange.getNumColumns();
  const displayValues = sourceRange.getDisplayValues();
  const targetRows = [];

  for (let r = 0; r < numRows; r++) {
    const sourceRow = startRow + r;
    if (shouldExcludeCaptureRow_(cfg, sourceSheet, sourceRow, displayValues[r])) {
      continue;
    }
    targetRows.push(r);
  }

  if (targetRows.length === 0) {
    throw new Error('No visible rows found in capture range ' + sourceRange.getA1Notation());
  }

  resizeSheet_(tempSheet, targetRows.length, numColumns);

  for (let c = 0; c < numColumns; c++) {
    tempSheet.setColumnWidth(c + 1, sourceSheet.getColumnWidth(startColumn + c));
  }

  targetRows.forEach(function(sourceOffset, targetOffset) {
    const sourceRowRange = sourceSheet.getRange(startRow + sourceOffset, startColumn, 1, numColumns);
    const targetRowRange = tempSheet.getRange(targetOffset + 1, 1, 1, numColumns);
    sourceRowRange.copyTo(targetRowRange, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    sourceRowRange.copyTo(targetRowRange, SpreadsheetApp.CopyPasteType.PASTE_VALUES, false);
    const sourceHeight = sourceSheet.getRowHeight(startRow + sourceOffset);
    const targetHeight = Math.min(
      cfg.REPORT_MAX_CAPTURE_ROW_HEIGHT,
      Math.max(21, sourceHeight)
    );
    tempSheet.setRowHeight(targetOffset + 1, targetHeight);
  });

  return tempSheet.getRange(1, 1, targetRows.length, numColumns);
}

function shouldExcludeCaptureRow_(cfg, sheet, rowNumber, displayRow) {
  if (sheet.isRowHiddenByUser(rowNumber) || sheet.isRowHiddenByFilter(rowNumber)) {
    return true;
  }
  if (sheet.getRowHeight(rowNumber) <= 2) {
    return true;
  }
  return cfg.REPORT_EXCLUDE_BLANK_CAPTURE_ROWS && isBlankDisplayRow_(displayRow);
}

function isBlankDisplayRow_(displayRow) {
  return displayRow.every(function(value) {
    return !String(value || '').trim();
  });
}

function resizeSheet_(sheet, rows, columns) {
  if (sheet.getMaxRows() < rows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  }
  if (sheet.getMaxRows() > rows) {
    sheet.deleteRows(rows + 1, sheet.getMaxRows() - rows);
  }
  if (sheet.getMaxColumns() < columns) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
  }
  if (sheet.getMaxColumns() > columns) {
    sheet.deleteColumns(columns + 1, sheet.getMaxColumns() - columns);
  }
}

function exportSheetPdfForRange_(spreadsheet, cfg, gid, cellRange, blobName) {
  const params = {
    format: 'pdf',
    gid: gid,
    range: cellRange,
    size: '7',
    fitw: 'true',
    portrait: String(!cfg.GOOGLE_EXPORT_LANDSCAPE),
    sheetnames: 'false',
    printtitle: 'false',
    pagenumbers: 'false',
    gridlines: 'false',
    fzr: 'false',
  };
  const query = Object.keys(params)
    .map(function(key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    })
    .join('&');
  const url = 'https://docs.google.com/spreadsheets/d/' +
    encodeURIComponent(cfg.GOOGLE_SPREADSHEET_ID) + '/export?' + query;

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    },
    muteHttpExceptions: true,
  });

  assertOk_(response, 'Export Google Sheet PDF for ' + cellRange);
  return response.getBlob().setName(blobName);
}

function tryConvertPdfToPng_(cfg, pdfBlob) {
  try {
    return convertPdfToPng_(cfg, pdfBlob);
  } catch (err) {
    if (cfg.REPORT_REQUIRE_IMAGE) {
      throw err;
    }
    console.warn('Report image skipped: ' + err.message);
    return '';
  }
}

function convertPdfToPng_(cfg, pdfBlob) {
  if (!cfg.PDF_TO_PNG_SERVICE_URL) {
    if (cfg.REPORT_REQUIRE_IMAGE) {
      throw new Error('REPORT_SEND_IMAGE is enabled but PDF_TO_PNG_SERVICE_URL is not configured');
    }
    return '';
  }

  const headers = {};
  if (cfg.PDF_TO_PNG_SERVICE_TOKEN) {
    headers.Authorization = 'Bearer ' + cfg.PDF_TO_PNG_SERVICE_TOKEN;
  }

  const response = UrlFetchApp.fetch(cfg.PDF_TO_PNG_SERVICE_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify({
      filename: pdfBlob.getName(),
      pdf_base64: Utilities.base64Encode(pdfBlob.getBytes()),
      dpi: cfg.BOT_PDF_DPI,
      resize_width: cfg.BOT_IMAGE_RESIZE_WIDTH,
      border_px: cfg.BOT_IMAGE_BORDER_PX,
    }),
    muteHttpExceptions: true,
  });

  assertOk_(response, 'PDF to PNG service');
  const decoded = JSON.parse(response.getContentText() || '{}');
  const imageBase64 = normalizeBase64_(decoded.image_base64 || decoded.png_base64 || decoded.content || '');

  if (!imageBase64) {
    throw new Error('PDF to PNG service response missing image_base64');
  }
  if (imageBase64.length > cfg.SEATALK_MAX_BASE64_BYTES) {
    if (cfg.REPORT_REQUIRE_IMAGE) {
      throw new Error('Image is ' + imageBase64.length + ' bytes, over limit ' + cfg.SEATALK_MAX_BASE64_BYTES);
    }
    return '';
  }

  return imageBase64;
}

function sendToGroups_(cfg, spreadsheet, groupIds, elements) {
  const result = {
    sent: 0,
    errors: [],
  };

  groupIds.forEach(function(groupId) {
    try {
      sendInteractive_(cfg, groupId, elements);
      if (typeof logBotSend_ === 'function') {
        try {
          logBotSend_(spreadsheet, cfg, groupId);
        } catch (logErr) {
          console.warn('Failed writing bot log for ' + groupId + ': ' + logErr.message);
        }
      }
      result.sent++;
    } catch (err) {
      if (typeof logBotFailure_ === 'function') {
        try {
          logBotFailure_(spreadsheet, cfg, groupId, err);
        } catch (logErr) {
          console.warn('Failed writing bot failure log for ' + groupId + ': ' + logErr.message);
        }
      }
      if (err.seatalkCode === 7001) {
        result.errors.push(groupId + ': bot is not a member of this group chat');
        console.warn('Skipping SeaTalk group ' + groupId + ': bot is not a member of this group chat. Add the bot to the group or remove this group ID from ' + cfg.GOOGLE_GROUP_IDS_RANGE + '.');
        return;
      }
      result.errors.push(groupId + ': ' + err.message);
      console.error('Failed sending to SeaTalk group ' + groupId + ': ' + err.message);
    }
  });

  return result;
}

function sendInteractive_(cfg, groupId, elements) {
  return postSeatalkJson_(cfg, '/messaging/v2/group_chat', {
    group_id: groupId,
    message: {
      tag: 'interactive_message',
      interactive_message: {
        elements: elements,
      },
    },
  });
}

function titleElement_(text) {
  return {
    element_type: 'title',
    title: {
      text: text,
    },
  };
}

function descriptionElement_(markdown) {
  return {
    element_type: 'description',
    description: {
      format: 1,
      text: markdown,
    },
  };
}

function imageElement_(contentBase64) {
  return {
    element_type: 'image',
    image: {
      content: contentBase64,
    },
  };
}

function redirectButtonElement_(text, link) {
  return {
    element_type: 'button',
    button: {
      button_type: 'redirect',
      text: text,
      mobile_link: {
        type: 'web',
        path: link,
      },
      desktop_link: {
        type: 'web',
        path: link,
      },
    },
  };
}

function doPost(e) {
  const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  const event = JSON.parse(body);

  if (event.event_type === 'event_verification') {
    return textResponse_(extractChallenge_(event));
  }

  if (event.event_type === 'bot_added_to_group_chat') {
    handleBotAdded_(event);
  }

  return jsonResponse_({});
}

function handleBotAdded_(event) {
  const cfg = loadConfig_();
  const group = event.event && event.event.group ? event.event.group : {};
  const groupId = group.group_id || event.event.group_id || '';
  if (!groupId) {
    return;
  }

  const groupName = group.group_name || event.event.group_name || '';
  storeGroupId_(cfg, groupId, groupName);

  if (!cfg.SEATALK_WELCOME_ON_ADD) {
    return;
  }

  postSeatalkJson_(cfg, '/messaging/v2/group_chat_typing', { group_id: groupId });
  postSeatalkJson_(cfg, '/messaging/v2/group_chat', {
    group_id: groupId,
    message: {
      tag: 'text',
      text: {
        format: 1,
        content: cfg.BOT_NAME + ' report bot is connected.',
      },
    },
  });
}

function storeGroupId_(cfg, groupId, groupName) {
  const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
  const range = spreadsheet.getRange(cfg.GOOGLE_GROUP_IDS_RANGE);
  const values = range.getDisplayValues();

  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() === groupId) {
      console.log('SeaTalk group already exists in ' + cfg.GOOGLE_GROUP_IDS_RANGE + ': ' + groupId);
      return;
    }
  }

  const sheet = range.getSheet();
  const column = range.getColumn();
  const startRow = range.getRow();
  let targetRow = startRow;

  for (let i = 0; i < values.length; i++) {
    if (!String(values[i][0] || '').trim()) {
      targetRow = startRow + i;
      break;
    }
    targetRow = startRow + values.length;
  }

  if (targetRow > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), targetRow - sheet.getMaxRows());
  }

  sheet.getRange(targetRow, column).setValue(groupId);
  if (groupName) {
    console.log('Stored SeaTalk group ' + groupName + ' (' + groupId + ') in ' + sheet.getName() + '!' + sheet.getRange(targetRow, column).getA1Notation());
  } else {
    console.log('Stored SeaTalk group ' + groupId + ' in ' + sheet.getName() + '!' + sheet.getRange(targetRow, column).getA1Notation());
  }
}

function loadConfig_() {
  const props = PropertiesService.getScriptProperties();
  const cfg = {};

  Object.keys(DEFAULTS).forEach(function(key) {
    cfg[key] = props.getProperty(key) || DEFAULTS[key];
  });

  cfg.SEATALK_APP_ID = props.getProperty('SEATALK_APP_ID') || '';
  cfg.SEATALK_APP_SECRET = props.getProperty('SEATALK_APP_SECRET') || '';
  cfg.SEATALK_API_BASE = cfg.SEATALK_API_BASE.replace(/\/+$/, '');
  cfg.SEATALK_WELCOME_ON_ADD = parseBool_(cfg.SEATALK_WELCOME_ON_ADD);
  cfg.GOOGLE_EXPORT_LANDSCAPE = parseBool_(cfg.GOOGLE_EXPORT_LANDSCAPE);
  cfg.REPORT_SEND_IMAGE = parseBool_(cfg.REPORT_SEND_IMAGE);
  cfg.REPORT_REQUIRE_IMAGE = parseBool_(cfg.REPORT_REQUIRE_IMAGE);
  cfg.REPORT_EXCLUDE_BLANK_CAPTURE_ROWS = parseBool_(cfg.REPORT_EXCLUDE_BLANK_CAPTURE_ROWS);
  cfg.REPORT_MAX_CAPTURE_ROW_HEIGHT = Math.max(
    21,
    parseInt(cfg.REPORT_MAX_CAPTURE_ROW_HEIGHT, 10) || 80
  );
  cfg.PDF_TO_PNG_SERVICE_URL = normalizeConverterUrl_(cfg.PDF_TO_PNG_SERVICE_URL);
  cfg.BOT_PDF_DPI = Number(cfg.BOT_PDF_DPI);
  cfg.BOT_IMAGE_RESIZE_WIDTH = Number(cfg.BOT_IMAGE_RESIZE_WIDTH);
  cfg.BOT_IMAGE_BORDER_PX = Number(cfg.BOT_IMAGE_BORDER_PX);
  cfg.SEATALK_MAX_BASE64_BYTES = Number(cfg.SEATALK_MAX_BASE64_BYTES);

  const missing = [];
  ['SEATALK_APP_ID', 'SEATALK_APP_SECRET', 'GOOGLE_SPREADSHEET_ID'].forEach(function(key) {
    if (!cfg[key]) {
      missing.push(key);
    }
  });
  if (missing.length > 0) {
    throw new Error('Missing script properties: ' + missing.join(', '));
  }

  return cfg;
}

function readGroupIds_(spreadsheet, cfg) {
  const values = spreadsheet.getRange(cfg.GOOGLE_GROUP_IDS_RANGE).getDisplayValues();
  const seen = {};
  const ids = [];

  values.forEach(function(row) {
    addGroupId_(row[0], seen, ids);
  });

  addGroupId_(cfg.SEATALK_GROUP_ID, seen, ids);
  splitList_(cfg.SEATALK_EXTRA_GROUP_IDS).forEach(function(groupId) {
    addGroupId_(groupId, seen, ids);
  });
  return ids;
}

function addGroupId_(value, seen, ids) {
  const groupId = String(value || '').trim();
  if (!groupId || seen[groupId]) {
    return;
  }
  seen[groupId] = true;
  ids.push(groupId);
}

function readRangeDisplayValue_(spreadsheet, rangeName) {
  const values = spreadsheet.getRange(rangeName).getDisplayValues();
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const value = String(values[r][c] || '').trim();
      if (value) {
        return value;
      }
    }
  }
  return '';
}

function getSpreadsheetRange_(spreadsheet, rangeName) {
  return spreadsheet.getRange(rangeName);
}

function isSpreadsheetErrorValue_(value) {
  return /^#(?:N\/A|VALUE!|REF!|DIV\/0!|NAME\?|NUM!|NULL!)$/i.test(String(value || '').trim());
}

function splitList_(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(function(item) {
      return item.trim();
    })
    .filter(function(item) {
      return Boolean(item);
    });
}

function postSeatalkJson_(cfg, path, payload) {
  const response = UrlFetchApp.fetch(cfg.SEATALK_API_BASE + path, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + seatalkToken_(cfg),
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  assertOk_(response, 'SeaTalk API ' + path);
  const decoded = JSON.parse(response.getContentText() || '{}');
  if (decoded.code !== 0) {
    const err = new Error('SeaTalk API code ' + decoded.code + ': ' + response.getContentText());
    err.seatalkCode = decoded.code;
    err.seatalkMessage = decoded.message || '';
    throw err;
  }
  return decoded;
}

function seatalkToken_(cfg) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('seatalk_app_access_token');
  if (cached) {
    return cached;
  }

  const response = UrlFetchApp.fetch(cfg.SEATALK_API_BASE + '/auth/app_access_token', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      app_id: cfg.SEATALK_APP_ID,
      app_secret: cfg.SEATALK_APP_SECRET,
    }),
    muteHttpExceptions: true,
  });

  assertOk_(response, 'SeaTalk app access token');
  const decoded = JSON.parse(response.getContentText() || '{}');
  if (decoded.code !== 0 || !decoded.app_access_token) {
    throw new Error('SeaTalk token failed: ' + response.getContentText());
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttl = decoded.expire ? Math.max(60, Math.min(21600, Number(decoded.expire) - nowSeconds - 120)) : 5400;
  cache.put('seatalk_app_access_token', decoded.app_access_token, ttl);
  return decoded.app_access_token;
}

function testPdfToPngServiceHealth() {
  const cfg = loadConfig_();
  if (!cfg.PDF_TO_PNG_SERVICE_URL) {
    throw new Error('PDF_TO_PNG_SERVICE_URL is not configured');
  }

  const healthUrl = cfg.PDF_TO_PNG_SERVICE_URL.replace(/\/convert\/pdf-to-png$/, '/healthz');
  const response = UrlFetchApp.fetch(healthUrl, {
    method: 'get',
    muteHttpExceptions: true,
  });

  assertOk_(response, 'PDF to PNG health check');
  console.log(response.getContentText());
  return response.getContentText();
}

function assertOk_(response, label) {
  const status = response.getResponseCode();
  if (status >= 300) {
    throw new Error(label + ' HTTP ' + status + ': ' + response.getContentText());
  }
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function textResponse_(text) {
  return ContentService
    .createTextOutput(String(text || ''))
    .setMimeType(ContentService.MimeType.TEXT);
}

function parseBool_(value) {
  return String(value).toLowerCase() === 'true';
}

function normalizeBase64_(value) {
  return String(value || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
}

function normalizeConverterUrl_(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  if (!url) {
    return '';
  }
  if (/\/convert\/pdf-to-png$/.test(url)) {
    return url;
  }
  return url + '/convert/pdf-to-png';
}

function extractChallenge_(event) {
  return event.challenge ||
    (event.event && event.event.challenge) ||
    (event.data && event.data.challenge) ||
    '';
}
