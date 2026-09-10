-- Season-Reset September 2026 (einmalig, im Supabase-Studio ausführen).
--
-- 1) Sechs Herbst-Termine, die im Kalender-Feed nicht mehr existieren
--    (Drift-Warnung auf der Bot-Status-Seite).
-- 2) Sieben vergangene Termine ohne Archiv-Eintrag (Archiv soll nur den
--    02.05. behalten).
--
-- assignments, reminder_log, attendance_votes, event_status, review_pings
-- hängen mit ON DELETE CASCADE an events. parent_duties wurde von Hand
-- angelegt, deshalb sicherheitshalber vorher explizit löschen.
-- ideas hängt mit ON DELETE SET NULL, ein Eintrag ginge also nicht verloren
-- (die genannten Termine haben keinen).
BEGIN;

WITH victims AS (
  SELECT id FROM events
  WHERE event_date IN (
    '2026-10-03', '2026-10-10', '2026-10-24', '2026-11-14', '2026-12-05', '2026-12-12',
    '2026-05-09', '2026-06-13', '2026-06-20', '2026-06-27', '2026-07-04', '2026-07-11', '2026-09-04'
  )
)
DELETE FROM parent_duties WHERE event_id IN (SELECT id FROM victims);

DELETE FROM events
WHERE event_date IN (
  '2026-10-03', '2026-10-10', '2026-10-24', '2026-11-14', '2026-12-05', '2026-12-12',
  '2026-05-09', '2026-06-13', '2026-06-20', '2026-06-27', '2026-07-04', '2026-07-11', '2026-09-04'
);

COMMIT;

-- Kontrolle: sollte nur 2026-05-02 und die Termine ab 26.09. zeigen.
-- SELECT event_date FROM events WHERE event_date >= '2026-05-01' ORDER BY event_date;
