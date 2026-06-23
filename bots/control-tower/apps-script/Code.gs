/**
 * Google Apps Script implementation for the soc5-control-tower SeaTalk bot.
 *
 * Configure values in Project Settings > Script properties, then run
 * installThreeHourlyTrigger() once from the Apps Script editor.
 */

const DEFAULTS = {
  BOT_NAME: 'soc5-control-tower',
  TIME_ZONE: 'Asia/Manila',
  SEATALK_API_BASE: 'https://openapi.seatalk.io',
  SEATALK_GROUP_ID: '',
  SEATALK_EXTRA_GROUP_IDS: '',
  SEATALK_WELCOME_ON_ADD: 'false',
  GOOGLE_SPREADSHEET_ID: '1fz0N-8-BWs_6ub4UzfKhBdLIjlRpwc94p4DJHNB6SvU',
  GOOGLE_GROUP_IDS_RANGE: 'bot_config!A2:A',
  GOOGLE_CAPTURE_RANGE: 'Internal_kpi!G1:Y39',
  GOOGLE_WATCH_RANGE: 'Internal_kpi!S15:U30',
  GOOGLE_OTP_LAST_RUN_RANGE: 'Internal_kpi!E1',
  GOOGLE_SHEET_GID: '',
  GOOGLE_EXPORT_LANDSCAPE: 'true',
  REPORT_TITLE_PREFIX: 'SOC 5 OTP Update as of',
  REPORT_TIMESTAMP_FORMAT: 'h:mm a MMM-dd',
  REPORT_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1fz0N-8-BWs_6ub4UzfKhBdLIjlRpwc94p4DJHNB6SvU/edit?gid=1887496356#gid=1887496356',
  REPORT_SEND_IMAGE: 'true',
  REPORT_REQUIRE_IMAGE: 'true',
  PDF_TO_PNG_SERVICE_URL: '',
  PDF_TO_PNG_SERVICE_TOKEN: '',
  BOT_PDF_DPI: '220',
  BOT_IMAGE_RESIZE_WIDTH: '2200',
  BOT_IMAGE_BORDER_PX: '20',
  SEATALK_MAX_BASE64_BYTES: String(5 * 1024 * 1024),
  WATCH_SNAPSHOT_PROPERTY: 'control_tower_watch_range_snapshot',
  BOT_EXPECTED_SEND_INTERVAL_MINUTES: '180',
  BOT_LOGS_SHEET_NAME: 'bot_logs',
  BOT_DELAY_GRACE_MINUTES: '5',
};

function sendControlTowerReport() {
  const cfg = loadConfig_();
  const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
  return sendControlTowerReportWithConfig_(cfg, spreadsheet);
}

function sendReportNow() {
  return sendControlTowerReport();
}

function installThreeHourlyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return trigger.getHandlerFunction() === 'sendControlTowerReport';
    })
    .forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger('sendControlTowerReport')
    .timeBased()
    .inTimezone(DEFAULTS.TIME_ZONE)
    .everyHours(3)
    .create();

  console.log('Installed three-hour trigger for sendControlTowerReport.');
}

function installPollingTrigger() {
  return installThreeHourlyTrigger();
}

function pollControlTowerWatchRange() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.warn('Skipping control tower poll because another poll is still running.');
    return { sent: false, changed: false, reason: 'lock_unavailable' };
  }

  try {
    const cfg = loadConfig_();
    const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
    const snapshot = snapshotRange_(spreadsheet, cfg.GOOGLE_WATCH_RANGE);
    const props = PropertiesService.getScriptProperties();
    const previousSnapshot = props.getProperty(cfg.WATCH_SNAPSHOT_PROPERTY);

    if (!previousSnapshot) {
      props.setProperty(cfg.WATCH_SNAPSHOT_PROPERTY, snapshot);
      console.log('Initialized control tower watch snapshot for ' + cfg.GOOGLE_WATCH_RANGE + '. No report sent.');
      return { sent: false, changed: false, reason: 'initialized' };
    }

    if (previousSnapshot === snapshot) {
      console.log('No control tower watch range change detected in ' + cfg.GOOGLE_WATCH_RANGE + '.');
      return { sent: false, changed: false, reason: 'unchanged' };
    }

    props.setProperty(cfg.WATCH_SNAPSHOT_PROPERTY, snapshot);
    const result = sendControlTowerReportWithConfig_(cfg, spreadsheet);
    return { sent: true, changed: true, result: result };
  } finally {
    lock.releaseLock();
  }
}

function initializeControlTowerWatchSnapshot() {
  const cfg = loadConfig_();
  const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
  const snapshot = snapshotRange_(spreadsheet, cfg.GOOGLE_WATCH_RANGE);
  PropertiesService.getScriptProperties().setProperty(cfg.WATCH_SNAPSHOT_PROPERTY, snapshot);
  console.log('Initialized control tower watch snapshot for ' + cfg.GOOGLE_WATCH_RANGE + '.');
  return { watchRange: cfg.GOOGLE_WATCH_RANGE, initialized: true };
}

function clearControlTowerWatchSnapshot() {
  const cfg = loadConfig_();
  PropertiesService.getScriptProperties().deleteProperty(cfg.WATCH_SNAPSHOT_PROPERTY);
  console.log('Cleared control tower watch snapshot.');
  return { cleared: true };
}

