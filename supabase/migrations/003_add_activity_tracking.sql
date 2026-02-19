-- Migration 003: Activity Tracking
-- Adds source column to ideas table for tracking how activities were captured

-- Add source column: 'elterngruppe' | 'manual'
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';

-- Index for efficient querying by event
CREATE INDEX IF NOT EXISTS idx_ideas_event_id ON ideas(event_id);

-- Allow anon key (client-side admin UI) to read and insert ideas
DROP POLICY IF EXISTS "Anon can read ideas" ON ideas;
CREATE POLICY "Anon can read ideas"
  ON ideas FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anon can insert ideas" ON ideas;
CREATE POLICY "Anon can insert ideas"
  ON ideas FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Anon can update ideas" ON ideas;
CREATE POLICY "Anon can update ideas"
  ON ideas FOR UPDATE USING (true);
