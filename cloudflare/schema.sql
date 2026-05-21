CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  discord_webhook_url TEXT DEFAULT '',
  notify_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
  user_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  lecture_type TEXT DEFAULT '',
  mentor_name TEXT DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  location TEXT DEFAULT '',
  status TEXT DEFAULT '',
  detail_url TEXT DEFAULT '',
  cancelable INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_event_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_schedules_active_start
  ON schedules (is_active, starts_at);

CREATE TABLE IF NOT EXISTS notification_logs (
  user_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  offset_minutes INTEGER NOT NULL,
  channel TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, source_event_id, offset_minutes, channel)
);
