import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultData } from "../config/defaultData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configuredDataFile = process.env.DATA_FILE;
const configuredDataDir = process.env.DATA_DIR;
const railwayVolumeMountPath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const dataDir = configuredDataDir
  ? path.resolve(configuredDataDir)
  : configuredDataFile
    ? path.dirname(path.resolve(configuredDataFile))
    : railwayVolumeMountPath
      ? path.resolve(railwayVolumeMountPath)
      : path.resolve(__dirname, "../../data");
const dataFile = configuredDataFile ? path.resolve(configuredDataFile) : path.join(dataDir, "trades.json");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeTradeDefaults(current = {}, fallback = {}) {
  return {
    ...clone(fallback),
    ...clone(current),
    manual_inputs: {
      ...clone(fallback.manual_inputs || {}),
      ...clone(current.manual_inputs || {})
    },
    verdicts: Array.isArray(current.verdicts) ? current.verdicts : clone(fallback.verdicts || [])
  };
}

function mergeDataShape(data) {
  return {
    settings: {
      ...clone(defaultData.settings),
      ...(data?.settings || {})
    },
    trades: {
      wednesday: mergeTradeDefaults(data?.trades?.wednesday, defaultData.trades.wednesday),
      thursday: mergeTradeDefaults(data?.trades?.thursday, defaultData.trades.thursday)
    }
  };
}

export async function ensureDataFile() {
  await mkdir(dataDir, { recursive: true });

  try {
    const raw = await readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    const merged = mergeDataShape(parsed);
    await writeData(merged);
    return merged;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    const seed = clone(defaultData);
    await writeData(seed);
    return seed;
  }
}

export async function readData() {
  const raw = await readFile(dataFile, "utf8");
  return mergeDataShape(JSON.parse(raw));
}

export async function writeData(data) {
  const merged = mergeDataShape(data);
  await writeFile(dataFile, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
