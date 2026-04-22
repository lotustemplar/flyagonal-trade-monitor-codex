import test from "node:test";
import assert from "node:assert/strict";
import { getDailyVerdict } from "../src/engines/dailyVerdict.js";
import { defaultData } from "../src/config/defaultData.js";

const settings = defaultData.settings;

test("Day 2 zero-profit loser closes all", () => {
  const verdict = getDailyVerdict({ current_pl_pct: -18, hwm_pct: 0, current_dte: 6, trade_day_number: 2 }, settings);
  assert.equal(verdict.rule, "E1-confirmed");
});

test("Binary separator loser closes on day 4", () => {
  const verdict = getDailyVerdict({ current_pl_pct: -21, hwm_pct: 18.9, current_dte: 4, trade_day_number: 4 }, settings);
  assert.equal(verdict.rule, "E2");
});

test("Confirmed survivor that fully reverses closes all", () => {
  const verdict = getDailyVerdict({ current_pl_pct: -0.5, hwm_pct: 24.6, current_dte: 3, trade_day_number: 5 }, settings);
  assert.equal(verdict.rule, "E3");
});

test("VIX collapse under threshold closes all", () => {
  const verdict = getDailyVerdict({ current_pl_pct: -14, hwm_pct: 12, current_dte: 5, trade_day_number: 3, vix_current: 14, vix_yesterday: 17 }, settings);
  assert.equal(verdict.rule, "E4");
});

test("Persistent SPX trend loser closes all", () => {
  const verdict = getDailyVerdict({ current_pl_pct: -28, hwm_pct: 11, current_dte: 4, trade_day_number: 4, spx_consecutive_days: 4 }, settings);
  assert.equal(verdict.rule, "E5");
});

test("Three-day VIX decline under threshold closes all", () => {
  const verdict = getDailyVerdict({ current_pl_pct: -19, hwm_pct: 9, current_dte: 5, trade_day_number: 4, vix_current: 14.5, vix_yesterday: 15.1, vix_3days_ago: 16.8 }, settings);
  assert.equal(verdict.rule, "V2");
});
