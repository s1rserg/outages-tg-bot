import { scheduleChart } from "./chart.mjs";
import { askGemini, needsGemini } from "./gemini.mjs";

const channel = "pat_cherkasyoblenergo";
const months = "січня лютого березня квітня травня червня липня серпня вересня жовтня листопада грудня".split(" ");
const datePattern = new RegExp("(?:(?:на|з)\\s+)?(\\d{1,2})\\s+(" + months.join("|") + ")", "giu");

function kyivDay(date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return [values.year, values.month, values.day].join("-");
}

const queues = Array.from({length: 6}, (_, index) => [`${index + 1}.1`, `${index + 1}.2`]).flat();

function explicitDays(text, published) {
  const days = new Set();
  for (const match of text.matchAll(datePattern)) {
    const month = months.indexOf(match[2].toLowerCase()) + 1;
    const publishedMonth = Number(published.slice(5, 7));
    const year = Number(published.slice(0, 4)) + (publishedMonth === 12 && month === 1 ? 1 : publishedMonth === 1 && month === 12 ? -1 : 0);
    const date = new Date(Date.UTC(year, month - 1, Number(match[1])));
    if (date.getUTCMonth() === month - 1) days.add(date.toISOString().slice(0, 10));
  }
  return days;
}

export function parsePost(post) {
  const text = post.text.replace(/\u00a0/g, " ");
  const sections = text.split(/Години відсутності електропостачання/giu);
  const [heading, ...bodies] = sections;
  if (!bodies.length || !Number.isSafeInteger(post.id) || !post.datetime) return [];
  const timestamp = new Date(post.datetime);
  if (!Number.isFinite(timestamp.getTime())) return [];
  const published = kyivDay(timestamp);
  const day = explicitDays(heading, published).values().next().value ?? "";

  const schedules = [];
  for (const [index, body] of bodies.entries()) {
    const hasRegionalLabel = /^[ \t*]*по області(?=[ \t(:*]|$)/iu.test(body);
    const previous = sections[index];
    const uman = !hasRegionalLabel && (
      /Уманськ/iu.test(index === 0 ? heading : previous) &&
      /тимчасов|індивідуальн/iu.test(index === 0 ? heading : previous)
    );
    const regional = hasRegionalLabel || (index === 0 && day && /ГПВ|графік\p{L}* погодинних відключень/iu.test(heading));
    if (!uman && !regional) continue;

    const rows = body.matchAll(/^[ \t*]*([1-6]\.[12])(?=[ \t*:–—-])[ \t*]*[:–—-]?[ \t]*([^\n]+)/gmu);
    for (const [, queue, row] of rows) {
      const intervals = [...row.matchAll(/((?:[01]\d|2[0-3]):[0-5]\d)\s*[-–—−]\s*((?:[01]\d|2[0-3]):[0-5]\d|24:00)/gu)]
        .filter(([, start, end]) => start < end)
        .map(([, start, end]) => start + "–" + end);
      const hours = [...new Set(intervals)].sort().join(", ");
      if (!hours && !/без відключень|не (?:застосовуються|вимикається|відключається)|відключень не буде/iu.test(row)) continue;
      schedules.push({id: post.id, scope: uman ? "uman" : "oblast", day, queue, hours});
    }
  }
  return schedules;
}

async function readFeed() {
  const response = await fetch("https://t.me/s/" + channel, {signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error("Telegram feed HTTP " + response.status);
  const posts = [];
  let post;
  await new HTMLRewriter()
    .on(".tgme_widget_message[data-post]", {
      element(element) {
        const id = Number(element.getAttribute("data-post")?.split("/").pop());
        post = { id, text: "", datetime: "" };
        posts.push(post);
      },
    })
    .on(".tgme_widget_message_text", {
      text(chunk) { if (post) post.text += chunk.text; },
    })
    .on(".tgme_widget_message_text br", {
      element() { if (post) post.text += "\n"; },
    })
    .on(".tgme_widget_message_date time", {
      element(element) { if (post) post.datetime = element.getAttribute("datetime"); },
    })
    .transform(response).arrayBuffer();
  if (!posts.length) throw new Error("Telegram feed contained no channel posts");
  return posts;
}

async function send(env, chat, message, keyboard) {
  const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: message, reply_markup: keyboard, link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  return { ok: response.ok && result.ok, status: result.error_code ?? response.status };
}

function format(row) {
  const area = row.scope === "uman" ? "Уманські енергомережі та окремі філії · тимчасовий графік" : "Черкаська область";
  const date = row.day ? "\nГрафік на " + row.day.split("-").reverse().join(".") : "\nУ дописі не вказано дату дії графіка.";
  const hours = row.hours ? "Без світла " + row.hours : "Відключень за графіком немає";
  return "⚡ " + area + " · підчерга " + row.queue + date + "\n" + hours +
    "\nhttps://t.me/" + channel + "/" + row.post_id;
}

async function sendSchedules(env, chat, rows, charts = new Map()) {
  const caption = rows.map(format).join("\n\n");
  const key = JSON.stringify(rows.map(({scope, day, queue, hours}) => [scope, day, queue, hours]));
  try {
    if (!charts.has(key)) charts.set(key, await scheduleChart(rows));
    const form = new FormData();
    form.set("chat_id", String(chat));
    form.set("caption", caption);
    form.set("photo", charts.get(key), "outages.png");
    const response = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendPhoto", {
      method: "POST", body: form, signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (result.error_code !== 400) {
      return {ok: response.ok && result.ok, status: result.error_code ?? response.status};
    }
  } catch {
    console.error("Schedule photo could not be generated or sent");
  }
  return send(env, chat, caption);
}

async function showToday(env, chat, queue) {
  const today = kyivDay(new Date());
  const {results} = await env.DB.prepare(`
    SELECT scope, day, queue, hours, post_id FROM schedules
    WHERE queue = ? AND (day = ? OR day = '')
    ORDER BY scope, day DESC
  `).bind(queue, today).all();
  const schedules = new Map();
  for (const row of results) {
    if (!schedules.has(row.scope)) schedules.set(row.scope, row);
  }
  if (schedules.size === 0) {
    await send(env, chat, "Поки немає графіка на сьогодні для підчерги " + queue +
      ". Спробуй ще раз після наступної перевірки каналу.", menu);
    return;
  }
  await sendSchedules(env, chat, [...schedules.values()]);
}

function scheduleKey({scope, day, queue}) {
  return [scope, day, queue].join("/");
}

async function readGeminiRows(env, raw, published, allowRequest) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw.id + "\n" + raw.text));
  const key = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
  const cached = await env.DB.prepare("SELECT rows_json FROM gemini_post_cache WHERE source_hash = ?").bind(key).first();
  if (cached) return {rows: JSON.parse(cached.rows_json), requested: false};
  const allowedDays = explicitDays(raw.text, published);
  if (/сьогодні/iu.test(raw.text)) allowedDays.add(published);
  if (/завтра/iu.test(raw.text)) {
    const tomorrow = new Date(Date.parse(published) + 86400000);
    allowedDays.add(tomorrow.toISOString().slice(0, 10));
  }
  if (!allowRequest || !allowedDays.size) return {rows: [], requested: false};
  const rows = await askGemini(env, raw.text, published, allowedDays);
  await env.DB.prepare("INSERT OR IGNORE INTO gemini_post_cache (source_hash, rows_json) VALUES (?, ?)")
    .bind(key, JSON.stringify(rows)).run();
  return {rows, requested: true};
}