function checkControlTowerSetup() {
  const cfg = loadConfig_();
  const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
  const groupIds = readGroupIds_(spreadsheet, cfg);
  const sendTriggers = ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return trigger.getHandlerFunction() === 'sendControlTowerReport';
    });
  const props = PropertiesService.getScriptProperties();
  const summary = {
    botName: cfg.BOT_NAME,
    threeHourlyTriggerInstalled: sendTriggers.length > 0,
    sendControlTowerReportTriggers: sendTriggers.length,
    watchSnapshotInitialized: Boolean(props.getProperty(cfg.WATCH_SNAPSHOT_PROPERTY)),
    groupIdCount: groupIds.length,
    pdfToPngConfigured: Boolean(cfg.PDF_TO_PNG_SERVICE_URL),
    imageRequired: cfg.REPORT_SEND_IMAGE && cfg.REPORT_REQUIRE_IMAGE,
    spreadsheetId: cfg.GOOGLE_SPREADSHEET_ID,
    captureRange: cfg.GOOGLE_CAPTURE_RANGE,
    watchRange: cfg.GOOGLE_WATCH_RANGE,
    otpLastRunRange: cfg.GOOGLE_OTP_LAST_RUN_RANGE,
    reportSheetUrl: cfg.REPORT_SHEET_URL,
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

function sendControlTowerReportWithConfig_(cfg, spreadsheet) {
  const groupIds = readGroupIds_(spreadsheet, cfg);
  if (groupIds.length === 0) {
    throw new Error('No SeaTalk group IDs found in ' + cfg.GOOGLE_GROUP_IDS_RANGE);
  }

  const elements = buildControlTowerCardElements_(cfg, spreadsheet);
  const result = sendToGroups_(cfg, spreadsheet, groupIds, elements);
  if (result.sent === 0) {
    throw new Error('Control tower report was not sent to any SeaTalk group. ' + result.errors.join(' | '));
  }
  if (result.errors.length > 0) {
    console.warn('Control tower report sent to ' + result.sent + ' group(s), with skipped/failed groups: ' + result.errors.join(' | '));
  }

  return result;
}

function buildControlTowerCardElements_(cfg, spreadsheet) {
  const elements = [
    titleElement_(buildControlTowerTitle_(cfg)),
    descriptionElement_(buildControlTowerDescription_(cfg, spreadsheet)),
  ];
  const imageBase64 = buildControlTowerImage_(cfg, spreadsheet);
  if (imageBase64) {
    elements.push(imageElement_(imageBase64));
  }
  if (cfg.REPORT_SHEET_URL) {
    elements.push(redirectButtonElement_('View Report Link', cfg.REPORT_SHEET_URL));
  }
  return elements;
}

function buildControlTowerTitle_(cfg) {
  const timestamp = Utilities.formatDate(new Date(), cfg.TIME_ZONE, cfg.REPORT_TIMESTAMP_FORMAT);
  return cfg.REPORT_TITLE_PREFIX + ' ' + timestamp;
}

function buildControlTowerDescription_(cfg, spreadsheet) {
  const otpLastRunTime = readRangeDisplayValue_(spreadsheet, cfg.GOOGLE_OTP_LAST_RUN_RANGE);
  return 'OTP Last Run Time: ' + otpLastRunTime;
}

function buildControlTowerImage_(cfg, spreadsheet) {
  if (!cfg.REPORT_SEND_IMAGE) {
    return '';
  }
  const pdfBlob = exportReportPdfForRange_(spreadsheet, cfg, cfg.GOOGLE_CAPTURE_RANGE);
  return tryConvertPdfToPng_(cfg, pdfBlob);
}

function snapshotRange_(spreadsheet, rangeName) {
  const values = spreadsheet.getRange(rangeName).getDisplayValues();
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(values),
    Utilities.Charset.UTF_8
  );
  return digest.map(function(byte) {
    const value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function exportReportPdfForRange_(spreadsheet, cfg, captureRange) {
  const parsed = splitSheetRange_(captureRange);
  const sheet = parsed.sheetName ? spreadsheet.getSheetByName(parsed.sheetName) : spreadsheet.getSheets()[0];

  if (!sheet) {
    throw new Error('Sheet not found for range ' + captureRange);
  }

  const gid = cfg.GOOGLE_SHEET_GID || String(sheet.getSheetId());
  const params = {
    format: 'pdf',
    gid: gid,
    range: parsed.cellRange,
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

  assertOk_(response, 'Export Google Sheet PDF for ' + captureRange);
  return response.getBlob().setName('control-tower-report.pdf');
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
  return String(spreadsheet.getRange(rangeName).getDisplayValue() || '').trim();
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

function splitSheetRange_(input) {
  const parts = String(input || '').split('!');
  if (parts.length === 1) {
    return { sheetName: '', cellRange: stripQuotes_(parts[0]) };
  }
  return { sheetName: stripQuotes_(parts[0]), cellRange: stripQuotes_(parts.slice(1).join('!')) };
}

function stripQuotes_(value) {
  return String(value || '').replace(/^'/, '').replace(/'$/, '');
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
