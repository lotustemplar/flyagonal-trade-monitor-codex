import { createApp } from "./app.js";
import { ensureDataFile } from "./lib/storage.js";
import { startScheduler } from "./services/scheduler.js";

const PORT = Number(process.env.PORT || 3001);

async function boot() {
  await ensureDataFile();
  await startScheduler();

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Flyagonal backend listening on http://localhost:${PORT}`);
  });
}

boot().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