async function updateSchedules(env) {
  const db = env.DB;
  const today = kyivDay(new Date());
  const latest = new Map();
  let requestsLeft = 3;
  for (const raw of (await readFeed()).sort((a, b) => a.id - b.id)) {
    const parsed = parsePost(raw);
    const timestamp = new Date(raw.datetime);
    if (env.GEMINI_API_KEY && Number.isSafeInteger(raw.id) && raw.datetime &&
        Number.isFinite(timestamp.getTime()) && needsGemini(raw.text, parsed)) {
      try {
        const published = kyivDay(timestamp);
        const {rows, requested} = await readGeminiRows(env, raw, published, requestsLeft > 0);
        if (requested) requestsLeft--;
        for (const row of rows) {
          if (row.day < today) continue;
          const key = scheduleKey(row);
          const recognized = parsed.findIndex(item => scheduleKey(item) === key);
          if (recognized >= 0 && row.kind === "full") continue;
          let intervals = row.intervals;
          if (row.kind === "replace") {
            const base = await db.prepare("SELECT hours, post_id FROM schedules WHERE scope = ? AND day = ? AND queue = ?")
              .bind(row.scope, row.day, row.queue).first();
            const pending = latest.get(key);
            const hours = (pending && pending.id >= (base?.post_id ?? 0) ? pending.hours : base?.hours)?.split(", ");
            const [old, replacement] = intervals;
            if (!hours?.includes(old) || (base && base.post_id > raw.id)) continue;
            intervals = hours.map(hour => hour === old ? replacement : hour);
          }
          const schedule = {...row, id: raw.id, hours: [...new Set(intervals)].sort().join(", ")};
          if (recognized >= 0) parsed[recognized] = schedule;
          else parsed.push(schedule);
        }
      } catch {
        requestsLeft = 0;
        console.error("Gemini schedule fallback failed");
      }
    }
    for (const post of parsed) {
      if (post.day && post.day < today) continue;
      const key = scheduleKey(post);
      if (!latest.has(key) || latest.get(key).id < post.id) latest.set(key, post);
    }
  }
  if (!latest.size) return;
  await db.batch([...latest.values()].map(post => db.prepare(`
    INSERT INTO schedules (scope, day, queue, post_id, hours) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope, day, queue) DO UPDATE SET post_id = excluded.post_id,
      hours = excluded.hours,
      revision = schedules.revision + (schedules.hours <> excluded.hours)
    WHERE excluded.post_id >= schedules.post_id
      AND (excluded.post_id <> schedules.post_id OR excluded.hours <> schedules.hours)
  `).bind(post.scope, post.day, post.queue, post.id, post.hours)));
}

