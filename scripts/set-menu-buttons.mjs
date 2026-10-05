// Setzt den Menü-Button neben dem Eingabefeld für alle registrierten Helfer
// auf einmal: Admins (Zugangsliste) „Admin“ → ganze Mini-App, alle anderen
// Helfer „Ideen“ → nur der Ideenpool. Sonst passiert das erst beim nächsten
// /start des jeweiligen Helfers.
// Aufruf: node scripts/set-menu-buttons.mjs   (liest .env.local)
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]
    }),
)

const APP_URL = 'https://jungschar-manager-bot-mini-app.vercel.app'
// Muss mit ADMIN_TELEGRAM_USER_IDS in src/services/admins.ts übereinstimmen.
const ADMIN_IDS = new Set(
  readFileSync(new URL('../src/services/admins.ts', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^\s+\d+,\s*\/\//.test(l))
    .map((l) => Number(l.trim().split(',')[0])),
)

const token = env.TELEGRAM_BOT_TOKEN
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY)
const { data: helpers, error } = await db.from('helpers').select('name, telegram_user_id').not('telegram_user_id', 'is', null)
if (error) throw error

for (const h of helpers) {
  const id = Number(h.telegram_user_id)
  const admin = ADMIN_IDS.has(id)
  const menu_button = admin
    ? { type: 'web_app', text: 'Admin', web_app: { url: APP_URL } }
    : { type: 'web_app', text: 'Ideen', web_app: { url: `${APP_URL}/ideen` } }
  const res = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: id, menu_button }),
  }).then((r) => r.json())
  console.log(`${h.name}: ${admin ? 'Admin' : 'Ideen'} → ${res.ok ? 'ok' : res.description}`)
}
