import assert from "node:assert/strict";
import {test} from "node:test";
import {scheduleChart} from "./chart.mjs";
import {needsGemini, verifyGeminiRows} from "./gemini.mjs";
import worker from "./worker.mjs";

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

test("today sends both diagrams in one Telegram album", async t => {
  const schedules = [
    {day, scope: "oblast", queue: "2.2", hours: "06:00–08:00", post_id: 1},
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
    DB: {prepare: () => ({bind: () => ({
      first: async () => ({queue: "2.2"}),
      all: async () => ({results: schedules}),
    })})},
  };
  await worker.fetch(new Request("https://worker.example/telegram", {
    method: "POST",
    headers: {"X-Telegram-Bot-Api-Secret-Token": "test"},
    body: JSON.stringify({message: {text: "/today", chat: {id: 1, type: "private"}}}),
  }), env);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /sendMediaGroup$/u);
  const media = JSON.parse(calls[0].form.get("media"));
  assert.deepEqual(media.map(item => item.media), ["attach://chart0", "attach://chart1"]);
  assert.match(media[0].caption, /Черкаська область[\s\S]+Уманські енергомережі/u);
  assert.equal(media[1].caption, undefined);
  for (const name of ["chart0", "chart1"]) {
    const png = new DataView(await calls[0].form.get(name).arrayBuffer());
    assert.equal(png.getUint32(16), 480);
    assert.equal(png.getUint32(20), 480);
  }
  const single = new DataView(await (await scheduleChart(schedules[0])).arrayBuffer());
  assert.equal(single.getUint32(16), 480);
});
