import assert from "node:assert/strict";
import {test} from "node:test";
import {scheduleChart} from "./chart.mjs";
import {needsGemini, verifyGeminiRows} from "./gemini.mjs";
import worker, {format, isUmanNotice} from "./worker.mjs";

const day = "2026-11-18";

test("Gemini fallback checks source intervals and catches cancellations without times", () => {
  const text = "ГПВ на 18 листопада. Для 2.2 відключення 6:00 - 08:30.";
  const row = {day, scope: "oblast", queue: "2.2", kind: "full", evidence: text};
  assert.equal(needsGemini(text, []), true);
  assert.equal(needsGemini("ГПВ по всій області на сьогодні скасовано", []), true);
  assert.deepEqual(verifyGeminiRows({rows: [{...row, intervals: ["06:00–08:30"]}]}, text, new Set([day])),
    [{day, scope: "oblast", queue: "2.2", kind: "full", intervals: ["06:00–08:30"]}]);
  assert.deepEqual(verifyGeminiRows({rows: [{...row, intervals: ["06:00–09:30"]}]}, text, new Set([day])), []);
});

test("today requests only the Uman schedule and sends one diagram", async t => {
  const schedules = [
    {day, scope: "uman", queue: "2.2", hours: "06:00–09:00", post_id: 1},
  ];
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, request) => {
    calls.push({url, form: request.body});
    return Response.json({ok: true});
  });
  const env = {
    BOT_TOKEN: "test",
    WEBHOOK_SECRET: "test",
    DB: {prepare: sql => {
      if (sql.includes("FROM schedules")) assert.match(sql, /scope = 'uman'/u);
      return {bind: () => ({
      first: async () => ({queue: "2.2"}),
      all: async () => ({results: schedules}),
    })}; }},
  };
  await worker.fetch(new Request("https://worker.example/telegram", {
    method: "POST",
    headers: {"X-Telegram-Bot-Api-Secret-Token": "test"},
    body: JSON.stringify({message: {text: "/today", chat: {id: 1, type: "private"}}}),
  }), env);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /sendPhoto$/u);
  assert.match(calls[0].form.get("caption"), /Умань[\s\S]+Без світла — 3 год[\s\S]+Зі світлом — 21 год/u);
  const png = new DataView(await calls[0].form.get("photo").arrayBuffer());
  assert.equal(png.getUint32(16), 480);
  const single = new DataView(await (await scheduleChart(schedules[0])).arrayBuffer());
  assert.equal(single.getUint32(16), 480);
});

test("recognizes the Uman deviation notice without schedule intervals", () => {
  assert.equal(isUmanNotice("До уваги споживачів Уманського району. Сьогодні протягом дня в Уманському районі можливі незначні відхилення від графіків погодинних відключень електроенергії."), true);
  assert.equal(isUmanNotice("У Черкасах можливі відхилення від графіків відключень"), false);
  assert.equal(isUmanNotice("В Уманському районі відкрито новий офіс"), false);
});

test("daily totals count overlapping intervals only once", () => {
  const text = format({queue: "2.2", day, post_id: 1, hours: "06:00–08:30, 08:00–09:00, 23:30–24:00"});
  assert.match(text, /Без світла — 3 год 30 хв/u);
  assert.match(text, /Зі світлом — 20 год 30 хв/u);
});
