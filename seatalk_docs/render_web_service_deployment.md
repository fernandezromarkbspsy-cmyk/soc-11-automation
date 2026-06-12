# Render Web Service Deployment Guide

This guide deploys the SeaTalk OTP hourly bot on Render as a Docker Web Service using the Render dashboard only.

Do not add or use `render.yaml` for this deployment. This repo should be deployed from the existing `Dockerfile` and configured through Render service settings, environment variables, and secret files.

## What Render Runs

The deployed service uses:

- [main.go](../main.go)
- [Dockerfile](../Dockerfile)
- `GET /healthz` for health checks
- the internal hourly scheduler controlled by `BOT_SEND_INTERVAL_MINUTES`
- the existing Google Sheets render flow using Poppler and ImageMagick

The bot sends two image cards each schedule slot:

- first card: `soc8_otp1_hourly!A1:AC31`
- second card: `soc8_otp2_hourly!A1:J32`, with FMS update from `soc8_otp2_hourly!I3`

## Render Free Limitation

Render Free web services spin down after 15 minutes without inbound traffic. A spun-down service does not keep the bot's internal scheduler running until traffic wakes it again.

For a reliable hourly bot, use a paid Render instance. If you use Free temporarily, configure an external uptime monitor to call `/healthz` every 5 to 10 minutes.

## Prerequisites

Before creating the service:

1. Push this repo to GitHub, GitLab, or Bitbucket.
2. Confirm secrets are not committed:

```text
.env
google-service-account.json
```

3. Confirm the Google service account has editor access to the spreadsheet.
4. Have the full contents of `google-service-account.json` ready for Render Secret Files.
5. Have the SeaTalk bot app credentials ready.

## Step 1: Create the Render Web Service

In the Render dashboard:

1. Click `New` > `Web Service`.
2. Select your Git provider.
3. Select this repository.
4. Use these settings:

```text
Environment: Docker
Branch: your deploy branch
Instance Type: Starter or Free
Root Directory: leave blank unless this repo is inside a monorepo
Dockerfile Path: ./Dockerfile
Docker Build Context Directory: .
```

Leave build and start commands blank. The `Dockerfile` already starts the app with:

```text
go run .
```

## Step 2: Configure Health Check

In the service settings, set:

```text
Health Check Path: /healthz
Auto-Deploy: On
```

Do not add `BOT_PORT`. Render provides the `PORT` environment variable automatically, and the app reads it.

## Step 3: Add Environment Variables

Open the Render service, go to `Environment`, and add:

```text
SHEET_ID=<your-google-sheet-id>
TAB_NAME=soc8_otp1_hourly
CAPTURE_RANGE=A1:AC31
SEATALK_APP_ID=<your-seatalk-bot-app-id>
SEATALK_APP_SECRET=<your-seatalk-bot-app-secret>
SEATALK_SIGNING_SECRET=<your-seatalk-callback-signing-secret>
SEATALK_GROUP_ID=<optional-seatalk-group-id>
REPORT_LINK=<your-google-sheet-report-link>
BOT_TIMEZONE=Asia/Manila
BOT_SEND_INTERVAL_MINUTES=60
BOT_REQUEST_TIMEOUT_SECONDS=30
BOT_PDF_DPI=220
BOT_IMAGE_BORDER_PX=20
BOT_IMAGE_RESIZE_WIDTH=2200
BOT_USE_ENV_PROXY=false
GOOGLE_SERVICE_ACCOUNT_FILE=/etc/secrets/google-service-account.json
```

Example first-card values:

```text
TAB_NAME=soc8_otp1_hourly
CAPTURE_RANGE=A1:AC31
```

The second image card is configured in code:

```text
Tab/range: soc8_otp2_hourly!A1:J32
Description value: soc8_otp2_hourly!I3
```

## Step 4: Add Secret File

In the Render service:

1. Go to `Environment`.
2. Under `Secret Files`, click `Add Secret File`.
3. Set filename:

```text
google-service-account.json
```

4. Paste the full JSON contents from your local service account file.

At runtime, Render exposes it here:

```text
/etc/secrets/google-service-account.json
```

That path must match:

```text
GOOGLE_SERVICE_ACCOUNT_FILE=/etc/secrets/google-service-account.json
```

## Step 5: Deploy

After saving the environment variables and secret file:

1. Trigger a deploy if Render does not start one automatically.
2. Wait for the Docker build and deploy to complete.
3. Open:

