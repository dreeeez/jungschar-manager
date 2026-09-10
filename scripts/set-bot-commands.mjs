// Registriert die Befehlsliste des Bots bei Telegram (Menü im Chat).
// Aufruf: node scripts/set-bot-commands.mjs   (liest TELEGRAM_BOT_TOKEN aus .env.local)
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
if (!token) throw new Error('TELEGRAM_BOT_TOKEN fehlt')

const commands = [
  { command: 'start', description: 'Bot starten' },
  { command: 'help', description: 'Befehle anzeigen' },
  { command: 'termine', description: 'Nächste Jungschar-Termine' },
  { command: 'idee', description: 'Programm-Idee vorschlagen' },
  { command: 'essen', description: 'Essen für einen Termin übernehmen' },
  { command: 'next', description: 'Termine mit Team (Helfer)' },
  { command: 'mystatus', description: 'Meine Einsätze (Helfer)' },
  { command: 'register', description: 'Als Helfer registrieren (mit Code)' },
]

const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ commands }),
})
console.log(await res.json())
