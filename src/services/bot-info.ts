import { MINI_APP_SHORT_NAME } from './admins'

/** Bot-Username (getMe), einmal pro Prozess geholt. null, wenn nicht erreichbar. */
let cached: string | null = null

export async function botUsername(): Promise<string | null> {
  if (cached) return cached
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    const json = await res.json()
    cached = json?.result?.username ?? null
  } catch {
    cached = null
  }
  return cached
}

/** Album aus Telegram-file_ids (bis 10), jedes mit eigener Caption (HTML). */
export async function sendPhotoAlbum(
  chatId: string,
  items: { fileId: string; caption?: string }[],
): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const media = items.slice(0, 10).map(i => ({
    type: 'photo',
    media: i.fileId,
    ...(i.caption ? { caption: i.caption, parse_mode: 'HTML' } : {}),
  }))
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, media }),
  })
  return res.json()
}

/**
 * Link, der die benannte Mini-App direkt öffnet (BotFather /newapp,
 * MINI_APP_SHORT_NAME). {startParam} landet in initData.start_param; die App
 * routet damit z. B. auf /ideen. null, solange keine Mini-App angelegt ist.
 */
export async function miniAppLink(startParam: string): Promise<string | null> {
  if (!MINI_APP_SHORT_NAME) return null
  const username = await botUsername()
  return username ? `https://t.me/${username}/${MINI_APP_SHORT_NAME}?startapp=${startParam}` : null
}
