-- Insert iCal URL into settings table
INSERT INTO settings (key, value)
VALUES ('ical_url', 'https://widgets.bcc.no/ical-6fde3e99feb95d9f/40711/Portal-Calendar.ics')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;
