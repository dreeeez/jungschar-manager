-- /bug im Bot: Fehler, Wünsche und Ideen zu Bot und App, von allen, die der
-- Bot kennt (Eltern, Helfer, Admins). Admins sehen sie in der Mini-App unter
-- „Feedback“ und haken sie ab. Nichts wird gelöscht, die Historie bleibt.
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  telegram_user_id BIGINT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'unbekannt',
  text TEXT NOT NULL,
  photo_file_id TEXT,
  done_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedback_open_idx ON feedback (done_at, created_at);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
