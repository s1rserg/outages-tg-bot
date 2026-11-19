DELETE FROM deliveries WHERE scope <> 'uman';
DELETE FROM schedules WHERE scope <> 'uman';
CREATE TABLE notices (
  post_id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  day TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE notice_deliveries (
  post_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  chat_id INTEGER NOT NULL REFERENCES subscribers(chat_id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, revision, chat_id)
);
CREATE TRIGGER notice_insert AFTER INSERT ON notices BEGIN
  INSERT INTO notice_deliveries SELECT NEW.post_id, NEW.revision, chat_id FROM subscribers;
END;
CREATE TRIGGER notice_change AFTER UPDATE OF revision ON notices
WHEN NEW.revision <> OLD.revision BEGIN
  DELETE FROM notice_deliveries WHERE post_id = NEW.post_id;
  INSERT INTO notice_deliveries SELECT NEW.post_id, NEW.revision, chat_id FROM subscribers;
END;
