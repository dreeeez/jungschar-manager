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
    settings/       Mini-App: Wetter-Ort, ICS-Upload
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
| Sonntag 6–8 Tage vor Event | `/api/cron/reminder` (Stage 1) | `stage1_sunday` | Heads-up — 7 rotierende Themes (Spy, Glaskugel, Wettervorhersage, Spotify Wrapped, Stadion, Festival, Mission Control) + rotierender `+++ NEWS / JUNGSCHAR INTEL / HEADS-UP / NÄCHSTE WOCHE / 📣 ANKÜNDIGUNG +++` Top-Header |
| Mittwoch 3–4 Tage vor Event | `/api/cron/reminder` (Stage 2) | `stage2_wednesday` | `+++ 🔥 Countdown: N Tage 🔥 +++` mit Vote-Buttons (votey/voten), kompakter Checkliste |
| Donnerstag 18:00 lokal | `/api/cron/poll-reminder` | (separates Cron) | Tagged Helfer ohne Vote-Eintrag, replyt zur Mittwochs-Nachricht. 20 rotierende `+++ … +++` Templates |
| Tag des Events 20:00 lokal | `/api/cron/review-ping` (Crons 18:00 + 19:00 UTC, sendet nur wenn Berlin ≥ 20 Uhr) | `review_pings` | DM an jede ID der Zugangsliste: Sterne-Buttons → Drinnen/Draußen → Freitext. Ergebnis wird `ideas`-Eintrag (`source='bot'`, Rating, Tag, Wetter). Sobald einer fertig ist, werden die DMs der anderen bearbeitet („X hat bereits bewertet“). Logik in `services/review-ping.ts`, Test: `?test=1&date=YYYY-MM-DD[&user=<id>]` |
| Samstag morgen (Tag des Events) | `/api/cron/reminder` (Stage 3) | `stage3_saturday` | Aufwacher mit 6 rotierenden Themes + 18 rotierenden Bibelversen + festem `Ihr schafft das! Viel Spaß und Gottes Segen` Closing. Top-Header rotiert zwischen `+++ HEUTE / JUNGSCHAR-DAY / GAME ON / SHOWTIME / T-0 / DER TAG +++` |

Schedule-Logik in `services/reminders.ts:processReminders()`:
- Stage 1: `dayOfWeek === 0 && daysUntil ∈ [6,8]`
- Stage 2: `dayOfWeek === 3 && daysUntil ∈ [3,4]`
- Stage 3: `daysUntil === 0` (event day, weekday-unabhängig)

`reminder_log` mit UNIQUE(event_id, reminder_type) verhindert Duplikate. Im Test-Modus wird upserted, nicht insert-only — sonst kannst du `?test=N` nicht mehrfach feuern.

## Halbjahres-Einteilung

Kein Automatismus. Button „Halbjahr einteilen“ im Kalender (`services/rotation.ts`):
- Fenster: HJ 1 = heute bis Ende Februar (ab September), HJ 2 = heute bis Ende August (ab März). Alle Termine im Fenster.
- Paare: immer Senior + Junior (`helpers.is_senior`). Zwei Senioren nur, wenn ein Senior mindestens einen Einsatz zurückliegt. Zwei Junioren nie, sonst wird der Termin übersprungen.
- Fair: pro Halbjahr gleich oft, Zähler startet bei 0, Vergangenheit zählt nicht.
- Ablauf: Vorschau → „In Sandbox-Gruppe posten“ (`/api/rotation/commit?test=1`: neu berechnen, Zuweisungen im Fenster **ersetzen**, in `TELEGRAM_TEST_CHAT_ID` posten + pinnen) → Helfer im Termin-Sheet tauschen (editiert die gepinnte Nachricht über `rotation_message_id`) → „In Helfer-Gruppe posten“ (`/api/rotation/commit`: postet den **aktuellen Stand**, keine Neuberechnung).
- Bei Termin-Ausfall rückt der Reminder-Cron die Duos weiter (`shiftRotationOnCancellation`).

## Vote-Tracking

Mittwoch-Stage-2 sendet Inline-Buttons `votey_<event_id>` / `voten_<event_id>`. Klick:
1. Webhook-Handler in `services/bot-commands.ts` parst die Nachricht (✅ Dabei / ❌ Absagen Zeilen) und re-rendert sie mit dem Klicker-Namen.
2. Persistiert den Vote in `attendance_votes` via `recordVote()` — Vote-Status lebt also doppelt: in der editierten Nachricht UND in der DB.
3. Setzt eine Big-Mode-Reaction (`is_big: true`) auf die Mittwochs-Nachricht: 🎉 bei "dabei", 😢 bei "kann nicht".
4. Donnerstags-Cron liest `attendance_votes` um Nicht-Voter zu finden.

## Database-Quirk

