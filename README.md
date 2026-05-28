# Jungschar Manager

A Telegram bot + admin web app for running a weekly youth-group ("Jungschar"). Plans the helper rotation, polls attendance, syncs the iCal calendar, posts weather-aware reminders, collects ideas — and keeps the parent contact list at hand.

## Features

- **Helper rotation** — 12+ week schedule with senior + junior pairings, manual override, drag-to-reorder
- **Attendance polls** — Wednesday reminder with inline-button vote, Thursday non-voter ping
- **Calendar sync** — pulls events from an iCal URL, surfaces birthdays per event card
- **Weather** — fetches forecast for the chosen location, included in reminders
- **Ideas board** — group submits + rates activity ideas with tags
- **Parents directory** — contact list with optional Telegram username for direct messaging
- **Settings page** — chat ID, location, reminder toggles, all from the web UI

## Tech

- **Framework:** Next.js 14 (App Router), React, TypeScript, Tailwind
- **Bot:** [grammY](https://grammy.dev/) + Telegram Bot API
- **Backend:** Supabase (Postgres + RLS) with versioned SQL migrations
- **Hosting:** Vercel — cron jobs for the reminder/poll schedule

## Project structure

```
src/
├── app/                       Next.js routes
│   ├── calendar · helpers · parents · children · ideas · settings
│   └── api/
│       ├── telegram           Bot webhook
│       ├── sync-ical          iCal pull endpoint
│       ├── rotation/...       Preview / commit / re-render
│       └── cron/...           Vercel-cron-triggered reminders
├── services/                  Business logic
│   ├── rotation, attendance, helpers, parents, ideas
│   ├── events, event-status, ical-sync
│   ├── reminders, poll-reminder, weather
│   └── bot-commands           Telegram command handlers
├── components/                React UI
└── lib/                       Supabase client
supabase/
└── migrations/                001 … 007 versioned schema
```

## Setup

1. **Create a Telegram bot** via [@BotFather](https://t.me/BotFather) and note the token + your chat ID.
2. **Create a Supabase project**, then run all SQL files in `supabase/migrations/` in order via the SQL Editor.
3. **Copy `.env.example` → `.env.local`** and fill in the Telegram + Supabase + Vercel-cron values.
4. **Install & run locally:**
   ```bash
   npm install
   npm run dev
   ```
5. **Deploy to Vercel** — `vercel`. Set the same env vars in the Vercel project; the cron schedule is in `vercel.json`.
6. **Register the bot webhook** with Telegram so it talks to your Vercel deployment:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<your-deploy-url>/api/telegram`

## Environment variables

| Name | What |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather |
| `TELEGRAM_CHAT_ID` | Target group chat ID |
| `TELEGRAM_TEST_CHAT_ID` | Optional, for `?test=1\|2\|3` reminder testing |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service role key (server-side only) |
| `NEXT_PUBLIC_SUPABASE_URL` | Same URL for client-side admin UI |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key for client-side reads |
| `CRON_SECRET` | Shared secret guarding the cron endpoints |
