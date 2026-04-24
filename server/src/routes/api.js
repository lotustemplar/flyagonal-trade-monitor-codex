import express from "express";
import { todayIso } from "../lib/dateUtils.js";
import { refreshCalendarGate } from "../services/calendarGate.js";
import {
  checkTrade,
  closeTrade,
  getDashboardData,
  getSettings,
  runEntryValidation,
  saveTrade,
  triggerTelegramTest,
  updateSettings,
  updateTrade,
  updateTradeFromApi
} from "../services/tradeService.js";
import { refreshScheduler } from "../services/scheduler.js";

export const apiRouter = express.Router();

apiRouter.get("/calendar", async (req, res) => {
  try {
    const dashboard = await getDashboardData();
    const vix = req.query.vix === undefined ? null : Number(req.query.vix);
    const targetDate = typeof req.query.date === "string" && req.query.date ? req.query.date : todayIso(dashboard.settings.timezone);
    const result = await refreshCalendarGate(dashboard.settings, Number.isNaN(vix) ? null : vix, targetDate);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post("/validate-entry", async (req, res) => {
  try {
    res.json(await runEntryValidation(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post("/save-trade", async (req, res) => {
  try {
    res.status(201).json(await saveTrade(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.get("/trades", async (_req, res) => {
  try {
    res.json(await getDashboardData());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.post("/check-trade/:id", async (req, res) => {
  try {
    const result = await checkTrade(req.params.id, req.body || {});
    if (!result.ok) {
      res.status(422).json(result);
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post("/trade/update", async (req, res) => {
  try {
    const configuredSecret = process.env.API_SECRET_KEY;
    if (!configuredSecret) {
      res.status(503).json({ error: "API secret key is not configured on the server." });
      return;
    }

    if ((req.body || {}).secret !== configuredSecret) {
      res.status(403).json({ error: "Invalid API secret." });
      return;
    }

    res.json(await updateTradeFromApi(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.put("/trade/:id/close", async (req, res) => {
  try {
    res.json(await closeTrade(req.params.id));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.put("/trade/:id/update", async (req, res) => {
  try {
    res.json(await updateTrade(req.params.id, req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.get("/settings", async (_req, res) => {
  try {
    res.json(await getSettings());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

apiRouter.put("/settings", async (req, res) => {
  try {
    const settings = await updateSettings(req.body || {});
    await refreshScheduler();
    res.json(settings);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

apiRouter.post("/alerts/test", async (_req, res) => {
  try {
    res.json(await triggerTelegramTest());
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
