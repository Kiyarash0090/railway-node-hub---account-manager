<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/877c9c6b-a759-43f1-ac58-057ce486a078

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Login & Server-side Data

- **First visit** shows a setup form to create a username + password. Those credentials become the app's permanent login.
- **Credentials** are stored (hashed) at `AUTH_FILE_PATH` (default `./data/auth.json`).
- **App state** (Railway accounts + API tokens, alerts) is stored at `STATE_FILE_PATH` (default `./data/hub-state.json`) — not in the browser.
- All `/api/*` routes (except `/api/health` and `/api/auth/*`) require a valid login session.

### Railway deploy

1. Create a **Volume** on the service and mount it at `/data`
2. Set environment variables:
   - `AUTH_FILE_PATH=/data/auth.json`
   - `STATE_FILE_PATH=/data/hub-state.json`
   - `NODE_ENV=production`
3. First visit after deploy → create username/password → done. Credentials and data survive redeploys via the volume.
