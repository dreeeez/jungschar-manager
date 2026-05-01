-- Eltern können einen Telegram-Username hinterlegen, damit sie aus
-- den Reminder-Nachrichten direkt anschreibbar sind. Optional —
-- nicht jede(r) Elternteil ist auf Telegram.

ALTER TABLE parents
  ADD COLUMN IF NOT EXISTS telegram_username TEXT;
