CREATE TABLE subscribers (chat_id INTEGER PRIMARY KEY);
CREATE TABLE schedules (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  hours TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (scope, day)
);
CREATE TABLE deliveries (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  revision INTEGER NOT NULL,
  chat_id INTEGER NOT NULL REFERENCES subscribers(chat_id) ON DELETE CASCADE,
  PRIMARY KEY (scope, day, revision, chat_id)
);
CREATE TRIGGER schedule_insert AFTER INSERT ON schedules BEGIN
  INSERT INTO deliveries SELECT NEW.scope, NEW.day, NEW.revision, chat_id FROM subscribers;
END;
CREATE TRIGGER schedule_change AFTER UPDATE OF revision ON schedules
WHEN NEW.revision <> OLD.revision BEGIN
  DELETE FROM deliveries WHERE scope = NEW.scope AND day = NEW.day;
  INSERT INTO deliveries SELECT NEW.scope, NEW.day, NEW.revision, chat_id FROM subscribers;
END;
