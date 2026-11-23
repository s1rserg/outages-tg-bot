import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
function execute(sql) {
  const output = execFileSync("npx", [
    "wrangler", "d1", "execute", "outages-tg-bot", "--remote", "--json", "--command", sql,
  ], {cwd: root, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"]});
  const result = JSON.parse(output);
  if (!Array.isArray(result) || result.some(item => item.success === false)) {
    throw new Error("D1 returned an unsuccessful result");
  }
  return result.flatMap(item => item.results ?? []);
}

// Inspect the live schema because an older 0005.sql may already be recorded as applied.
const statements = readFileSync(new URL("../migrations/0005.sql", import.meta.url), "utf8")
  .split(";").map(sql => sql.trim()).filter(Boolean);
for (const sql of statements) {
  const alter = /^ALTER TABLE (\w+) ADD COLUMN (\w+) /u.exec(sql);
  if (alter) {
    const [, table, column] = alter;
    const columns = execute("PRAGMA table_info(" + table + ")");
    if (!columns.length) throw new Error("Missing base table " + table + ". Apply migrations 0001–0004 first.");
    if (columns.some(item => item.name === column)) {
      console.log(table + "." + column + " already exists");
      continue;
    }
    execute(sql);
    console.log("Added " + table + "." + column);
  } else {
    execute(sql.replace(/^CREATE TABLE /u, "CREATE TABLE IF NOT EXISTS "));
    console.log("Verified table " + /^CREATE TABLE (\w+)/u.exec(sql)[1]);
  }
}
execute("SELECT reminders FROM subscribers LIMIT 1");
execute("SELECT day_complete FROM schedules LIMIT 1");
execute("SELECT post_id,scope,day,queue,hours,published,is_update FROM schedule_sources LIMIT 1");
execute("SELECT chat_id,day,queue,start FROM reminder_sent LIMIT 1");
console.log("Schema is ready. Existing subscriptions and schedules have been preserved.");
