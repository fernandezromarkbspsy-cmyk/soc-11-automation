# SeaTalk Bot Group Capture Server

This Go service receives SeaTalk event callbacks and stores `bot_added_to_group_chat`
events in Google Sheets.

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

Use one of these setups:

```text
SeaTalk -> Cloudflare DNS -> Render/Fly/VPS running this Go service
SeaTalk -> Cloudflare DNS -> Cloudflare Tunnel -> this server on localhost:8000
```

For a normal hosted service, create a DNS record like:

```text
Type: CNAME
Name: seatalk
Target: <your-host-provider-domain>
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

For AWS hosting with your Name.com domain `soc5outboundops.app`, use:

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
