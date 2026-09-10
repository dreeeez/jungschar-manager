-- Abend-Bewertung per DM: Bot pingt die Admins am Tag der Jungschar um
-- 20:00 und führt sie durch Sterne → Drinnen/Draußen → Freitext.
--
-- review_pings merkt sich pro Termin und Empfänger die gesendete DM
-- (für das spätere Bearbeiten, wenn der andere schon bewertet hat) und
-- den Stand des Dialogs.
CREATE TABLE IF NOT EXISTS review_pings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  message_id BIGINT,
  -- stars → place → text → done | closed (anderer hat bewertet)
  state TEXT NOT NULL DEFAULT 'stars',
  stars SMALLINT,
  place TEXT,
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (event_id, telegram_user_id)
);

-- RLS an, keine Policy: nur der Service-Key kommt ran.
ALTER TABLE review_pings ENABLE ROW LEVEL SECURITY;

-- Wetter zum Eintrag: wird beim Speichern automatisch aus Open-Meteo geholt.
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS weather_description TEXT;
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS temperature NUMERIC(4,1);
