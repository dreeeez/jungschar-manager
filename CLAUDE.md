# Jungschar Manager Bot

Telegram-Bot + Mini-App, der eine Jungschar-Helfer-Gruppe organisiert: wöchentliche Reminder, Vote-Tracking, Eltern-Verwaltung, Geburtstage, Wettervorhersage, alles in einer Telegram-Gruppe.

## Tech-Stack

- **Next.js 14** (App Router) — Mini-App UI + API-Routes
- **TypeScript** strict
- **Supabase** Postgres + service-role key (server-side only)
- **grammy** als Telegram-Bot-Framework (`/api/telegram` ist der Webhook-Endpoint)
- **Open-Meteo** für Wetter (kein API-Key, WMO-Codes)
- **Vercel** Hosting + Cron
- **Telegram Mini App SDK** im Frontend (`@telegram-apps/sdk`)

## Architektur

```
src/
  app/              Next.js Routes
    api/
      cron/
        reminder/         Stage 1/2/3 Reminder
        poll-reminder/    Donnerstag Nicht-Voter Ping
      telegram/           Webhook-Endpoint (grammy)
    helpers/        Mini-App: Helfer-Liste (read-only, Registrierung via /register)
    parents/        Mini-App: Eltern-Verwaltung (Name + Telegram-Tag)
    children/       Mini-App: Kinder + Geburtstage
    calendar/       Mini-App: Termine, Zuweisungen, Aktivitäten-Tracking
    ideas/          Mini-App: Aktivitäten-History
    ideen/          Mini-App: Ideenpool nur lesend, einzige Seite für Helfer
    settings/       Mini-App: Wetter-Ort, ICS-Upload
    api/idea-photo/ Bild einer /idee oder eines /bug aus Telegram durchreichen (Session nötig)
    feedback/       Mini-App: Meldungen aus /bug, abhaken (nur Admins)
  components/ui.tsx UI-Bausteine der Mini-App (Page mit Seitenfarbe, Karten, Badges, Sheet, Icons) — keine Emojis in der UI
  services/         Server-side Business-Logik
    reminders.ts          Reminder-Engine (Stage 1/2/3)
    poll-reminder.ts      Donnerstag-Ping mit 20 Templates
    bot-commands.ts       Telegram-Befehle + Callback-Handler
    helpers.ts / parents.ts / events.ts / attendance.ts / weather.ts
    database.ts           Supabase-Client (Service-Role)
  types/            DB-Types (manuell gepflegt, mirror der Supabase-Schemas)
  utils/            formatDate, getDaysUntil, etc.
supabase/
  migrations/       SQL-Migrations (manuell im Supabase-Studio ausführen)
  seed/ideenpool.json  Ideenpool aus dem Elternchat-Export (2020–2026)
scripts/
  import-ideenpool.mjs  Import der Seed-Datei in `ideas` (Upsert nach Titel, --dry-run)
```

## Reminder-System

Vier zeitlich gestaffelte Reminder-Pings, alle vom täglichen Vercel-Cron `0 8 * * *` (UTC) bzw. `0 16 * * 4` (Donnerstag, UTC).

