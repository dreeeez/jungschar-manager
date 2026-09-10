// Schickt eine einzelne DM über den Bot (für Tests).
// Aufruf: node scripts/send-dm.mjs <telegram_user_id> "<Text>"
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]
    }),
)

const token = process.env.TELEGRAM_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN
const [chatId, text] = process.argv.slice(2)
if (!token || !chatId || !text) throw new Error('Aufruf: node scripts/send-dm.mjs <chat_id> "<Text>"')

const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: Number(chatId), text, parse_mode: 'HTML' }),
})
const json = await res.json()
console.log(json.ok ? 'gesendet' : json)
