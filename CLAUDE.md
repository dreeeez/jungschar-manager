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
```

## Reminder-System

Vier zeitlich gestaffelte Reminder-Pings, alle vom täglichen Vercel-Cron `0 8 * * *` (UTC) bzw. `0 16 * * 4` (Donnerstag, UTC).

| Wann | Endpoint | Stage | Inhalt |
|---|---|---|---|
| Sonntag 6–8 Tage vor Event | `/api/cron/reminder` (Stage 1) | `stage1_sunday` | Heads-up — 7 rotierende Themes (Spy, Glaskugel, Wettervorhersage, Spotify Wrapped, Stadion, Festival, Mission Control) + rotierender `+++ NEWS / JUNGSCHAR INTEL / HEADS-UP / NÄCHSTE WOCHE / 📣 ANKÜNDIGUNG +++` Top-Header |
| Mittwoch 3–4 Tage vor Event | `/api/cron/reminder` (Stage 2) | `stage2_wednesday` | `+++ 🔥 Countdown: N Tage 🔥 +++` mit Vote-Buttons (votey/voten), kompakter Checkliste |
| Donnerstag 18:00 lokal | `/api/cron/poll-reminder` | (separates Cron) | Tagged Helfer ohne Vote-Eintrag, replyt zur Mittwochs-Nachricht. 20 rotierende `+++ … +++` Templates |
| Samstag morgen (Tag des Events) | `/api/cron/reminder` (Stage 3) | `stage3_saturday` | Aufwacher mit 6 rotierenden Themes + 18 rotierenden Bibelversen + festem `Ihr schafft das! Viel Spaß und Gottes Segen` Closing. Top-Header rotiert zwischen `+++ HEUTE / JUNGSCHAR-DAY / GAME ON / SHOWTIME / T-0 / DER TAG +++` |

Schedule-Logik in `services/reminders.ts:processReminders()`:
- Stage 1: `dayOfWeek === 0 && daysUntil ∈ [6,8]`
- Stage 2: `dayOfWeek === 3 && daysUntil ∈ [3,4]`
- Stage 3: `daysUntil === 0` (event day, weekday-unabhängig)

`reminder_log` mit UNIQUE(event_id, reminder_type) verhindert Duplikate. Im Test-Modus wird upserted, nicht insert-only — sonst kannst du `?test=N` nicht mehrfach feuern.

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

## Wichtige Konventionen

- Keine inline AI/Gemini-Calls — wurde 2026-05-01 entfernt (`ai-ideas.ts`, `activity-extractor.ts` weg).
- Helfer registrieren sich ausschließlich per `/register` im Bot — kein manuelles Anlegen in der UI.
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
ideas (event_id, title, description, was_used, source) — Aktivitäten-History
children (id, name, birthday, active)
settings (key UNIQUE, value)
```
