ALTER TABLE subscribers ADD COLUMN reminders INTEGER NOT NULL DEFAULT 0;
ALTER TABLE schedules ADD COLUMN day_complete INTEGER NOT NULL DEFAULT 0;
CREATE TABLE schedule_sources (
  post_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  queue TEXT NOT NULL,
  hours TEXT NOT NULL,
  published TEXT NOT NULL,
  is_update INTEGER NOT NULL,
  PRIMARY KEY(post_id, scope, day, queue)
);
CREATE TABLE reminder_sent (
  chat_id INTEGER NOT NULL REFERENCES subscribers(chat_id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  queue TEXT NOT NULL,
  start TEXT NOT NULL,
  PRIMARY KEY(chat_id, day, queue, start)
);
