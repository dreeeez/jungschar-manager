-- Migration 005: Rating + Tags auf ideas
-- Erlaubt Bewertung 1-5 und Tags drinnen/draußen pro Aktivität.

ALTER TABLE ideas ADD COLUMN IF NOT EXISTS rating SMALLINT
  CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5));

ALTER TABLE ideas ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::TEXT[];
