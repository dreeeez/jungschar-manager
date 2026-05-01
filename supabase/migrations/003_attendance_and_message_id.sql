-- Persist attendance votes from the Wednesday inline-button poll,
-- and remember the message_id of the Wednesday reminder so we can
-- reply to it from the Thursday non-voter ping.

CREATE TABLE IF NOT EXISTS attendance_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  helper_id UUID NOT NULL REFERENCES helpers(id) ON DELETE CASCADE,
  attending BOOLEAN NOT NULL,
  voted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, helper_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_votes_event ON attendance_votes(event_id);
CREATE INDEX IF NOT EXISTS idx_attendance_votes_helper ON attendance_votes(helper_id);

ALTER TABLE attendance_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role has full access to attendance_votes"
  ON attendance_votes FOR ALL USING (true);

ALTER TABLE reminder_log
  ADD COLUMN IF NOT EXISTS message_id BIGINT;