| Wann | Endpoint | Stage | Inhalt |
|---|---|---|---|
| Sonntag 5–8 Tage vor Event (Fr- und Sa-Termine) | `/api/cron/reminder` (Stage 1) | `stage1_sunday` | Heads-up — 7 rotierende Themes (Spy, Glaskugel, Wettervorhersage, Spotify Wrapped, Stadion, Festival, Mission Control) + fester Top-Header `+++ HEADS-UP +++` (kurz, sonst bricht er am Handy um). Essen nur bei Samstags-Terminen: `🏠 Einladung: Familie X lädt uns zu sich ein` (per `/invite`), sonst `🍽️ Essen: Familie X` (Elterndienst aus der Mini-App), sonst rotierend „Essen: diesmal von uns selbst. Werdet kreativ oder freimütig“. Danach als **eigene Nachricht** „💡 Frische Ideen von den Eltern“ (nur wenn es welche gibt): alle `/idee`-Einträge (`source='elterngruppe'`) seit der letzten Live-Nachricht Stage 1 oder 2 (`reminder_log.sent_at`, ohne frühere seit dem vorigen Termin) mit Name, Zeit und Text (gekürzt auf 300 Zeichen, 📷 bei Bild), Link „Alle Ideen im Ideenpool“ (`t.me/<bot>?startapp=ideen`, braucht die bei BotFather aktivierte Haupt-Mini-App), dahinter die Bilder als Album mit Name und Text als Caption |
| Mittwoch 2–4 Tage vor Event (Fr- und Sa-Termine) | `/api/cron/reminder` (Stage 2) | `stage2_wednesday` | `++ 🔥 Countdown: N Tage 🔥 ++` (nur zwei Plus, sonst Umbruch am Handy) mit Vote-Buttons (votey/votec/voten), kompakter Checkliste, ohne Essen. Danach wie bei Stage 1 die eigene Nachricht „Frische Ideen von den Eltern“, wenn seit dem Sonntag neue reinkamen |
| Donnerstag 18:00 lokal | `/api/cron/poll-reminder` | (separates Cron) | Tagged Helfer ohne Vote-Eintrag, replyt zur Mittwochs-Nachricht. 20 rotierende `+++ … +++` Templates |
| Tag des Events 20:00 lokal | `/api/cron/review-ping` (Crons 18:00 + 19:00 UTC, sendet nur wenn Berlin ≥ 20 Uhr) | `review_pings` | DM an jede ID der Zugangsliste: Sterne-Buttons → Drinnen/Draußen → Freitext. Ergebnis wird `ideas`-Eintrag (`source='bot'`, Rating, Tag, Wetter). Sobald einer fertig ist, werden die DMs der anderen bearbeitet („X hat bereits bewertet“). Logik in `services/review-ping.ts`, Test: `?test=1&date=YYYY-MM-DD[&user=<id>]` |
| Tag des Events 20:00 lokal | `/api/cron/review-ping` (derselbe Lauf) | `thanks_photos` | Danke in die Helfer-Gruppe (6 rotierende Templates, ohne Namen und Tags) + URL-Button „Momente festgehalten?“ → privater Chat mit dem Bot (`?start=fotos`). Nicht, wenn der Termin aus dem Kalender verschwunden ist. Im Test (`?test=1`) in die Sandbox, ohne Log |
| Samstag morgen (Tag des Events) | `/api/cron/reminder` (Stage 3) | `stage3_saturday` | Aufwacher mit 6 rotierenden Themes + 18 rotierenden Bibelversen + festem `Ihr schafft das! Viel Spaß und Gottes Segen` Closing. Top-Header rotiert zwischen `+++ HEUTE / JUNGSCHAR-DAY / GAME ON / SHOWTIME / T-0 / DER TAG +++` |

Schedule-Logik in `services/reminders.ts:processReminders()`:
- Stage 1: `dayOfWeek === 0 && daysUntil ∈ [5,8]` (5 = Freitag, 6 = Samstag)
- Stage 2: `dayOfWeek === 3 && daysUntil ∈ [2,4]` (2 = Freitag, 3 = Samstag)
- Stage 3: `daysUntil === 0` (event day, weekday-unabhängig)

`services/status.ts` spiegelt die Fenster (Bot Health). Warnungen u. a., wenn das Sonntags-Heads-up eines der nächsten 5 Termine fehlt (Sonntag vorbei oder kein Sonntag im Fenster) oder die Einteilung des nächsten Termins nur in der Sandbox gepostet ist.

`reminder_log` mit UNIQUE(event_id, reminder_type) verhindert Duplikate. **Testläufe (`?test=N`) loggen nicht**: ein Test-Eintrag würde den Live-Send desselben Termins unterdrücken und die Ideen-Liste („seit dem letzten Heads-up“) verschieben.

## Halbjahres-Einteilung

