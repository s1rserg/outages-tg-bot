import {outageMinutes} from "./chart.mjs";

export function localClock(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return values.hour + ":" + values.minute;
}

function intervalsFromMinutes(minutes) {
  const result = [];
  const clock = value => String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
  let start = -1;
  for (let minute = 0; minute <= 1440; minute++) {
    if (minutes[minute] && start < 0) start = minute;
    if (!minutes[minute] && start >= 0) {
      result.push(clock(start) + "–" + clock(minute));
      start = -1;
    }
  }
  return result.join(", ");
}

export function rebuildDay(sources) {
  let hours = "";
  let complete = false;
  for (const source of [...sources].sort((a, b) => a.post_id - b.post_id)) {
    const cutoff = localClock(new Date(source.published));
    const publishedDay = new Intl.DateTimeFormat("sv-SE", {timeZone: "Europe/Kyiv"}).format(new Date(source.published));
    const full = !source.is_update || source.day > publishedDay || source.hours.startsWith("00:00");
    if (full) {
      hours = source.hours;
      complete = true;
      continue;
    }
    const old = hours.split(", ").filter(interval => interval && interval.slice(6) <= cutoff);
    hours = intervalsFromMinutes(outageMinutes([...old, source.hours].filter(Boolean).join(", ")));
  }
  return {hours, day_complete: Number(complete)};
}

export function upcomingOutages(hours, minute) {
  const minutes = outageMinutes(hours);
  const result = [];
  for (let start = Math.max(0, minute + 15); start <= Math.min(1439, minute + 20); start++) {
    if (minutes[start] && !minutes[start - 1]) {
      result.push(String(Math.floor(start / 60)).padStart(2, "0") + ":" + String(start % 60).padStart(2, "0"));
    }
  }
  return result;
}
