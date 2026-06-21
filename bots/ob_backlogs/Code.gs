  /**
  * Google Apps Script implementation for the backlogs SeaTalk bot.
  *
  * Configure values in Project Settings > Script properties, then run
  * installPollingTrigger() once from the Apps Script editor.
  */

  const DEFAULTS = {
    BOT_NAME: 'backlogs',
    TIME_ZONE: 'Asia/Manila',
    SEATALK_API_BASE: 'https://openapi.seatalk.io',
    SEATALK_BOTH_IMAGES_GROUP_IDS: 'Njk3MDE2ODY2Mzc2,NDk4ODM1MTY4OTY3',
    SEATALK_IMAGE1_ONLY_GROUP_IDS: 'NTQ1OTU4MzEzMzM0',
    SEATALK_IIS_ONLY_GROUP_IDS: 'OTY2NjY4OTMzNzY4',
    SEATALK_WELCOME_ON_ADD: 'false',
    GOOGLE_SPREADSHEET_ID: '',
    GOOGLE_GROUP_IDS_RANGE: 'bot_config!A2:A',
    GOOGLE_WATCH_RANGE: 'backlogs!E8',
    GOOGLE_CAPTURE_RANGE_1: 'backlogs!B2:Q62',
    GOOGLE_CAPTURE_RANGE_2: 'backlogs-iis!B2:J43',
    GOOGLE_TOP_REGION_NAME_RANGE_1: 'backlogs!S6',
    GOOGLE_TOP_REGION_VALUE_RANGE_1: 'backlogs!U6',
    GOOGLE_TOP_REGION_NAME_RANGE_2: 'backlogs!S7',
    GOOGLE_TOP_REGION_VALUE_RANGE_2: 'backlogs!U7',
    GOOGLE_TOP_REGION_NAME_RANGE_3: 'backlogs!S8',
    GOOGLE_TOP_REGION_VALUE_RANGE_3: 'backlogs!U8',
    GOOGLE_IIS_TOP_HUB_NAME_RANGE_1: 'backlogs-iis!L5',
    GOOGLE_IIS_TOP_HUB_VALUE_RANGE_1: 'backlogs-iis!P5',
    GOOGLE_IIS_TOP_HUB_NAME_RANGE_2: 'backlogs-iis!L6',
    GOOGLE_IIS_TOP_HUB_VALUE_RANGE_2: 'backlogs-iis!P6',
    GOOGLE_IIS_TOP_HUB_NAME_RANGE_3: 'backlogs-iis!L7',
    GOOGLE_IIS_TOP_HUB_VALUE_RANGE_3: 'backlogs-iis!P7',
    GOOGLE_EXPORT_LANDSCAPE: 'true',
    REPORT_TITLE_PREFIX: 'OB Pending for Dispatch as of',
    REPORT_TIMESTAMP_FORMAT: 'h:mm a MMM-dd',
    REPORT_SEND_IMAGE: 'true',
    REPORT_REQUIRE_IMAGE: 'true',
    REPORT_SETTLE_DELAY_SECONDS: '15',
    REPORT_FIT_CAPTURE_RANGE_1_TO_PAGE: 'true',
    REPORT_FIT_CAPTURE_RANGE_2_TO_PAGE: 'true',
    REPORT_CLEAN_CAPTURE_RANGE_1: 'false',
    REPORT_EXCLUDE_BLANK_CAPTURE_ROWS_1: 'true',
    SEATALK_TEST_GROUP_ID: 'NjkwNjYwNzkyMjI3',
    PDF_TO_PNG_SERVICE_URL: '',
    PDF_TO_PNG_SERVICE_TOKEN: '',
    BOT_PDF_DPI: '220',
    BOT_IMAGE_RESIZE_WIDTH: '2200',
    BOT_IMAGE_BORDER_PX: '20',
    SEATALK_MAX_BASE64_BYTES: String(5 * 1024 * 1024),
    WATCH_SNAPSHOT_PROPERTY: 'backlogs_watch_range_snapshot',
    BOT_LOGS_SHEET_NAME: 'bot_logs',
    BOT_DELAY_GRACE_MINUTES: '5',
  };

  function pollBacklogsWatchRange() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      console.warn('Skipping backlogs poll because another poll is still running.');
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
        console.log('Initialized backlogs watch snapshot for ' + cfg.GOOGLE_WATCH_RANGE + '. No report sent.');
        return { sent: false, changed: false, reason: 'initialized' };
      }

      if (previousSnapshot === snapshot) {
        console.log('No backlogs watch range change detected in ' + cfg.GOOGLE_WATCH_RANGE + '.');
        return { sent: false, changed: false, reason: 'unchanged' };
      }

      if (cfg.REPORT_SETTLE_DELAY_SECONDS > 0) {
        Utilities.sleep(cfg.REPORT_SETTLE_DELAY_SECONDS * 1000);
        SpreadsheetApp.flush();
      }

      const settledSnapshot = snapshotRange_(spreadsheet, cfg.GOOGLE_WATCH_RANGE);
      props.setProperty(cfg.WATCH_SNAPSHOT_PROPERTY, settledSnapshot);
      if (isWatchRangeZero_(spreadsheet, cfg.GOOGLE_WATCH_RANGE)) {
        console.log('Backlogs watch range is 0 in ' + cfg.GOOGLE_WATCH_RANGE + '. No report sent.');
        return { sent: false, changed: true, reason: 'watch_range_zero' };
      }
      const result = sendBacklogsReportWithConfig_(cfg, spreadsheet);
      return { sent: true, changed: true, result: result };
    } finally {
      lock.releaseLock();
    }
  }

  function sendBacklogsReport() {
    const cfg = loadConfig_();
    const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
    return sendBacklogsReportWithConfig_(cfg, spreadsheet);
  }

  function sendReportNow() {
    return sendBacklogsReport();
  }

  function sendTestReportToBacklogsGroupNow() {
    const cfg = loadConfig_();
    const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
    const report = buildBacklogsReport_(cfg, spreadsheet);
    const result = {
      sent: 0,
      errors: [],
    };

    sendReportRoute_(cfg, spreadsheet, {
      groupId: cfg.SEATALK_TEST_GROUP_ID,
      text: report.text,
      images: [report.image1, report.image2],
      routeName: 'test',
    }, result);
    if (result.sent === 0) {
      throw new Error('Backlogs test report was not sent. ' + result.errors.join(' | '));
    }
    if (result.errors.length > 0) {
      console.warn('Backlogs test report sent, with skipped/failed groups: ' + result.errors.join(' | '));
    }
    return result;
  }

  function initializeBacklogsWatchSnapshot() {
    const cfg = loadConfig_();
    const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
    const snapshot = snapshotRange_(spreadsheet, cfg.GOOGLE_WATCH_RANGE);
    PropertiesService.getScriptProperties().setProperty(cfg.WATCH_SNAPSHOT_PROPERTY, snapshot);
    console.log('Initialized backlogs watch snapshot for ' + cfg.GOOGLE_WATCH_RANGE + '.');
    return { watchRange: cfg.GOOGLE_WATCH_RANGE, initialized: true };
  }

  function clearBacklogsWatchSnapshot() {
    const cfg = loadConfig_();
    PropertiesService.getScriptProperties().deleteProperty(cfg.WATCH_SNAPSHOT_PROPERTY);
    console.log('Cleared backlogs watch snapshot. The next poll will initialize without sending.');
    return { cleared: true };
  }

  function installPollingTrigger() {
    ScriptApp.getProjectTriggers()
      .filter(function(trigger) {
        return trigger.getHandlerFunction() === 'pollBacklogsWatchRange';
      })
      .forEach(function(trigger) {
        ScriptApp.deleteTrigger(trigger);
      });

    ScriptApp.newTrigger('pollBacklogsWatchRange')
      .timeBased()
      .inTimezone(DEFAULTS.TIME_ZONE)
      .everyMinutes(5)
      .create();

    console.log('Installed five-minute polling trigger for pollBacklogsWatchRange.');
  }

  function checkBacklogsSetup() {
    const cfg = loadConfig_();
    const spreadsheet = SpreadsheetApp.openById(cfg.GOOGLE_SPREADSHEET_ID);
    const groupIds = readAllRouteGroupIds_(spreadsheet, cfg);
    const pollTriggers = ScriptApp.getProjectTriggers()
      .filter(function(trigger) {
        return trigger.getHandlerFunction() === 'pollBacklogsWatchRange';
      });
    const props = PropertiesService.getScriptProperties();
    const summary = {
      botName: cfg.BOT_NAME,
      pollingTriggerInstalled: pollTriggers.length > 0,
      pollBacklogsWatchRangeTriggers: pollTriggers.length,
      watchSnapshotInitialized: Boolean(props.getProperty(cfg.WATCH_SNAPSHOT_PROPERTY)),
      groupIdCount: groupIds.length,
      pdfToPngConfigured: Boolean(cfg.PDF_TO_PNG_SERVICE_URL),
      imageRequired: cfg.REPORT_SEND_IMAGE && cfg.REPORT_REQUIRE_IMAGE,
      spreadsheetId: cfg.GOOGLE_SPREADSHEET_ID,
      watchRange: cfg.GOOGLE_WATCH_RANGE,
      settleDelaySeconds: cfg.REPORT_SETTLE_DELAY_SECONDS,
      captureRange1: cfg.GOOGLE_CAPTURE_RANGE_1,
      captureRange2: cfg.GOOGLE_CAPTURE_RANGE_2,
      fitCaptureRange1ToPage: cfg.REPORT_FIT_CAPTURE_RANGE_1_TO_PAGE,
      cleanCaptureRange1: cfg.REPORT_CLEAN_CAPTURE_RANGE_1,
      excludeBlankCaptureRows1: cfg.REPORT_EXCLUDE_BLANK_CAPTURE_ROWS_1,
      testGroupId: cfg.SEATALK_TEST_GROUP_ID,
      groupIdsRange: cfg.GOOGLE_GROUP_IDS_RANGE,
      bothImagesGroupIds: splitList_(cfg.SEATALK_BOTH_IMAGES_GROUP_IDS),
      image1OnlyGroupIds: splitList_(cfg.SEATALK_IMAGE1_ONLY_GROUP_IDS),
      iisOnlyGroupIds: splitList_(cfg.SEATALK_IIS_ONLY_GROUP_IDS),
    };

    console.log(JSON.stringify(summary, null, 2));

    if (pollTriggers.length === 0) {
      throw new Error('No polling trigger found. Run installPollingTrigger once from the Apps Script editor.');
    }
    if (groupIds.length === 0) {
      throw new Error('No SeaTalk group IDs found. Add a group ID to ' + cfg.GOOGLE_GROUP_IDS_RANGE + ' or configure a route-specific extra group list.');
    }
    if (summary.imageRequired && !cfg.PDF_TO_PNG_SERVICE_URL) {
      throw new Error('Report images are required, but PDF_TO_PNG_SERVICE_URL is not configured.');
    }

    return summary;
  }

  function sendBacklogsReportWithConfig_(cfg, spreadsheet) {
    const routes = readDeliveryRoutes_(spreadsheet, cfg);
    if (routes.length === 0) {
      throw new Error('No SeaTalk group IDs found in ' + cfg.GOOGLE_GROUP_IDS_RANGE);
    }

    const report = buildBacklogsReport_(cfg, spreadsheet);
    const result = sendToGroups_(cfg, spreadsheet, routes, report);
    if (result.sent === 0) {
      throw new Error('Backlogs report was not sent to any SeaTalk group. ' + result.errors.join(' | '));
    }
    if (result.errors.length > 0) {
      console.warn('Backlogs report sent to ' + result.sent + ' group(s), with skipped/failed groups: ' + result.errors.join(' | '));
    }

    return result;
  }

  function buildBacklogsReport_(cfg, spreadsheet) {
    return {
      text: buildBacklogsText_(cfg, spreadsheet),
      iisText: buildBacklogsIisText_(cfg, spreadsheet),
      image1: buildBacklogsImage1_(cfg, spreadsheet),
      image2: buildBacklogsImageForRange_(cfg, spreadsheet, cfg.GOOGLE_CAPTURE_RANGE_2, 'backlogs-report-2.pdf', cfg.REPORT_FIT_CAPTURE_RANGE_2_TO_PAGE),
    };
  }

  function buildBacklogsText_(cfg, spreadsheet) {
    const timestamp = Utilities.formatDate(new Date(), cfg.TIME_ZONE, cfg.REPORT_TIMESTAMP_FORMAT);
    const contributors = [
      readRegionLine_(spreadsheet, 1, cfg.GOOGLE_TOP_REGION_NAME_RANGE_1, cfg.GOOGLE_TOP_REGION_VALUE_RANGE_1),
      readRegionLine_(spreadsheet, 2, cfg.GOOGLE_TOP_REGION_NAME_RANGE_2, cfg.GOOGLE_TOP_REGION_VALUE_RANGE_2),
      readRegionLine_(spreadsheet, 3, cfg.GOOGLE_TOP_REGION_NAME_RANGE_3, cfg.GOOGLE_TOP_REGION_VALUE_RANGE_3),
    ];

    return [
      '**' + cfg.REPORT_TITLE_PREFIX + ' ' + timestamp + '**',
      '---------------------------------------',
      '**Backlogs:** ' + readRangeDisplayValue_(spreadsheet, cfg.GOOGLE_WATCH_RANGE),
      '**Contributor:**',
      contributors[0],
      contributors[1],
      contributors[2],
      '---------------------------------------',
    ].join('\n');
  }

  function buildBacklogsIisText_(cfg, spreadsheet) {
    const timestamp = Utilities.formatDate(new Date(), cfg.TIME_ZONE, cfg.REPORT_TIMESTAMP_FORMAT);
    const hubs = [
      readRegionLine_(spreadsheet, 1, cfg.GOOGLE_IIS_TOP_HUB_NAME_RANGE_1, cfg.GOOGLE_IIS_TOP_HUB_VALUE_RANGE_1),
      readRegionLine_(spreadsheet, 2, cfg.GOOGLE_IIS_TOP_HUB_NAME_RANGE_2, cfg.GOOGLE_IIS_TOP_HUB_VALUE_RANGE_2),
      readRegionLine_(spreadsheet, 3, cfg.GOOGLE_IIS_TOP_HUB_NAME_RANGE_3, cfg.GOOGLE_IIS_TOP_HUB_VALUE_RANGE_3),
    ];

    return [
      '**SOL IIS Pending for Dispatch as of ' + timestamp + '**',
      '------------------------------------',
      '**Top Hubs:**',
      hubs[0],
      hubs[1],
      hubs[2],
      '',
    ].join('\n');
  }

  function readRegionLine_(spreadsheet, rank, nameRange, valueRange) {
    const name = readRangeDisplayValue_(spreadsheet, nameRange);
    const value = readRangeDisplayValue_(spreadsheet, valueRange);
    return rank + '. ' + name + ' - ' + value;
  }

  function buildBacklogsImageForRange_(cfg, spreadsheet, captureRange, pdfName, fitToPage) {
    if (!cfg.REPORT_SEND_IMAGE) {
      return '';
    }
    const pdfBlob = exportReportPdfForRange_(spreadsheet, cfg, captureRange, pdfName, fitToPage);
    return tryConvertPdfToPng_(cfg, pdfBlob);
  }

  function buildBacklogsImage1_(cfg, spreadsheet) {
    if (!cfg.REPORT_SEND_IMAGE) {
      return '';
    }
    const pdfBlob = cfg.REPORT_CLEAN_CAPTURE_RANGE_1
      ? exportCleanCaptureRangePdf_(spreadsheet, cfg, cfg.GOOGLE_CAPTURE_RANGE_1, 'backlogs-report-1.pdf', cfg.REPORT_FIT_CAPTURE_RANGE_1_TO_PAGE)
      : exportReportPdfForRange_(spreadsheet, cfg, cfg.GOOGLE_CAPTURE_RANGE_1, 'backlogs-report-1.pdf', cfg.REPORT_FIT_CAPTURE_RANGE_1_TO_PAGE);
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

  function isWatchRangeZero_(spreadsheet, rangeName) {
    const displayValue = readRangeDisplayValue_(spreadsheet, rangeName);
    const numericValue = Number(displayValue.replace(/,/g, ''));
    return displayValue !== '' && !isNaN(numericValue) && numericValue === 0;
  }

  function exportReportPdfForRange_(spreadsheet, cfg, captureRange, pdfName, fitToPage) {
    const parsed = splitSheetRange_(captureRange);
    const sheet = parsed.sheetName ? spreadsheet.getSheetByName(parsed.sheetName) : spreadsheet.getSheets()[0];

    if (!sheet) {
      throw new Error('Sheet not found for range ' + captureRange);
    }

    const params = {
      format: 'pdf',
      gid: String(sheet.getSheetId()),
      range: parsed.cellRange,
      size: '7',
      portrait: String(!cfg.GOOGLE_EXPORT_LANDSCAPE),
      sheetnames: 'false',
      printtitle: 'false',
      pagenumbers: 'false',
      gridlines: 'false',
      fzr: 'false',
    };
    if (fitToPage) {
      params.scale = '4';
    } else {
      params.fitw = 'true';
    }
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
    return response.getBlob().setName(pdfName);
  }

  function exportCleanCaptureRangePdf_(spreadsheet, cfg, captureRange, pdfName, fitToPage) {
    const sourceRange = spreadsheet.getRange(captureRange);
    const tempSheet = spreadsheet.insertSheet('__backlogs_export_' + Utilities.getUuid().slice(0, 8));

    try {
      const exportRange = buildCleanExportRange_(tempSheet, sourceRange, cfg);
      SpreadsheetApp.flush();
      return exportSheetPdfForRange_(
        spreadsheet,
        cfg,
        String(tempSheet.getSheetId()),
        exportRange.getA1Notation(),
        pdfName,
        fitToPage
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
      tempSheet.setRowHeight(targetOffset + 1, Math.max(21, sourceSheet.getRowHeight(startRow + sourceOffset)));
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
    return cfg.REPORT_EXCLUDE_BLANK_CAPTURE_ROWS_1 && isBlankDisplayRow_(displayRow);
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

  function exportSheetPdfForRange_(spreadsheet, cfg, gid, cellRange, pdfName, fitToPage) {
    const params = {
      format: 'pdf',
      gid: gid,
      range: cellRange,
      size: '7',
      portrait: String(!cfg.GOOGLE_EXPORT_LANDSCAPE),
      sheetnames: 'false',
      printtitle: 'false',
      pagenumbers: 'false',
      gridlines: 'false',
      fzr: 'false',
    };
    if (fitToPage) {
      params.scale = '4';
    } else {
      params.fitw = 'true';
    }
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
    return response.getBlob().setName(pdfName);
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

  function sendToGroups_(cfg, spreadsheet, routes, report) {
    const result = {
      sent: 0,
      errors: [],
    };

    routes.forEach(function(route) {
      sendReportRoute_(cfg, spreadsheet, {
        groupId: route.groupId,
        text: route.textKey === 'iis' ? report.iisText : report.text,
        images: route.imageKeys.map(function(imageKey) {
          return report[imageKey];
        }),
        routeName: route.routeName,
      }, result);
    });

    return result;
  }

  function sendReportRoute_(cfg, spreadsheet, route, result) {
    const groupId = route.groupId;
    const routeName = route.routeName;

    try {
      sendText_(cfg, groupId, route.text, true);
      route.images.forEach(function(imageBase64) {
        if (imageBase64) {
          sendImage_(cfg, groupId, imageBase64);
        }
      });
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
        result.errors.push(routeName + ' ' + groupId + ': bot is not a member of this group chat');
        console.warn('Skipping SeaTalk group ' + groupId + ' for ' + routeName + ': bot is not a member of this group chat. Add the bot to the group or remove this group ID from ' + cfg.GOOGLE_GROUP_IDS_RANGE + '.');
        return;
      }
      result.errors.push(routeName + ' ' + groupId + ': ' + err.message);
      console.error('Failed sending ' + routeName + ' to SeaTalk group ' + groupId + ': ' + err.message);
    }
  }

  function sendText_(cfg, groupId, content, atAll) {
    const textPayload = {
      format: 1,
      content: content,
    };
    if (atAll) {
      textPayload.at_all = true;
    }

    return postSeatalkJson_(cfg, '/messaging/v2/group_chat', {
      group_id: groupId,
      message: {
        tag: 'text',
        text: textPayload,
      },
    });
  }

  function sendImage_(cfg, groupId, contentBase64) {
    return postSeatalkJson_(cfg, '/messaging/v2/group_chat', {
      group_id: groupId,
      message: {
        tag: 'image',
        image: {
          content: contentBase64,
        },
      },
    });
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
    sendText_(cfg, groupId, cfg.BOT_NAME + ' report bot is connected.');
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
    cfg.REPORT_SETTLE_DELAY_SECONDS = Number(cfg.REPORT_SETTLE_DELAY_SECONDS);
    cfg.REPORT_FIT_CAPTURE_RANGE_1_TO_PAGE = parseBool_(cfg.REPORT_FIT_CAPTURE_RANGE_1_TO_PAGE);
    cfg.REPORT_CLEAN_CAPTURE_RANGE_1 = parseBool_(cfg.REPORT_CLEAN_CAPTURE_RANGE_1);
    cfg.REPORT_EXCLUDE_BLANK_CAPTURE_ROWS_1 = parseBool_(cfg.REPORT_EXCLUDE_BLANK_CAPTURE_ROWS_1);
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

  function readAllRouteGroupIds_(spreadsheet, cfg) {
    return readDeliveryRoutes_(spreadsheet, cfg).map(function(route) {
      return route.groupId;
    });
  }

  function readDeliveryRoutes_(spreadsheet, cfg) {
    const routeByGroupId = {};

    readConfigGroupIds_(spreadsheet, cfg).forEach(function(groupId) {
      setDeliveryRoute_(routeByGroupId, groupId, 'default', ['image1', 'image2'], 'bot_config');
    });
    splitList_(cfg.SEATALK_BOTH_IMAGES_GROUP_IDS).forEach(function(groupId) {
      setDeliveryRoute_(routeByGroupId, groupId, 'default', ['image1', 'image2'], 'both-images');
    });
    splitList_(cfg.SEATALK_IMAGE1_ONLY_GROUP_IDS).forEach(function(groupId) {
      setDeliveryRoute_(routeByGroupId, groupId, 'default', ['image1'], 'image1-only');
    });
    splitList_(cfg.SEATALK_IIS_ONLY_GROUP_IDS).forEach(function(groupId) {
      setDeliveryRoute_(routeByGroupId, groupId, 'iis', ['image2'], 'iis-only');
    });

    return Object.keys(routeByGroupId).map(function(groupId) {
      return routeByGroupId[groupId];
    });
  }

  function setDeliveryRoute_(routeByGroupId, groupId, textKey, imageKeys, routeName) {
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) {
      return;
    }

    routeByGroupId[normalizedGroupId] = {
      groupId: normalizedGroupId,
      textKey: textKey,
      imageKeys: imageKeys,
      routeName: routeName,
    };
  }

  function readConfigGroupIds_(spreadsheet, cfg) {
    const values = spreadsheet.getRange(cfg.GOOGLE_GROUP_IDS_RANGE).getDisplayValues();
    const seen = {};
    const ids = [];

    values.forEach(function(row) {
      addGroupId_(row[0], seen, ids);
    });

    return ids;
  }

  function uniqueGroupIds_(values) {
    const seen = {};
    const ids = [];
    values.forEach(function(value) {
      addGroupId_(value, seen, ids);
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