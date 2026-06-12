# Render.com Deployment Guide

Deploy your SeaTalk Bot callback server on **Render's free tier** in minutes.

## Why Render?

- ✅ **Free tier supports your use case** - occasional webhook callbacks
- ✅ **No credit card for free tier** - just GitHub connection
- ✅ **Go native** - deploy your binary directly
- ✅ **Automatic HTTPS** - `*.render.com` domain
- ✅ **Auto-restart on failure** - 99.9% uptime
- ✅ **Easy scaling** - upgrade anytime if needed
- ✅ **GitHub integration** - auto-deploy on push

## Prerequisites

1. **GitHub account** (you have it ✓)
2. **Render account** - [Sign up free](https://render.com)
3. **Your app running locally** - tested on `localhost:8000`

## Step 1: Prepare Your Repository

Your repo is already good! But ensure you have:

```
soc-11-automation/
├── main.go
├── go.mod
├── go.sum
├── Dockerfile          ← Already exists ✓
├── .dockerignore       ← Already exists ✓
└── render.yaml         ← Create this (next step)
```

## Step 2: Add Render Configuration File

Create `render.yaml` in your repo root:

```yaml
services:
  - type: web
    name: seatalk-bot
    runtime: go
    buildCommand: go mod download && go build -o seatalk-bot .
    startCommand: ./seatalk-bot
    envVars:
      - key: PORT
        value: 8000
      - key: SEATALK_REQUIRE_SIGNATURE
        value: "true"
      - key: SHEET_ID
        value: 1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8
      - key: SHEET_TAB_NAME
        value: bot_groupid
    envVarsFile: .env.render  # For secrets (you'll add this manually)
```

Or use the **Dockerfile** (already in your repo):

```yaml
services:
  - type: web
    name: seatalk-bot
    dockerfile: ./Dockerfile
    envVars:
      - key: PORT
        value: 8000
      - key: SEATALK_REQUIRE_SIGNATURE
        value: "true"
```

## Step 3: Deploy to Render

### Option A: Via GitHub (Recommended - Auto-Deploy)

1. Go to [render.com/dashboard](https://render.com/dashboard)
2. Click **New +** → **Web Service**
3. Connect GitHub repo: `soc-11-automation`
4. Fill in:
   - **Name**: `seatalk-bot`
   - **Environment**: `Docker` (since you have Dockerfile) OR `Go`
   - **Build Command**: `go mod download && go build -o seatalk-bot .`
   - **Start Command**: `./seatalk-bot`
   - **Plan**: `Free`

5. Click **Create Web Service**

### Option B: Via Render CLI

```bash
# Install Render CLI (optional)
npm install -g render-cli

# Deploy
render deploy --repo fernandezromarkbspsy-cmyk/soc-11-automation
```

## Step 4: Add Environment Variables

After deployment, go to **Settings** → **Environment**:

Add these as **secret** environment variables (NOT in code):

```
BOT_CREDENTIALS_JSON
[{"bot_name":"SOC_11_Bot_Reporter","app_id":"YOUR_APP_ID","app_secret":"YOUR_SECRET","signing_secret":"YOUR_SIGNING_SECRET"}]
```

```
GOOGLE_SERVICE_ACCOUNT_JSON
{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}
```

```
SHEET_ID
1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8
```

```
SHEET_TAB_NAME
bot_groupid
```

✅ Render will restart your service automatically when you save.

## Step 5: Get Your Render URL

Your service will be deployed to:
```
https://seatalk-bot.onrender.com
```

(Or custom domain if you configure one)

## Step 6: Update SeaTalk Callback URL

In **SeaTalk Open Platform**, set:

```
https://seatalk-bot.onrender.com/seatalk/callback
```

## Step 7: Test Deployment

### Health Check
```bash
curl https://seatalk-bot.onrender.com/healthz
```

Should return:
```json
{
  "status": "ok",
  "configured_bots": 1,
  "sheet_id": "1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8",
  "sheet_tab": "bot_groupid",
  "google_service_account_configured": true
}
```

### View Logs
Go to **Services** → `seatalk-bot` → **Logs**

You'll see real-time logs of incoming callbacks.

## Step 8: Enable Auto-Deploy (Optional)

By default, Render watches your GitHub repo:
- Push to `main` → Automatic redeploy
- Perfect for quick updates

To disable or configure: **Settings** → **Deploy Hooks**

---

## Render Free Tier Details

| Feature | Free Tier |
|---------|-----------|
| **Compute** | 0.5 CPU, 512 MB RAM |
| **Requests** | Unlimited |
| **Bandwidth** | 100 GB/month |
| **HTTPS** | ✅ Included |
| **Auto-scale** | ❌ (Not needed for webhooks) |
| **Uptime SLA** | 99.9% |
| **Spin-down** | After 15 mins inactivity (instant restart on webhook) |

**For occasional SeaTalk events**: Perfect fit! ✅

---

## Troubleshooting

### Deployment Failed

Check the **Build Logs** in Render dashboard:
- Missing dependencies? → Check `go.mod`
- Port issue? → Ensure `PORT` env var is set to `8000`

```bash
# Test locally first
PORT=8000 go run .
```

### Webhook Not Reaching Server

1. Check Render logs for incoming requests
2. Verify SeaTalk callback URL matches exactly
3. Test manually:
```bash
curl -X POST https://seatalk-bot.onrender.com/seatalk/callback \
  -H "Content-Type: application/json" \
  -d '{"event_type":"event_verification","app_id":"test","event":{"seatalk_challenge":"abc123"}}'
```

### Service Spinning Down

Render spins down free services after 15 mins of inactivity. When a webhook comes in:
- Takes ~5-30 seconds to start
- Then processes normally
- This is fine for occasional events

To prevent: Upgrade to paid plan ($7/month minimum)

---

## Optional: Custom Domain

If you want `seatalk.soc5outboundops.app` instead of `.onrender.com`:

1. **Settings** → **Custom Domain**
2. Add: `seatalk.soc5outboundops.app`
3. In Cloudflare DNS, create CNAME:
   ```
   Name: seatalk
   Type: CNAME
   Target: seatalk-bot.onrender.com
   Proxy: Proxied
   ```

---

## Cost Comparison

| Platform | Monthly | Notes |
|----------|---------|-------|
| **Render Free** | $0 | Occasional webhooks ✓ |
| **AWS ECS Fargate** | $30-50 | Overkill for webhooks |
| **Cloudflare Tunnel** | $0 | Need local server running |
| **Render Paid** | $7+ | If you need always-on |

---

## Next Steps

1. ✅ Push your repo to GitHub (already done)
2. ✅ Sign up on [render.com](https://render.com)
3. ✅ Connect GitHub account to Render
4. ✅ Create Web Service from repo
5. ✅ Add environment variables (secrets)
6. ✅ Update SeaTalk callback URL
7. ✅ Test health endpoint
8. ✅ Monitor logs for incoming events

Your SeaTalk bot will now handle webhooks for free! 🚀

**AppScript and image converter** can keep running in AWS as-is. This only handles the `bot_added_to_group_chat` event callbacks.
