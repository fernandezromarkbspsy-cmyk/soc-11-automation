# SeaTalk Bot Group Capture Server

This Go service receives SeaTalk event callbacks and stores `bot_added_to_group_chat`
events in Google Sheets.

## Render Event Callback Deployment

This service is deployed on Render for SeaTalk event callbacks.

Render callback URL:

```text
https://seatalk-bot.onrender.com/seatalk/callback
```

If you configure the custom Cloudflare domain, use:

```text
https://seatalk.soc5outboundops.app/seatalk/callback
```

The repository includes `render.yaml`, so deploy from Render by creating a Web Service or Blueprint from the GitHub repo. Render will build and run the Go callback server and provide HTTPS automatically.

Required Render environment variables:

```text
PORT=8000
SEATALK_REQUIRE_SIGNATURE=true
SHEET_ID=1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8
SHEET_TAB_NAME=bot_groupid
GOOGLE_SERVICE_ACCOUNT_JSON=<full google-service-account.json content>
BOT_CREDENTIALS_JSON=<bot credentials JSON array>
```

Generate `BOT_CREDENTIALS_JSON` from local bot credential files with:

```powershell
.\scripts\export-bot-credentials-json.ps1
```

Then paste the generated JSON value into Render as a secret environment variable. It must start with `[` or `{`; do not set it to a filename or secret name.

Health check:

```text
https://seatalk-bot.onrender.com/healthz
```

Expected response includes `status: "ok"`, `configured_bots` greater than `0`, and `google_service_account_configured: true`.

Full Render guide:

```text
RENDER_DEPLOYMENT.md
```

## Callback URL

Use this callback path in SeaTalk Open Platform:

```text
https://<host>/seatalk/callback
```

The server also accepts `/callback`.

## Cloudflare Domain Callback

If your domain is already in Cloudflare DNS, the SeaTalk callback URL should be:

```text
https://<your-domain>/seatalk/callback
```

Cloudflare DNS must point that hostname to a running public copy of this Go service.
DNS by itself does not host the app.

For the current Render deployment, point Cloudflare to Render:

```text
SeaTalk -> Cloudflare DNS -> Render running this Go service
```

Other supported setups:

```text
SeaTalk -> Cloudflare DNS -> Cloudflare Tunnel -> this server on localhost:8000
```

For Render custom domain hosting, create a DNS record like:

```text
Type: CNAME
Name: seatalk
Target: seatalk-bot.onrender.com
Proxy status: Proxied
SSL/TLS mode: Full
```

Then configure SeaTalk with:

```text
https://seatalk.<your-domain>/seatalk/callback
```

For a Cloudflare Tunnel, point the tunnel public hostname to:

```text
http://localhost:8000
```

Then use the tunnel hostname as the SeaTalk callback URL with `/seatalk/callback`.

## AWS Deployment

AWS ECS Fargate is still documented, but Render is the current simpler callback deployment. For AWS hosting with your Name.com domain `soc5outboundops.app`, use:

```text
https://seatalk.soc5outboundops.app/seatalk/callback
```

See the full ECS Fargate setup guide:

```text
seatalk_docs/aws_ecs_fargate_deployment.md
```

## Sheet Target

Default sheet:

```text
1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8
```

Default tab:

```text
bot_groupid
```

Columns:

```text
bot_name, app_id, app_secret, signing_secret, group_id, group_name, is_active, bot_description
```

## Local Run

```powershell
go mod tidy
go run .
```

Open:

```text
http://localhost:8000/healthz
```

## Configuration

Defaults point to the local `credentials` folder. Override with environment variables when deployed:

```text
SHEET_ID=1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8
SHEET_TAB_NAME=bot_groupid
BOT_CREDENTIALS_DIR=credentials/bot_credentials
GOOGLE_SERVICE_ACCOUNT_FILE=credentials/google-service-account.json
PORT=8000
SEATALK_REQUIRE_SIGNATURE=true
```

For AWS Secrets Manager or other container platforms, you can avoid secret files by setting:

```text
GOOGLE_SERVICE_ACCOUNT_JSON=<full google-service-account.json content>
BOT_CREDENTIALS_JSON=[{"bot_name":"SOC_11_Bot_Reporter","app_id":"...","app_secret":"...","signing_secret":"...","bot_description":"..."}]
```

Each bot credential file should be a `.txt` file with:

```text
app_id=<seatalk app id>
app_secret=<seatalk app secret>
signing_secret=<seatalk callback signing secret>
```

Optional keys:

```text
bot_name=<display name>
bot_description=<description>
```
