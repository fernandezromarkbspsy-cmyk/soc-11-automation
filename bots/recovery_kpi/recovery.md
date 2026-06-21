# soc5-control-tower Bot

Status: ready.

Apps Script source:

```text
bots/control-tower/apps-script/
```

This bot sends every three hours daily using an Apps Script time trigger. Each run sends one SeaTalk interactive message card.

Card title:

```text
SOC 5 OTP Update as of <h:mm AM/PM MMM-dd>
```

Card description:

```text
OTP Last Run Time: <Internal_kpi!E1>
```

Card image capture range:

```text
Internal_kpi!G1:Y39
```

Watch range:

```text
Internal_kpi!S15:U30
```

Report link button:

```text
https://docs.google.com/spreadsheets/d/1fz0N-8-BWs_6ub4UzfKhBdLIjlRpwc94p4DJHNB6SvU/edit?gid=1887496356#gid=1887496356
```

Required script properties:

```text
SEATALK_APP_ID=<control-tower-seatalk-app-id>
SEATALK_APP_SECRET=<control-tower-seatalk-app-secret>
GOOGLE_SPREADSHEET_ID=1fz0N-8-BWs_6ub4UzfKhBdLIjlRpwc94p4DJHNB6SvU
GOOGLE_GROUP_IDS_RANGE=bot_config!A2:A
GOOGLE_CAPTURE_RANGE=Internal_kpi!G1:Y39
GOOGLE_WATCH_RANGE=Internal_kpi!S15:U30
GOOGLE_OTP_LAST_RUN_RANGE=Internal_kpi!E1
REPORT_SHEET_URL=https://docs.google.com/spreadsheets/d/1fz0N-8-BWs_6ub4UzfKhBdLIjlRpwc94p4DJHNB6SvU/edit?gid=1887496356#gid=1887496356
BOT_EXPECTED_SEND_INTERVAL_MINUTES=180
PDF_TO_PNG_SERVICE_URL=https://<azure-fqdn>/convert/pdf-to-png
PDF_TO_PNG_SERVICE_TOKEN=choose-a-long-random-secret
```

Setup flow:

1. Create a new Apps Script project for `soc5-control-tower`.
2. Paste `bots/control-tower/apps-script/Code.gs` and `appsscript.json`.
3. Add the shared `BotLogs.gs` file if you want send logging.
4. Set the required Script Properties.
5. Run `testPdfToPngServiceHealth`.
6. Run `sendReportNow` for a manual test.
7. Run `installThreeHourlyTrigger` to start sending every three hours.
8. Run `checkControlTowerSetup`.

The script also includes `initializeControlTowerWatchSnapshot`, `clearControlTowerWatchSnapshot`, and `pollControlTowerWatchRange` helpers for snapshot-based watch range checks.