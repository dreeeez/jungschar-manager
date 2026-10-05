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

/**
 * Link, der die Mini-App direkt öffnet (Haupt-Mini-App des Bots, bei
 * BotFather aktiviert). {startParam} landet in initData.start_param;
 * die App routet damit z. B. auf /ideen.
 */
export async function miniAppLink(startParam: string): Promise<string | null> {
  const username = await botUsername()
  return username ? `https://t.me/${username}?startapp=${startParam}` : null
}
