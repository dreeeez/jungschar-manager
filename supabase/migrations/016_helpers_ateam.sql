-- Migration 016: A-Team (Work and Travel) für die Einteilung
-- A-Team-Helfer kommen nur gemeinsam als Duo dran, nie mit anderen.

ALTER TABLE helpers ADD COLUMN IF NOT EXISTS is_ateam BOOLEAN NOT NULL DEFAULT FALSE;

-- Michael Ignat und Torkil Lindberg
UPDATE helpers SET is_ateam = TRUE WHERE telegram_user_id IN (1372058075, 257536320);
