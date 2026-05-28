-- Migration 006: Senior flag for the helper rotation
-- Marks "senior" helpers so the rotation algorithm can prefer
-- Senior + Junior pairings.

ALTER TABLE helpers ADD COLUMN IF NOT EXISTS is_senior BOOLEAN NOT NULL DEFAULT FALSE;

-- After running this migration, flag senior helpers via Supabase Studio:
--   UPDATE helpers SET is_senior = TRUE WHERE name IN ('Helper A', 'Helper B', ...);