Kein Automatismus. Button „Halbjahr einteilen“ im Kalender (`services/rotation.ts`):
- Fenster: HJ 1 = heute bis Ende Februar (ab September), HJ 2 = heute bis Ende August (ab März). Alle Termine im Fenster.
- Paare: immer Senior + Junior (`helpers.is_senior`). Zwei Senioren nur, wenn ein Senior mindestens einen Einsatz zurückliegt. Zwei Junioren nie, sonst wird der Termin übersprungen.
- Fair: pro Halbjahr gleich oft, Zähler startet bei 0, Vergangenheit zählt nicht. Gleichstände werden zufällig aufgelöst (wer beim vorherigen Termin dran war, wird gemieden), jeder Klick auf „Halbjahr einteilen“ liefert also eine neue Verteilung.
- Ablauf: „Halbjahr einteilen“ → erst abfragen, wer zuletzt Jungschar gemacht hat (vorausgewählt: Team des letzten vergangenen Termins; zählt als ein Einsatz, kommt beim ersten Termin nicht dran) → berechnen (`POST /api/rotation/preview { lastHelperIds }`), Vorschau mit Namen tauschen, „Nachricht ansehen“ (`POST /api/rotation/message`), „Neu berechnen“ → „Speichern und posten …“ → Chat wählen: Sandbox oder Helfer-Gruppe (`/api/rotation/commit[?test=1]` mit `proposals`: Zuweisungen der Termine **ersetzen**, posten, pinnen).
- „Gespeicherte Einteilung posten“: postet den aktuellen Stand ohne Neuberechnung (`/api/rotation/commit[?test=1]` ohne Body), Chat wählbar. Helfer-Tausch im Termin-Sheet editiert die gepinnte Nachricht (`rotation_message_id`). Lehnt Telegram ab, antwortet commit mit Fehler.
- Bei Termin-Ausfall rückt der Reminder-Cron die Duos weiter (`shiftRotationOnCancellation`).

## Elterndienst (Essen)

Nur an **Samstags**-Terminen (`utils/format.ts:hasFoodDuty`). Freitags bekommen wir immer Essen: keine Essen-Zeile in den Remindern, der Kalender blendet den Elterndienst aus. Samstags zeigt nur das Sonntags-Heads-up das Essen (Einladung → Elterndienst → selbst organisieren, siehe Tabelle oben); Stage 2 und 3 erwähnen Essen nicht.

Button „Eltern einteilen (Essen, Samstage)“ im Kalender (`services/parent-rotation.ts`): alle Samstage im Halbjahres-Fenster, aktive Eltern reihum in gemischter Reihenfolge (wer zuletzt dran war, nicht als Erstes) → Vorschau mit Namen tauschen, „Neu berechnen“ (`POST /api/rotation/parents/preview`) → „Speichern“ (`POST /api/rotation/parents/commit { proposals: [{ eventId, parentId }] }`) **ersetzt** `parent_duties` dieser Samstage. Es wird nichts gepostet.

## Vote-Tracking

Mittwoch-Stage-2 sendet Inline-Buttons `votey_<event_id>` (Bin dabei) / `votec_<event_id>` (Dabei mit Auto) / `voten_<event_id>` (Kann nicht). Klick:
1. Webhook-Handler in `services/bot-commands.ts` parst die Nachricht (✅ Dabei / 🚗 Mit Auto / ❌ Absagen Zeilen) und re-rendert sie mit dem Klicker-Namen. Nachrichten ohne 🚗-Zeile (vor der Änderung gesendet) bleiben unverändert.
2. Persistiert den Vote in `attendance_votes` via `recordVote()` („mit Auto“ = `attending=true`, das Auto steht nur in der Nachricht) — Vote-Status lebt also doppelt: in der editierten Nachricht UND in der DB.
3. Donnerstags-Cron liest `attendance_votes` um Nicht-Voter zu finden.

## Database-Quirk

