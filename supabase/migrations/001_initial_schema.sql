-- Jungschar Bot Database Schema
-- Initial migration

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Helfer (Helpers) table
CREATE TABLE helpers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  telegram_user_id BIGINT UNIQUE,
  telegram_username TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events table (imported from ICS)
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_date DATE NOT NULL UNIQUE,
  title TEXT,
  description TEXT,
  imported_at TIMESTAMPTZ DEFAULT NOW()
);

-- Assignments table (who is assigned to which event)
CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  helper_id UUID REFERENCES helpers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, helper_id)
);

-- Event status table
CREATE TABLE event_status (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE UNIQUE,
  idea_ready BOOLEAN DEFAULT FALSE,
  food_communicated BOOLEAN DEFAULT FALSE,
  all_ready BOOLEAN DEFAULT FALSE,
  needs_help BOOLEAN DEFAULT FALSE,
  help_note TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reminder log table (to avoid duplicate reminders)
CREATE TABLE reminder_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL, -- 'week_start', 'mid_week', 'final', 'help_needed'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, reminder_type)
);

-- Ideas table (AI-generated and saved ideas)
CREATE TABLE ideas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  material TEXT,
  was_used BOOLEAN DEFAULT FALSE,
  rating TEXT, -- 'good', 'okay', 'not_good'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Children table (for birthday reminders)
CREATE TABLE children (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  birthday DATE,
  notes TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settings table (for configuration like weather location)
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO settings (key, value) VALUES
  ('weather_location', 'Berlin,DE'),
  ('group_chat_id', ''),
  ('reminder_enabled', 'true');

-- Create indexes for better query performance
CREATE INDEX idx_events_date ON events(event_date);
CREATE INDEX idx_assignments_event ON assignments(event_id);
CREATE INDEX idx_assignments_helper ON assignments(helper_id);
CREATE INDEX idx_helpers_telegram ON helpers(telegram_user_id);
CREATE INDEX idx_children_birthday ON children(birthday);
CREATE INDEX idx_reminder_log_event ON reminder_log(event_id);

-- Row Level Security (RLS) policies
-- For now, we'll keep it simple - service role has full access
-- Mini App will validate users via Telegram initData

ALTER TABLE helpers ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for bot and Edge Functions)
CREATE POLICY "Service role has full access to helpers" ON helpers FOR ALL USING (true);
CREATE POLICY "Service role has full access to events" ON events FOR ALL USING (true);
CREATE POLICY "Service role has full access to assignments" ON assignments FOR ALL USING (true);
CREATE POLICY "Service role has full access to event_status" ON event_status FOR ALL USING (true);
CREATE POLICY "Service role has full access to reminder_log" ON reminder_log FOR ALL USING (true);
CREATE POLICY "Service role has full access to ideas" ON ideas FOR ALL USING (true);
CREATE POLICY "Service role has full access to children" ON children FOR ALL USING (true);
CREATE POLICY "Service role has full access to settings" ON settings FOR ALL USING (true);
