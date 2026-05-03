-- Migration 007: Persistente Verbindung Event ↔ Telegram-Rotation-Nachricht
-- Erlaubt es, beim Helfer-Tausch im Mini-App die in der Gruppe gepinnte
-- Übersichts-Nachricht automatisch zu editieren.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS rotation_message_id BIGINT,
  ADD COLUMN IF NOT EXISTS rotation_chat_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_events_rotation_message
  ON events(rotation_message_id)
  WHERE rotation_message_id IS NOT NULL;
