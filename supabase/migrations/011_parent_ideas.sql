-- Eltern-Befehle im Bot: /idee legt Vorschläge in ideas ab, dazu wer sie
-- eingereicht hat. /essen trägt den Elterndienst über parent_duties ein
-- (keine Schema-Änderung nötig).
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS suggested_by TEXT;
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS suggested_by_telegram_id BIGINT;

-- Registrierungs-Code für /register wird in settings unter dem Key
-- 'register_code' gepflegt (Mini-App → Einstellungen). Ohne Wert ist die
-- Registrierung geschlossen.
