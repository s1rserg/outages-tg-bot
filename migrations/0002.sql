DROP TRIGGER schedule_insert;
DROP TRIGGER schedule_change;

ALTER TABLE subscribers ADD COLUMN queue TEXT NOT NULL DEFAULT '2.2';

ALTER TABLE schedules RENAME TO schedules_v1;
ALTER TABLE deliveries RENAME TO deliveries_v1;

CREATE TABLE schedules (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  queue TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  hours TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (scope, day, queue)
);
INSERT INTO schedules SELECT scope, day, '2.2', post_id, hours, revision FROM schedules_v1;

CREATE TABLE deliveries (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  queue TEXT NOT NULL,
  revision INTEGER NOT NULL,
  chat_id INTEGER NOT NULL REFERENCES subscribers(chat_id) ON DELETE CASCADE,
  PRIMARY KEY (scope, day, queue, revision, chat_id)
);
INSERT INTO deliveries SELECT scope, day, '2.2', revision, chat_id FROM deliveries_v1;

DROP TABLE deliveries_v1;
DROP TABLE schedules_v1;

CREATE INDEX subscribers_queue ON subscribers(queue);
CREATE INDEX deliveries_chat ON deliveries(chat_id);

CREATE TRIGGER subscriber_queue_change AFTER UPDATE OF queue ON subscribers
WHEN NEW.queue <> OLD.queue BEGIN
  DELETE FROM deliveries WHERE chat_id = NEW.chat_id;
END;

CREATE TRIGGER schedule_insert AFTER INSERT ON schedules BEGIN
  INSERT INTO deliveries
    SELECT NEW.scope, NEW.day, NEW.queue, NEW.revision, chat_id
    FROM subscribers WHERE queue = NEW.queue;
END;
CREATE TRIGGER schedule_change AFTER UPDATE OF revision ON schedules
WHEN NEW.revision <> OLD.revision BEGIN
  DELETE FROM deliveries WHERE scope = NEW.scope AND day = NEW.day AND queue = NEW.queue;
  INSERT INTO deliveries
    SELECT NEW.scope, NEW.day, NEW.queue, NEW.revision, chat_id
    FROM subscribers WHERE queue = NEW.queue;
END;
