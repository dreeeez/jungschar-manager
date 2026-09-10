-- Eltern ohne Telegram-Username per Telegram-ID taggen.
--
-- Ein @username löst in der Gruppe eine Push-Benachrichtigung aus. Wer
-- keinen Username hat, ist trotzdem erreichbar: Telegram erlaubt Links
-- der Form <a href="tg://user?id=…">Name</a>, die ebenfalls benachrichtigen.
-- Die Reminder nutzen jetzt: @username, sonst ID-Link, sonst Klarname.
ALTER TABLE parents ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT;

-- Bekannte IDs eintragen (Stand 2026-09-10).
UPDATE parents SET telegram_user_id = 1053144763 WHERE name = 'Danny Sattler'  AND telegram_user_id IS NULL;
UPDATE parents SET telegram_user_id = 89549704   WHERE name = 'Maris Nitsche'  AND telegram_user_id IS NULL;
UPDATE parents SET telegram_user_id = 27505103   WHERE name = 'Prisca Kolb'    AND telegram_user_id IS NULL;
UPDATE parents SET telegram_user_id = 114435111  WHERE name = 'Salome Fächner' AND telegram_user_id IS NULL;
