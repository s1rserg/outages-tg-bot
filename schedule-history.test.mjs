import {test} from "node:test";
import assert from "node:assert/strict";
import {rebuildDay, upcomingOutages} from "./schedule-history.mjs";

test("late update retains elapsed outages and replaces future periods", () => {
  const sources = [
    {post_id: 1, day: "2026-11-22", published: "2026-11-21T18:00:00Z", is_update: 0,
      hours: "00:00–03:00, 06:00–09:00, 12:00–15:00, 18:00–21:00"},
    {post_id: 2, day: "2026-11-22", published: "2026-11-22T13:20:00Z", is_update: 1, hours: "18:00–21:00"},
  ];
  assert.deepEqual(rebuildDay(sources), {hours: sources[0].hours, day_complete: 1});
  sources[1].hours = "19:00–22:00";
  assert.equal(rebuildDay(sources).hours, "00:00–03:00, 06:00–09:00, 12:00–15:00, 19:00–22:00");
});

test("missing baseline is reported as incomplete", () => {
  assert.deepEqual(rebuildDay([{post_id: 2, day: "2026-11-22", published: "2026-11-22T13:20:00Z",
    is_update: 1, hours: "18:00–21:00"}]), {hours: "18:00–21:00", day_complete: 0});
});

test("reminder detects starts, merging overlapping periods", () => {
  assert.deepEqual(upcomingOutages("18:00–20:00, 19:00–21:00", 1060), ["18:00"]);
  assert.deepEqual(upcomingOutages("18:00–20:00", 1080), []);
});