async function deliver(env) {
  const today = kyivDay(new Date());
  await env.DB.prepare("DELETE FROM deliveries WHERE day <> '' AND day < ?").bind(today).run();
  const {results} = await env.DB.prepare(`
    WITH pending AS (
      SELECT d.*, s.hours, s.post_id FROM deliveries d
      JOIN schedules s USING (scope, day, queue, revision)
    ), groups AS (
      SELECT chat_id, queue, day, post_id FROM pending
      GROUP BY chat_id, queue, day, post_id ORDER BY MIN(revision), chat_id, post_id LIMIT 10
    )
    SELECT pending.* FROM pending JOIN groups USING (chat_id, queue, day, post_id)
    ORDER BY chat_id, post_id, day, scope
  `).all();
  const groups = new Map();
  for (const row of results) {
    const key = JSON.stringify([row.chat_id, row.queue, row.day, row.post_id]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const charts = new Map();
  for (const rows of groups.values()) {
    const [{chat_id: chat}] = rows;
    try {
      const result = await sendSchedules(env, chat, rows, charts);
      if (result.status === 429) break;
      if (result.status === 403) {
        await env.DB.prepare("DELETE FROM subscribers WHERE chat_id = ?").bind(chat).run();
      } else if (result.ok) {
        await env.DB.batch(rows.map(row => env.DB.prepare(
          "DELETE FROM deliveries WHERE scope = ? AND day = ? AND queue = ? AND revision = ? AND chat_id = ?"
        ).bind(row.scope, row.day, row.queue, row.revision, chat)));
      } else {
        console.error("Telegram delivery failed", result.status);
      }
    } catch {
      console.error("Telegram delivery request failed");
    }
  }
}

const buttons = {
  "📅 Графік на сьогодні": "/today",
  "🔔 Увімкнути сповіщення": "/start",
  "⚙️ Обрати підчергу": "/queue",
  "🔕 Вимкнути сповіщення": "/stop",
  "❔ Довідка": "/help",
  "↩️ Назад": "/help",
};
const menu = {
  keyboard: [
    ["📅 Графік на сьогодні"],
    ["⚙️ Обрати підчергу", "❔ Довідка"],
    ["🔔 Увімкнути сповіщення", "🔕 Вимкнути сповіщення"],
  ],
  resize_keyboard: true,
  is_persistent: true,
};
const queuePicker = {
  ...menu,
  keyboard: [
    queues.slice(0, 4).map(queue => "Підчерга " + queue),
    queues.slice(4, 8).map(queue => "Підчерга " + queue),
    queues.slice(8).map(queue => "Підчерга " + queue),
    ["↩️ Назад"],
  ],
};

export default {
  async scheduled(_event, env) {
    try {
      await updateSchedules(env);
    } finally {
      await deliver(env);
    }
  },
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/telegram" || request.method !== "POST") {
      return new Response("Not found", {status: 404});
    }
    if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("Forbidden", {status: 403});
    }
    const {message} = await request.json();
    if (message?.chat?.type !== "private") return new Response("OK");
    const chat = message.chat.id;
    const input = (message.text ?? "").trim();
    const queueButton = /^Підчерга ([1-6]\.[12])$/u.exec(input);
    const action = queueButton ? "/queue " + queueButton[1]
      : Object.hasOwn(buttons, input) ? buttons[input] : input;
    const [address, ...args] = action.split(/\s+/u);
    const command = address.split("@")[0];
    if (command === "/start") {
      const subscriber = await env.DB.prepare(
        "INSERT INTO subscribers (chat_id) VALUES (?) ON CONFLICT(chat_id) DO UPDATE SET chat_id = excluded.chat_id RETURNING queue"
      ).bind(chat).first();
      await send(env, chat, "Підписка активна. Твоя підчерга — " + subscriber.queue +
        ". Щоб змінити її, натисни «Обрати підчергу».", menu);
      await showToday(env, chat, subscriber.queue);
    } else if (command === "/today") {
      const subscriber = await env.DB.prepare("SELECT queue FROM subscribers WHERE chat_id = ?").bind(chat).first();
      if (subscriber) await showToday(env, chat, subscriber.queue);
      else await send(env, chat, "Щоб побачити свій графік, спочатку обери підчергу.", queuePicker);
    } else if (command === "/queue") {
      if (args.length === 0) {
        const subscriber = await env.DB.prepare("SELECT queue FROM subscribers WHERE chat_id = ?").bind(chat).first();
        await send(env, chat, subscriber
          ? "Твоя підчерга — " + subscriber.queue + ". Натисни на потрібну підчергу, щоб змінити її."
          : "Підписка вимкнена. Вибери підчергу, щоб увімкнути сповіщення.", queuePicker);
      } else if (args.length === 1 && queues.includes(args[0])) {
        await env.DB.prepare(
          "INSERT INTO subscribers (chat_id, queue) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET queue = excluded.queue"
        ).bind(chat, args[0]).run();
        await send(env, chat, "Підчерга " + args[0] + " збережена. Надсилатиму оновлення обох графіків для неї.", menu);
        await showToday(env, chat, args[0]);
      } else {
        await send(env, chat, "Введи підчергу від 1.1 до 6.2. Наприклад, /queue 3.1.", queuePicker);
      }
    } else if (command === "/stop") {
      await env.DB.prepare("DELETE FROM subscribers WHERE chat_id = ?").bind(chat).run();
      await send(env, chat, "Підписку вимкнено.", menu);
    } else if (command === "/help") {
      await send(env, chat, [
        "Бот повідомляє про зміни в обласному й тимчасовому уманському графіках.",
        "🔔 Увімкнути сповіщення (/start) — підписка з підчергою 2.2 за замовчуванням.",
        "📅 Графік на сьогодні (/today) — показати збережені години для твоєї підчерги.",
        "⚙️ Обрати підчергу (/queue) — показати поточну підчергу та вибрати іншу.",
        "🔕 Вимкнути сповіщення (/stop) — відписатися від розсилки.",
      ].join("\n\n"), menu);
    }
    return new Response("OK");
  },
};
