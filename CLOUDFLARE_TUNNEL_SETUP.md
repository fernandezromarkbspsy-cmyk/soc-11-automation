# Cloudflare Tunnel Setup Guide

This guide will help you deploy your SeaTalk Bot server using **Cloudflare Tunnel** instead of AWS.

## What is Cloudflare Tunnel?

Cloudflare Tunnel (formerly Argo Tunnel) allows you to:
- Run your Go service on any machine (local, VPS, Docker, etc.)
- Expose it securely through Cloudflare's global network
- Use your existing domain without opening ports or managing firewalls
- Get HTTPS automatically
- **No code changes required**

## Prerequisites

1. **Cloudflare Account** - [Sign up free](https://dash.cloudflare.com/sign-up)
2. **Domain in Cloudflare** - Your `soc5outboundops.app` domain should be managed by Cloudflare
3. **Running Go Server** - Your application running locally or on a server on `localhost:8000`
4. **Cloudflare CLI** - `cloudflared` installed on the machine running your app

## Step 1: Install Cloudflare CLI

### On macOS (Homebrew)
```bash
brew install cloudflare/cloudflare/cloudflared
```

### On Linux (Ubuntu/Debian)
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```

### On Windows (Chocolatey)
```bash
choco install cloudflared
```

### Or download directly
Visit: https://github.com/cloudflare/cloudflared/releases

Verify installation:
```bash
cloudflared --version
```

## Step 2: Authenticate Cloudflare CLI

Run this command:
```bash
cloudflared login
```

This will:
1. Open your browser to Cloudflare Dashboard
2. Ask you to select your domain (`soc5outboundops.app`)
3. Generate a certificate and store it locally at `~/.cloudflared/cert.pem`

## Step 3: Create a Tunnel

Run:
```bash
cloudflared tunnel create seatalk-bot
```

**Output will show:**
```
Tunnel credentials written to ~/.cloudflared/UUID.json
Created tunnel seatalk-bot with id UUID
```

Save the UUID for later.

## Step 4: Create Configuration File

Create a file at `~/.cloudflared/config.yml`:

```yaml
tunnel: seatalk-bot
credentials-file: ~/.cloudflared/UUID.json

ingress:
  - hostname: seatalk.soc5outboundops.app
    service: http://localhost:8000
  - service: http_status:404
```

**Replace `UUID` with your actual tunnel ID from Step 3.**

## Step 5: Route Your Domain to Cloudflare

Go to **Cloudflare Dashboard** → **Domains** → `soc5outboundops.app` → **DNS**

Create a CNAME record:
```
Name:   seatalk
Type:   CNAME
Target: seatalk-bot.soc5outboundops.app
Proxy:  Proxied (orange cloud)
```

Or use the CLI:
```bash
cloudflared tunnel route dns seatalk-bot seatalk.soc5outboundops.app
```

## Step 6: Start Your Application

In one terminal, run your Go app:

```bash
# Set environment variables
export BOT_CREDENTIALS_JSON='[{"bot_name":"SOC_11_Bot_Reporter","app_id":"...","app_secret":"...","signing_secret":"..."}]'
export GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
export SHEET_ID="1BgorYmizHGxOzzauLxSL_uu8WSybQYjvtSnbCeZjLf8"

# Run the app
go run .
```

The app will start on `http://localhost:8000`

## Step 7: Start Cloudflare Tunnel

In another terminal:

```bash
cloudflared tunnel run seatalk-bot
```

You should see:
```
2026-06-12T10:30:00Z INF Tunnel credentials have been saved to /root/.cloudflared/UUID.json
2026-06-12T10:30:01Z INF Connecting to supervisor
2026-06-12T10:30:02Z INF Connected to supervisor
2026-06-12T10:30:02Z INF Registered tunnel connection connIndex=0 location=ORD
2026-06-12T10:30:02Z INF Registered tunnel connection connIndex=1 location=DFW
...
```

## Step 8: Configure SeaTalk Callback URL

In SeaTalk Open Platform, set your callback URL to:

```
https://seatalk.soc5outboundops.app/seatalk/callback
```

## Step 9: Test Everything

### Health Check
```bash
curl https://seatalk.soc5outboundops.app/healthz
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

### Cloudflare Dashboard Check
Go to **Cloudflare Dashboard** → **Network** → **Tunnels** → `seatalk-bot`

Should show status as **ACTIVE** with connections.

---

## Production Deployment (Keep Tunnel Running)

### Option A: Run as systemd Service (Linux)

Create `/etc/systemd/system/cloudflared-tunnel.service`:

```ini
[Unit]
Description=Cloudflare Tunnel
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel run seatalk-bot
User=cloudflared
Restart=on-failure
RestartSec=10s

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable cloudflared-tunnel.service
sudo systemctl start cloudflared-tunnel.service
```

### Option B: Run as Docker Container

Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  seatalk-bot:
    build: .
    ports:
      - "8000:8000"
    environment:
      BOT_CREDENTIALS_JSON: '${BOT_CREDENTIALS_JSON}'
      GOOGLE_SERVICE_ACCOUNT_JSON: '${GOOGLE_SERVICE_ACCOUNT_JSON}'
      SHEET_ID: '${SHEET_ID}'
      SHEET_TAB_NAME: '${SHEET_TAB_NAME}'
    networks:
      - tunnel-network

  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run seatalk-bot
    volumes:
      - ~/.cloudflared:/root/.cloudflared
    environment:
      TUNNEL_TOKEN: '${CLOUDFLARE_TUNNEL_TOKEN}'
    networks:
      - tunnel-network
    depends_on:
      - seatalk-bot

networks:
  tunnel-network:
    driver: bridge
```

Run:
```bash
docker-compose up -d
```

### Option C: Run as tmux Session (Development)

```bash
tmux new-session -d -s seatalk-tunnel -c ~

# Terminal 1: Go app
tmux send-keys -t seatalk-tunnel "go run ." Enter

# Terminal 2: Cloudflare Tunnel
tmux new-window -t seatalk-tunnel -c ~
tmux send-keys -t seatalk-tunnel "cloudflared tunnel run seatalk-bot" Enter
```

---

## Troubleshooting

### Tunnel not connecting
```bash
# Check tunnel status
cloudflared tunnel info seatalk-bot

# Restart tunnel
cloudflared tunnel run seatalk-bot
```

### DNS not resolving
- Ensure CNAME record is created in Cloudflare DNS
- Check that proxy status is **Proxied** (orange cloud), not DNS only
- Wait a few minutes for DNS propagation

### SeaTalk callback failing
- Test manually: `curl -X POST https://seatalk.soc5outboundops.app/seatalk/callback`
- Check tunnel logs: `cloudflared tunnel run seatalk-bot --loglevel debug`
- Verify Go app is running: `curl http://localhost:8000/healthz`

### Port already in use
If port 8000 is busy:
```bash
# Find what's using it
lsof -i :8000

# Or run on different port
PORT=9000 go run .
# Then update config.yml: service: http://localhost:9000
```

---

## Cost Comparison

| Service | AWS ECS Fargate | Cloudflare Tunnel |
|---------|-----------------|-------------------|
| **Compute** | ~$30-50/month | Free (tunneling) + your server |
| **Domain DNS** | Separate | Free included |
| **HTTPS** | AWS Certificate Manager | Free (Cloudflare) |
| **Global CDN** | Optional extra | Included |
| **Setup complexity** | High | Low |

**Total Cost**: Your existing server (or free tier) + Cloudflare free plan = $0-5/month

---

## Next Steps

1. ✅ Install cloudflared
2. ✅ Authenticate with `cloudflared login`
3. ✅ Create tunnel with `cloudflared tunnel create seatalk-bot`
4. ✅ Set up `~/.cloudflared/config.yml`
5. ✅ Route domain with CNAME
6. ✅ Start Go app on `localhost:8000`
7. ✅ Run `cloudflared tunnel run seatalk-bot`
8. ✅ Update SeaTalk callback URL
9. ✅ Test health endpoint

Done! Your bot is now running through Cloudflare Tunnel. 🚀