`reminder_log.message_id` wird beim Mittwochs-Send mit der Telegram-`message_id` befüllt — der Donnerstags-Cron benutzt sie für `reply_to_message_id`. Damit `?test=2` das auch befüllt, wird im Testmodus ebenfalls geloggt (Upsert auf event_id+reminder_type).

`getBirthdaysAroundEvent()` liefert Kinder mit Geburtstag ±3 Tage um das Event-Datum, Format `🧒 Name — Tag. Mon (wird X)` pro Kind. Nur Stage 1 + 2 zeigen Geburtstage, Stage 3 nicht.

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

## Bot-Befehle und Rollen

`services/bot-commands.ts` prüft pro Befehl die Rolle: Admin (Zugangsliste `admins.ts`), Helfer (`helpers`), Elternteil (`parents` per `telegram_user_id` oder `telegram_username`, Logik in `services/parents-bot.ts`).

| Befehl | Wer | Was |
|---|---|---|
| `/start`, `/help` | alle | rollenabhängige Begrüßung/Übersicht; Admins bekommen den Menü-Button „Admin“ (Mini-App) |
| `/register CODE` | unbekannt, privat | Code = `settings.register_code` (Einstellungen). Leer = Registrierung geschlossen |
| `/next`, `/status`, `/mystatus` | Helfer | Termine mit Team, eigene Einsätze |
| `/termine` | Eltern + Helfer | nächste Termine ohne Team |
| `/idee` | Eltern + Helfer, privat | Freitext → `ideas` (event_id null, was_used=false, `source='elterngruppe'`, `suggested_by`); erscheint im Ideenpool als „Vorschlag von X“ |
| `/einladen` | Eltern, privat | „Kommt zu uns“, nur Buttons: Termin wählen (`inv_<event_id>`) → Ja/Nein (`invy_`/`invn_`) → `invitations` (eine pro Termin); Admins bekommen eine DM, Kalender zeigt „Einladung: Name“. Der Elterndienst (`parent_duties`) bleibt davon unberührt |
| `/chatid` | Admin | Chat-ID |

**Grundsatz Eltern:** der Bot schreibt Eltern nie aktiv per DM an. Eltern schreiben dem Bot (`/idee`, `/einladen`, `/termine`); Gruppen-Posts in die Elterngruppe (Fotos, Geburtstagsgruß) sind davon unberührt. Bewertung (review-ping) nur Admins, Fotos nur Helfer.

Fotos (`services/photos.ts`, Tabelle `event_photos`, Migration 013): nur Helfer/Admins schicken Bilder privat an den Bot → nur `file_id` gespeichert, zugeordnet zum Termin des Tages (bis 3 Tage danach). Abends 20:00 erinnert der review-ping-Cron die eingeteilten Helfer per DM (`reminder_log` Typ `photo_nudge`). Admins: `/bilder` (Vorschau), `/senden` (Rückfrage → Album(s) à 10 in `TELEGRAM_ELTERN_CHAT_ID` mit Caption „Coole Jungschar … /idee … /einladen“, `posted_at` gesetzt).

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
   Alter (max. 24 h) und prüft die Telegram-ID gegen die feste Zugangsliste
   `ADMIN_TELEGRAM_USER_IDS` in `services/admins.ts`. Wer dort nicht steht,
   bekommt 403 — auch registrierte Helfer. Neue Person = ID in die Datei
   eintragen. Bei Erfolg: signiertes Cookie `app_session`, 24 h gültig.
3. **Daten holen** — `lib/supabase.ts` zeigt auf `/api/db` statt auf Supabase.
   supabase-js spricht damit `/api/db/rest/v1/<tabelle>` an; der Proxy prüft
   das Cookie, filtert gegen eine Tabellen-Allowlist und reicht mit
   `SUPABASE_SERVICE_KEY` weiter. Die Seiten selbst blieben unverändert.
4. **Ohne Telegram** — kein initData, kein Cookie: 401. `TelegramProvider`
   rendert die Kinder gar nicht erst, sondern nur den Hinweis.

Alle API-Routen sind geschlossen. `services/api-guard.ts:requireOperator()`
akzeptiert entweder das Session-Cookie oder `Authorization: Bearer $CRON_SECRET`
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
ideas (event_id, title, description, material, was_used, source, rating, tags[], suggested_by, weather_description, temperature) — Archiv (event_id gesetzt, was_used=true) UND Ideenpool (event_id NULL, was_used=false, source='elterngruppe'|'manual'; tags = drinnen/draußen + Kategorien; suggested_by + created_at = wer/wann die Idee eingebracht hat, beim Import das Datum der ersten Chat-Nachricht)
review_pings (event_id, telegram_user_id, chat_id, message_id, state, stars, place, is_test) UNIQUE(event_id, telegram_user_id)
children (id, name, birthday, active)
settings (key UNIQUE, value)
```