`reminder_log.message_id` wird beim Live-Mittwochs-Send mit der Telegram-`message_id` befüllt — der Donnerstags-Cron benutzt sie für `reply_to_message_id`. Der Donnerstags-Test (`poll-reminder?test=1`) fällt ohne Live-Mittwoch auf den nächsten Termin zurück, ohne Antwort auf eine Nachricht.

`getBirthdaysAroundEvent()` liefert Kinder mit Geburtstag ±3 Tage um das Event-Datum, Format `▶ 🎂 Name wird X (Tag. Mon.)` pro Kind. Nur Stage 1 + 2 zeigen Geburtstage, Stage 3 nicht.

Info-Zeilen in Stage 1 + 2 beginnen mit `▶` (Datum · Wetter, Team, Essen, Geburtstage); Checkliste und Vote-Block nicht. Datum mit kurzem Monat (`formatDateShortMonth`: „Samstag, 31. Okt.“). Stage 1 hat in allen 7 Themes denselben Info-Block (`stage1Info`), nur Header, Team-Label und Closing wechseln.

## Wetter

`weather.ts:getWeatherForecast()` zieht Open-Meteo **Stundenwerte** für 17:00 + 18:00 (Jungschar-Zeit), nicht das 24h-Tagesmin/-max. Sonst wäre die Spanne 6–25°C statt z.B. 22°C. WMO-Code → Emoji-Mapping in `weatherEmoji()`. Bei `temperature_max <= 2` gewinnt 🥶 unabhängig vom Code.

## Testing-Workflow

