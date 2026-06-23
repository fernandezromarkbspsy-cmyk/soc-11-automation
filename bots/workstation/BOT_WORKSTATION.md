# soc5-workstation Bot

Status: ready.

Apps Script source:

```text
bots/workstation/apps-script/
```

This bot sends every three hours daily using an Apps Script time trigger. Each run sends one SeaTalk interactive message card.

Card title:

```text
SOC 5 Workstation Compliance as of <h:mm AM/PM MMM-dd>
```

Example:

```text
SOC 5 Workstation Compliance as of 11:25 AM May-15
```

Card description:

```text
**<ws-server!A1> Workstation** **NON-COMPLIANCE**
-
<ws-server!T1>
```

If `ws-server!T1` is empty or returns a spreadsheet error such as `#N/A`, the description is:

```text
**<ws-server!A1> Workstation** **100% COMPLIANCE**
```

Card image capture range:

```text
soc5-workstation!A1:J80
```

Report link button:

```text
https://docs.google.com/spreadsheets/d/1UX7Wxjlp1cED9S8dboj-mEDgoNOPixsevgjdQenJdv4/edit?gid=1098721836#gid=1098721836
```

Hidden, collapsed, and blank rows inside the capture range are excluded from the rendered image. The bot builds a temporary export sheet row-by-row from only the visible, nonblank source rows, exports that temporary range, then deletes the temporary sheet.

Required script properties:

```text
SEATALK_APP_ID=<workstation-seatalk-app-id>
SEATALK_APP_SECRET=<workstation-seatalk-app-secret>
GOOGLE_SPREADSHEET_ID=1UX7Wxjlp1cED9S8dboj-mEDgoNOPixsevgjdQenJdv4
GOOGLE_GROUP_IDS_RANGE=bot_config!A2:A
GOOGLE_CAPTURE_RANGE=soc5-workstation!A1:J80
GOOGLE_NON_COMPLIANT_RANGE_1=ws-server!A1
GOOGLE_NON_COMPLIANT_RANGE_2=ws-server!T1
    REPORT_SHEET_URL=https://docs.google.com/spreadsheets/d/1UX7Wxjlp1cED9S8dboj-mEDgoNOPixsevgjdQenJdv4/edit?gid=1098721836#gid=1098721836
REPORT_EXCLUDE_BLANK_CAPTURE_ROWS=true
BOT_EXPECTED_SEND_INTERVAL_MINUTES=180
PDF_TO_PNG_SERVICE_URL=https://<azure-fqdn>/convert/pdf-to-png
PDF_TO_PNG_SERVICE_TOKEN=choose-a-long-random-secret
```

Setup flow:

1. Create a new Apps Script project for `soc5-workstation`.
2. Paste `bots/workstation/apps-script/Code.gs` and `appsscript.json`.
3. Add the shared `BotLogs.gs` file if you want send logging.
4. Set the required Script Properties.
5. Run `testPdfToPngServiceHealth`.
6. Run `sendReportNow` for a manual test.
7. Run `installThreeHourlyTrigger` to start sending every three hours.
8. Run `checkWorkstationSetup`.
