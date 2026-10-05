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

// Privater Chat, Standard vor dem ersten /start: die Eltern-Sicht. Beim /start
// setzt der Bot pro Chat das Menü je Rolle (bot-commands.ts: commandsFor).
const privateCommands = [
  { command: 'start', description: 'Bot starten' },
  { command: 'termine', description: 'Nächste Jungschar-Termine' },
  { command: 'idee', description: 'Programm-Idee vorschlagen' },
  { command: 'invite', description: 'Die Jungschar zu euch einladen' },
  { command: 'bug', description: 'Fehler oder Wunsch zum Bot melden' },
  { command: 'help', description: 'Befehle anzeigen' },
]

// Helfer-Gruppe: die Helfer-Befehle, wie gehabt.
const helperGroupCommands = [
  { command: 'next', description: 'Nächste Termine mit Team' },
  { command: 'status', description: 'Nächste Jungschar' },
  { command: 'mystatus', description: 'Meine Einsätze' },
  { command: 'termine', description: 'Nächste Termine' },
]

async function setCommands(commands, scope) {
  const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands, scope }),
  })
  console.log(scope.type, (await res.json()).ok ? 'ok' : 'FEHLER')
}

await setCommands(privateCommands, { type: 'all_private_chats' })
// Gruppen (Elterngruppe und alle anderen): kein Menü. Befehle in Gruppen sind
// unerwünscht, weil jeder mitliest; die Info-Nachricht nutzt Links in den privaten Chat.
await setCommands([], { type: 'all_group_chats' })
await setCommands([], { type: 'all_chat_administrators' })
await setCommands([], { type: 'default' })
const helperChat = process.env.TELEGRAM_CHAT_ID ?? env.TELEGRAM_CHAT_ID
if (helperChat) await setCommands(helperGroupCommands, { type: 'chat', chat_id: helperChat })