Reminder-Routes akzeptieren `?test=N`:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://<preview-url>/api/cron/reminder?test=1"     # Stage 1 → test chat
curl -H "..." "https://<preview-url>/api/cron/reminder?test=2&live=1"  # Stage 2 → LIVE chat
```

`?test=1|2|3` routet in `TELEGRAM_TEST_CHAT_ID`, `&live=1` zwingt in `TELEGRAM_CHAT_ID`. Vercel-Preview-URLs sind hinter Deployment-Protection — `&x-vercel-protection-bypass=<TOKEN>` anhängen (Token aus Vercel Settings → Deployment Protection → Protection Bypass for Automation).

**Achtung:** jeder Aufruf sendet eine echte Telegram-Message. Niemals in einer Schleife pollen, um Deploy-Status zu checken — Vercel-MCP nutzen.

## Deployment-Topology

- `main` = **Production**, deployed an `jungschar-manager-bot-mini-app.vercel.app`. Telegram-Webhook und Mini-App-URL bei @BotFather zeigen hierhin.
- `dev` = langlebiger Staging-Mirror, manuell auf `main` rebased.
- Feature-Branches → automatische Preview-URLs (`<project>-git-<short>-<team>.vercel.app`).
- Vercel-Cron läuft **nur auf Production**. Preview-Deployments triggern keine Crons.

## Ideen teilen

Ideenpool → Button „Ideen in Helfer-Gruppe teilen“ (nur Admins) → bis zu 10 Ideen antippen → Leiste unten „In Helfer-Gruppe teilen“ (oder „Test“ → Sandbox). `POST /api/pool/share { ids, test }` prüft Session-Admin und postet eine knappe Nachricht (`services/pool-share.ts`: Titel, Tags, gekürzter Inhalt, Mitbringen, „von X“). Keine Umfrage.

## Offene Punkte

- **Fotos gehen vorläufig in die Sandbox.** `PHOTOS_GO_TO_SANDBOX = true` in `services/photos.ts` lenkt `/send` in `TELEGRAM_TEST_CHAT_ID`, weil der Bot die Elterngruppe „Elternjet“ verlassen hat. Sobald der Bot wieder in der Elterngruppe ist (prüfen mit `node scripts/check-chats.mjs`): Konstante auf `false`, ggf. neue Chat-ID in `TELEGRAM_ELTERN_CHAT_ID`, falls Telegram die Gruppe zur Supergruppe gemacht hat. Der Geburtstagsgruß zielt weiterhin direkt auf `TELEGRAM_ELTERN_CHAT_ID` und läuft bis dahin ins Leere.

## Bot-Befehle und Rollen

`services/bot-commands.ts` prüft pro Befehl die Rolle: Admin (Zugangsliste `admins.ts`), Helfer (`helpers`), Elternteil (`parents` per `telegram_user_id` oder `telegram_username`, Logik in `services/parents-bot.ts`).

| Befehl | Wer | Was |
|---|---|---|
| `/start`, `/help` | alle | rollenabhängige Begrüßung/Übersicht; Admins bekommen den Menü-Button „Admin“ (Mini-App) |
| `/register CODE` | unbekannt, privat | Code = `settings.register_code` (Einstellungen). Leer = Registrierung geschlossen |
| `/next`, `/status`, `/mystatus` | Helfer | Termine mit Team, eigene Einsätze |
| `/termine` | Eltern + Helfer | nächste Termine ohne Team |
| `/idee` | Eltern + Helfer, privat | Freitext, Link oder Bild mit Bildunterschrift → `ideas` (event_id null, was_used=false, `source='elterngruppe'`, `suggested_by`, `photo_file_id`); Bild ohne Text wird zurückgefragt, ein Bild pro Idee. Bleibt dauerhaft im Ideenpool als „Vorschlag von X“ (Bild via `/api/idea-photo?id=`, Links anklickbar) und erscheint einmalig im nächsten Sonntags-Heads-up (📷 bei Bild) |
| `/invite` (alt: `/einladen`) | Eltern, privat | „Kommt zu uns“, nur Buttons und nur für die **nächste Samstags-Jungschar** (keine Terminauswahl): frei → Ja/Nein (`invy_`/`invn_`) → `invitations`; schon vergeben → „Zu spät, jemand anderes war schneller“; selbst eingeladen → „Einladung zurückziehen“ (`invx_<event_id>`, Termin wird wieder frei). Eine Einladung pro Termin, wer zuerst kommt. Marco und Jens (Zugangsliste) bekommen eine DM mit Team des Termins nur, wenn das Sonntags-Heads-up schon raus ist (Einladung oder Rückzug danach); Kalender zeigt „Einladung: Name“, das Sonntags-Heads-up des Termins zeigt die Einladung in der Helfer-Gruppe. Der Elterndienst (`parent_duties`) bleibt davon unberührt |
| `/inspo` | Eltern + Helfer, privat | Spaß: Album mit drei „typischen“ Essen (Sterneküche, Sushi; Bilder in `public/inspo`, geladen von `APP_URL`), danach „Spaß! Es reicht etwas völlig Einfaches.“ Die Bestätigung nach `/invite` verweist darauf |
| `/bilder` | Helfer, privat | eigene noch nicht gepostete Fotos/Videos einzeln, je mit Button „Rauswerfen“ (`phx_<id>`, nur eigene) |
| `/review` | Admin, privat | alle noch nicht geposteten Fotos/Videos einzeln, je mit Button „Rauswerfen“ (`phx_<id>`, löscht die Zeile) |
| `/send` (alt: `/senden`) | Admin, privat | Rückfrage → Album(s) in die Elterngruppe, Caption mit Text, `/idee` (+ `/invite`, wenn die nächste Jungschar samstags ist). `/send test` → Sandbox ohne Markierung |
| `/bug` | Eltern + Helfer + Admins, privat | Fehler, Wunsch, Idee zu Bot/App: Text oder Screenshot mit Bildunterschrift → `feedback` (Migration 015: name, role, text, photo_file_id, done_at). Admins bekommen sofort eine DM; Mini-App → „Feedback“ (nur Admins): offene zuerst, „Erledigt“/„Wieder öffnen“, nichts wird gelöscht; Startseite zeigt „N offen“. Bild via `/api/idea-photo?kind=feedback&id=` |
| `/chatid` | Admin | Chat-ID |

**Grundsatz Eltern:** der Bot schreibt Eltern nie aktiv per DM an. Eltern schreiben dem Bot (`/idee`, `/invite`, `/inspo`, `/termine`); Gruppen-Posts in die Elterngruppe (Fotos, Geburtstagsgruß) sind davon unberührt. Bewertung (review-ping) nur Admins, Fotos nur Helfer.

Fotos und Videos (`services/photos.ts`, Tabelle `event_photos`, Migrationen 013 + 014 für `media_type` und `media_group_id`): abends 20:00 postet der review-ping-Cron die Danke-Nachricht mit dem Button „Momente festgehalten?“ in die Helfer-Gruppe. Der Button führt in den privaten Chat (ein Bot kann die Galerie nicht selbst öffnen); dort schicken nur Helfer/Admins Fotos und Videos → nur `file_id` + `media_type` (+ `media_group_id` bei Alben) gespeichert, zugeordnet zum Termin des Tages (bis 3 Tage danach); keine Info-DM an Admins beim Eingang. Unter der Bestätigung ein Button „Rauswerfen“ (`phu_<id>`) bzw. „Album rauswerfen“ (`phg_<media_group_id>`), Helfer nur eigene. Admins: `/review` (prüfen, rauswerfen), `/send` (Rückfrage → Album(s) à 10 in `TELEGRAM_ELTERN_CHAT_ID`, `posted_at` gesetzt; die Caption des ersten Albums = kurzer rotierender Text (6 Varianten) plus `/idee`-Zeile (6 Varianten) und `/invite`-Zeile (12 Varianten, nur wenn die nächste Jungschar an einem Samstag ist), beide als Direktlinks in den privaten Chat. Eine Nachricht, keine zweite Blase).

Geburtstagsgruß: der tägliche Reminder-Cron postet in `TELEGRAM_ELTERN_CHAT_ID` für Kinder mit Geburtstag heute, einmal pro Tag (`settings.last_birthday_greeting`).

## Wichtige Konventionen

- Keine inline AI/Gemini-Calls — wurde 2026-05-01 entfernt (`ai-ideas.ts`, `activity-extractor.ts` weg).
- Helfer registrieren sich ausschließlich per `/register CODE` im Bot — kein manuelles Anlegen in der UI.
- Eltern-`telegram_username` ist optional; wenn gesetzt, taggt Stage 1 die Eltern in der Essen-Zeile (`Familie Müller @muellerfamily`).
- HTML-Mode bei `sendMessage`: nur `<b>`, `<i>`, `<a href="tg://user?id=...">`. Keine Markdown.
- Telegram-Webhook hört nur auf **eine** URL. Vote-Klicks im Test-Chat landen also auch auf Production — Vote-Logik nur via merge-to-main testbar (oder Webhook temporär umbiegen).

## Auth / Der Weg einer Anfrage

Der Browser kennt **keinen** Datenbank-Schlüssel. Jede Anfrage der Mini-App
läuft über den eigenen Server:

1. **Öffnen** — Telegram hängt ein signiertes `initData` an (wer, wann). Die
   Signatur ist mit dem Bot-Token gebildet, nur Telegram kann sie erzeugen.
2. **Anmelden** — `TelegramProvider` schickt es einmalig an `/api/auth/me`.
   Der Server rechnet die HMAC nach (`services/telegram-auth.ts`), prüft das
   Alter (max. 24 h) und bestimmt die Rolle: **admin** = Telegram-ID auf der
   Zugangsliste `ADMIN_TELEGRAM_USER_IDS` in `services/admins.ts` (ganze App),
   **helper** = nur in `helpers` registriert (einzige Seite `/ideen`, Ideenpool
   nur lesend). Weder noch: 403. Neuer Admin = ID in die Datei eintragen. Bei
   Erfolg: signiertes Cookie `app_session` mit Rolle, 24 h gültig.
   `TelegramProvider` schickt Helfer (und jeden, der per Deep-Link
   `t.me/<bot>?startapp=ideen` kommt) auf `/ideen`; Helfer bekommen bei
   `/start` den Menü-Button „Ideen“ (`APP_URL/ideen`), Admins „Admin“.
3. **Daten holen** — `lib/supabase.ts` zeigt auf `/api/db` statt auf Supabase.
   supabase-js spricht damit `/api/db/rest/v1/<tabelle>` an; der Proxy prüft
   das Cookie, filtert gegen eine Tabellen-Allowlist und reicht mit
   `SUPABASE_SERVICE_KEY` weiter. Helfer-Sessions dürfen nur `GET` auf
   `ideas`, alles andere 403. Die Seiten selbst blieben unverändert.
4. **Ohne Telegram** — kein initData, kein Cookie: 401. `TelegramProvider`
   rendert die Kinder gar nicht erst, sondern nur den Hinweis.

Alle API-Routen sind geschlossen. `services/api-guard.ts:requireOperator()`
akzeptiert entweder eine Admin-Session oder `Authorization: Bearer $CRON_SECRET`
und schützt `/api/status`, `/api/sync-ical` und `/api/rotation/*`. Die
`/api/cron/*`-Routen prüfen wie gehabt nur `CRON_SECRET`.

RLS (Migration 008): alle Tabellen haben RLS aktiv und **keine** Policy — das
sperrt `anon`/`authenticated` aus, während der Service-Key RLS ohnehin umgeht.
Die alten Policies aus 001/003 hießen zwar „Service role…", hatten aber keine
`TO`-Klausel und galten damit für `PUBLIC`, also auch für den öffentlichen
Anon-Key. Beim Anlegen neuer Tabellen: RLS anschalten, keine Policy schreiben.

## Env-Vars

Required (alle in `.env.local` für Dev, Vercel-Project-Settings für Preview/Prod):
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_TEST_CHAT_ID`
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (server-side; es gibt keine
  `NEXT_PUBLIC_SUPABASE_*` mehr — der Client geht über `/api/db`)
- `CRON_SECRET` (Bearer-Auth für `/api/cron/*` und `requireOperator`)

Optional:
- `TELEGRAM_WEBHOOK_SECRET` — wenn gesetzt, akzeptiert `/api/telegram` nur
  Updates mit passendem `x-telegram-bot-api-secret-token`. Erfordert ein
  erneutes `setWebhook` mit `&secret_token=<wert>`.
- `DEV_TELEGRAM_USER_ID` — nur `NODE_ENV !== 'production'`: erlaubt das
  lokale Öffnen der Mini-App ohne Telegram, für eine registrierte Helfer-ID.

## Schemas (kompakt)

```sql
helpers (id, name, telegram_user_id UNIQUE, telegram_username, is_admin)
events (id, event_date UNIQUE, title, description)
assignments (event_id, helper_id) UNIQUE(event_id, helper_id)
parents (id, name, telegram_username, active)
parent_duties (event_id, parent_id)
event_status (event_id UNIQUE, idea_ready, food_communicated, ...)
reminder_log (event_id, reminder_type, sent_at, message_id) UNIQUE(event_id, reminder_type)
attendance_votes (event_id, helper_id, attending, voted_at) UNIQUE(event_id, helper_id)
event_photos (event_id, file_id, file_unique_id UNIQUE, media_type 'photo'|'video', media_group_id, sent_by_telegram_id, sent_by_name, posted_at)
invitations (event_id UNIQUE, parent_id)
ideas (event_id, title, description, material, was_used, source, rating, tags[], suggested_by, photo_file_id, weather_description, temperature) — Archiv (event_id gesetzt, was_used=true) UND Ideenpool (event_id NULL, was_used=false, source='elterngruppe'|'manual'; tags = drinnen/draußen + Kategorien; suggested_by + created_at = wer/wann die Idee eingebracht hat, beim Import das Datum der ersten Chat-Nachricht)
review_pings (event_id, telegram_user_id, chat_id, message_id, state, stars, place, is_test) UNIQUE(event_id, telegram_user_id)
children (id, name, birthday, active)
settings (key UNIQUE, value)
feedback (telegram_user_id, name, role, text, photo_file_id, done_at)
```
