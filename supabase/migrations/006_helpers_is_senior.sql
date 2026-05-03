-- Migration 006: Senior-Flag für Helfer-Rotation
-- Markiert die "älteren" Helfer, damit der Rotations-Algorithmus
-- Senior+Junior-Pärchen bevorzugen kann.

ALTER TABLE helpers ADD COLUMN IF NOT EXISTS is_senior BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE helpers SET is_senior = TRUE
WHERE name IN (
  '<redacted-name>',
  '<redacted-name>',
  '<redacted-name>',
  'Marcus Schneider',
  '<redacted-name>'
);
