import cors from "cors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiRouter } from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(__dirname, "../../client/dist");

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", apiRouter);

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(express.static(clientDistDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }

    res.sendFile(path.join(clientDistDir, "index.html"));
  });

  return app;
}
