-- Fotos zur Jungschar: Helfer schicken Bilder privat an den Bot, der Bot
-- merkt sich nur die Telegram-Verweise (file_id) und ordnet sie dem Termin
-- des Tages zu. Admins posten sie mit /senden als Album in die Elterngruppe.
CREATE TABLE IF NOT EXISTS event_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  file_unique_id TEXT NOT NULL UNIQUE,
  sent_by_telegram_id BIGINT,
  sent_by_name TEXT,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_photos_event_idx ON event_photos (event_id, posted_at);

ALTER TABLE event_photos ENABLE ROW LEVEL SECURITY;
