// Prüft, ob der Bot die konfigurierten Gruppen erreicht (getChat + Mitgliedsstatus).
// Aufruf: node scripts/check-chats.mjs
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

const token = env.TELEGRAM_BOT_TOKEN
const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json()
const botId = me.result?.id

for (const key of ['TELEGRAM_CHAT_ID', 'TELEGRAM_TEST_CHAT_ID', 'TELEGRAM_ELTERN_CHAT_ID']) {
  const chatId = env[key]
  if (!chatId) {
    console.log(`${key}: nicht gesetzt`)
    continue
  }
  const chat = await (await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${chatId}`)).json()
  if (!chat.ok) {
    console.log(`${key}: ${chat.description}`)
    continue
  }
  const member = await (
    await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${chatId}&user_id=${botId}`)
  ).json()
  console.log(`${key}: "${chat.result.title}" (${chat.result.type}) – Bot ist ${member.result?.status ?? 'unbekannt'}`)
}
