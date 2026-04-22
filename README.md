# Flyagonal Trade Monitor

Local full-stack dashboard for managing Flyagonal SPX trades.

## Run

```bash
npm install
npm run install:all
npm run dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`

## Notes

- The backend stores state in `server/data/trades.json`.
- ForexFactory and OptionStrat scraping use Playwright with graceful manual fallbacks when data is unavailable.
- The decision engine is pure JavaScript and is covered by unit tests in `server/tests`.

## Public Deployment

This repo is set up to deploy as a single public web service:

- the React app is built into `client/dist`
- Express serves the frontend and `/api` from the same origin
- `Dockerfile` installs Chromium for Playwright scraping
- `render.yaml` is included for Render deployment
- the JSON store can be moved to persistent storage with `DATA_DIR` or `DATA_FILE`

### Render

1. Push this project to GitHub.
2. In Render, create a new Web Service from the repo.
3. Render should detect `render.yaml` and use the Docker deployment.
4. Add a persistent disk and set `DATA_DIR=/var/data` so `trades.json` survives deploys.
5. After deploy, your public app URL will look like:
   `https://flyagonal-trade-monitor.onrender.com`

### Railway

1. Push this project to GitHub.
2. Create a new Railway project from the repo.
3. Railway will build from the `Dockerfile`.
4. Mount a volume and set `DATA_DIR` to that mount path so `trades.json` persists.
5. After deploy, Railway will assign a public domain for the full app.

### Telegram Alerts

The app can send milestone/checkpoint alerts to Telegram when:

- a trade is opened
- a non-HOLD verdict is triggered
- a trade is manually closed

Set these on the server:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID` or enter `telegram_chat_id` in the app settings

Then enable Telegram alerts from the in-app Settings panel.