```text
https://<your-service>.onrender.com/healthz
```

Expected response shape:

```json
{
  "running": false,
  "last_run_started_at": null,
  "last_run_finished_at": null,
  "last_run_succeeded_at": null,
  "next_run_at": "...",
  "last_callback_received_at": null,
  "last_callback_event_type": null,
  "last_error": null,
  "capture_range": "A1:AC31",
  "image_cards": [
    {
      "title_prefix": "SOC 5 OTP Hourly as of",
      "tab_name": "soc8_otp1_hourly",
      "capture_range": "A1:AC31",
      "fms_update_cell": "AD1"
    },
    {
      "title_prefix": "OTP-2 Hourly Update as of",
      "tab_name": "soc8_otp2_hourly",
      "capture_range": "A1:J32",
      "fms_update_cell": "I3"
    }
  ],
  "send_interval_minutes": 60,
  "tab_name": "soc8_otp1_hourly",
  "seatalk_group_id_configured": false
}
```

## Step 6: Configure SeaTalk Callback

In SeaTalk Open Platform, set the bot event callback URL to:

```text
https://<your-service>.onrender.com/seatalk/callback
```

Use the exact Render hostname. Do not use `/healthz` as the callback URL.

The service also accepts these callback paths, but `/seatalk/callback` is the canonical path:

```text
/seatalk/callback/
/callback
/callback/
```

After callback verification succeeds, add the bot to the target group. If `SEATALK_GROUP_ID` is blank, the `bot_added_to_group_chat` callback appends the group ID to `botconfig!A2:A` and also keeps a local `.runtime/seatalk-group.json` fallback.

## Step 7: Keep Free Instance Awake

If using Render Free, configure an external uptime monitor to call:

```text
https://<your-service>.onrender.com/healthz
```

Use a 5-minute interval if available. A 10-minute interval is the maximum recommended interval for this bot.

See [uptimerobot_setup.md](uptimerobot_setup.md) for the UptimeRobot setup.

## Dashboard Checklist

- service type is `Web Service`
- environment is `Docker`
- no `render.yaml` exists or is used
- `Dockerfile Path` is `./Dockerfile`
- health check path is `/healthz`
- `SHEET_ID`, `TAB_NAME`, `CAPTURE_RANGE`, and `REPORT_LINK` are set
- `SEATALK_APP_ID`, `SEATALK_APP_SECRET`, and `SEATALK_SIGNING_SECRET` are set
- `GOOGLE_SERVICE_ACCOUNT_FILE=/etc/secrets/google-service-account.json`
- secret file `google-service-account.json` is uploaded
- the service account can edit `botconfig!A2:A`
- `/healthz` responds with both image cards
- SeaTalk callback verification succeeds
- external uptime monitor is configured if using Render Free

## Troubleshooting

### Service deploys but never becomes healthy

Check:

- health check path is exactly `/healthz`
- app logs show it is listening on `0.0.0.0:<PORT>`
- Docker build logs show Poppler and ImageMagick installed successfully
- you did not set `BOT_PORT` to a conflicting value

### Google Sheets auth fails

Check:

- secret file name is exactly `google-service-account.json`
- `GOOGLE_SERVICE_ACCOUNT_FILE` points to `/etc/secrets/google-service-account.json`
- the pasted secret file content is valid JSON
- the service account has editor access to the spreadsheet

### First card renders the wrong tab

Check these Render environment variables:

```text
TAB_NAME
CAPTURE_RANGE
```

The first card uses those values. If `CAPTURE_RANGE` includes a tab prefix, such as `my_tab!B2:M30`, that tab is used for the first card.

### Second card fails

Check that the spreadsheet has a tab named exactly:

```text
soc8_otp2_hourly
```

The second card expects:

```text
soc8_otp2_hourly!A1:J32
soc8_otp2_hourly!I3
```

### SeaTalk send fails

Check:

- SeaTalk app ID and secret are correct
- `SEATALK_SIGNING_SECRET` matches the callback signing secret
- the bot is in the target group
- `SEATALK_GROUP_ID` is correct, or the bot has received `bot_added_to_group_chat`
- rendered images are below SeaTalk's image size limit

## Render Docs

- Web services: https://render.com/docs/web-services
- Docker on Render: https://render.com/docs/docker
- Health checks: https://render.com/docs/health-checks
- Free instance limits: https://render.com/free
- Environment variables: https://render.com/docs/environment-variables
