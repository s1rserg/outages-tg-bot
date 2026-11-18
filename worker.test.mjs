import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parsePost as parseSchedules } from "./worker.mjs";

function parsePost(post, queue = "2.2") {
  const schedule = parseSchedules(post).find(row => row.queue === queue);
  if (!schedule) return null;
  const {id, scope, day, hours} = schedule;
  return {id, scope, day, hours};
}

const post = {
  id: 100,
  datetime: "2026-11-16T19:45:00Z",
};

test("reads only queue 2.2 and normalizes a dated regional schedule", () => {
  assert.deepEqual(parsePost({
    ...post,
    text: "17 листопада ГПВ з 00:00 до 24:00\nГПВ на 17 листопада\nГодини відсутності електропостачання:\n2.1 03:00 - 04:00\n2.2 07:00 - 09:00, 21:30 — 24:00\n3.1 10:00 - 11:00",
  }), { id: 100, scope: "oblast", day: "2026-11-17", hours: "07:00–09:00, 21:30–24:00" });
});

test("recognizes the date from the original notice", () => {
  const text = "17 листопада з 00:00 до 24:00 у Черкаській області будуть застосовані графіки погодинних відключень (ГПВ).\nГодини відсутності електропостачання:\n2.2 07:00 - 09:00";
  assert.equal(parsePost({...post, text})?.day, "2026-11-17");
});

test("keeps the undated temporary Uman schedule separate", () => {
  const text = "В частині Уманського району застосовуються тимчасові індивідуальні графіки.\nГодини відсутності електропостачання:\n2.2 06:00 - 09:00";
  assert.deepEqual(parsePost({...post, text}), { id: 100, scope: "uman", day: "", hours: "06:00–09:00" });
});

test("ignores unrelated posts and ambiguous queue rows", () => {
  assert.equal(parsePost({...post, text: "ГПВ на 17 листопада\nГодини відсутності електропостачання:\n2.2 уточнюється\n3.2 09:00 - 10:00"}), null);
});

test("reads the requested queue independently of 2.2", () => {
  const text = "ГПВ на 17 листопада\nГодини відсутності електропостачання:\n2.2 07:00 - 09:00\n3.1 13:00 - 15:00";
  assert.equal(parsePost({...post, text}, "3.1")?.hours, "13:00–15:00");
  assert.equal(parsePost({...post, text}, "4.1"), null);
});

test("reads both schedules from one post with overlapping queues", () => {
  const sections = `🔹 **Години відсутності електропостачання по області (крім ВСП «Уманські енергетичні мережі», Жашківської, Монастирищенської та Христинівської філій):**

2.1 06:00 - 08:00, 22:00 - 24:00
2.2 06:00 - 08:00, 12:00 - 15:00, 18:00 - 21:00

🔹 **Тимчасові індивідуальні графіки відключень електроенергії для споживачів ВСП «Уманські енергетичні мережі», Жашківської, Монастирищенської та Христинівської філій.**

Години відсутності електропостачання:

2.2 00:00 - 03:00, 06:00 - 09:00, 12:00 - 15:00, 18:00 - 21:00`;
  const rows = parseSchedules({...post, text: "ГПВ на 17 листопада\n" + sections});
  assert.deepEqual(rows.map(({scope, day, queue, hours}) => [scope, day, queue, hours]), [
    ["oblast", "2026-11-17", "2.1", "06:00–08:00, 22:00–24:00"],
    ["oblast", "2026-11-17", "2.2", "06:00–08:00, 12:00–15:00, 18:00–21:00"],
    ["uman", "2026-11-17", "2.2", "00:00–03:00, 06:00–09:00, 12:00–15:00, 18:00–21:00"],
  ]);
  assert.deepEqual(parseSchedules({...post, text: sections}).map(row => row.day), ["", "", ""]);
});
