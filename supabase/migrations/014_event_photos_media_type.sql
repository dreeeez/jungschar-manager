-- Fotos UND Videos: event_photos merkt sich jetzt die Art des Mediums, damit
-- /send Alben aus beidem bauen kann.
ALTER TABLE event_photos
  ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'photo'
  CHECK (media_type IN ('photo', 'video'));

-- Telegram-Album (media_group_id), damit „Alle rauswerfen“ unter der
-- Bestätigung das ganze Album auf einmal entfernen kann.
ALTER TABLE event_photos
  ADD COLUMN IF NOT EXISTS media_group_id TEXT;

-- /idee mit Bild: Telegram-file_id des Bildes zur Idee (ein Bild pro Idee).
ALTER TABLE ideas
  ADD COLUMN IF NOT EXISTS photo_file_id TEXT;
