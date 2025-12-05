# Remote Desktop Pro - Cloud Relay

Deploy this to get a **free cloud relay** that works across any network.

## 🚀 Deploy to Render.com (Recommended - Completely Free)

1. Go to [render.com](https://render.com) and sign up (free)
2. Click **New** → **Web Service**
3. Connect your GitHub or upload this folder
4. Settings:
   - **Name:** `remote-desktop-relay`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Click **Create Web Service**

Your relay URL will be: `https://remote-desktop-relay.onrender.com`

## 🚀 Deploy to Fly.io (Also Free)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Deploy
cd cloud-relay
fly launch
fly deploy
```

## 🚀 Deploy to Railway.app (Free tier)

1. Go to [railway.app](https://railway.app)
2. Click **New Project** → **Deploy from GitHub**
3. Select this folder
4. Done!

## After Deployment

Once deployed, update your controller and agent to use:
```
RELAY_URL=https://your-app-name.onrender.com
```

The relay handles:
- ✅ Pairing codes (6-digit codes to connect agent to controller)
- ✅ Screen streaming relay
- ✅ All mouse/keyboard/file events
- ✅ Works across any network
- ✅ No port forwarding needed
