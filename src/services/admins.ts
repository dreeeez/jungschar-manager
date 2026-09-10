import { getSupabase } from './database'

/**
 * Zugangsliste (Telegram-User-IDs).
 *
 * Nur diese Personen dürfen die Mini-App benutzen — sämtliche Daten laufen
 * über den Server (services/telegram-auth.ts + /api/db), der jede Anmeldung
 * gegen diese Liste prüft. Wer hier nicht steht, bekommt 403 — auch wenn er
 * per /register in `helpers` eingetragen ist.
 *
 * Aktuell: Marco, Jens.
 */

/** Live-URL der Mini-App (Production). */
export const APP_URL = 'https://jungschar-manager-bot-mini-app.vercel.app'

export const ADMIN_TELEGRAM_USER_IDS = new Set<number>([
  5856427770, // Marco Schneider
  53866569, // Jens Müller
  // Weitere registrierte Helfer (bei Bedarf einkommentieren):
  // 523168386, // Hartmut Kern
  // 62768308, // Henrik Fächner
  // 391327526, // Phil Rube
  // 241683652, // Tobias Schneider
  // 1004715868, // Sami
  // 64591514, // Marcus
  // 1433775426, // Elias Anton
])

export function isAdmin(telegramUserId: number): boolean {
  return ADMIN_TELEGRAM_USER_IDS.has(telegramUserId)
}

export interface AllowedUser {
  helperId: string | null
  telegramUserId: number
  name: string
  isAdmin: boolean
}

/**
 * Liefert den zugelassenen Nutzer — oder null, wenn die ID nicht auf der
 * Liste steht. Name und helperId kommen aus `helpers`, falls die Person
 * dort per /register eingetragen ist; sonst bleibt helperId null.
 */
export async function findAllowedHelper(telegramUserId: number): Promise<AllowedUser | null> {
  if (!isAdmin(telegramUserId)) return null

  const { data, error } = await getSupabase()
    .from('helpers')
    .select('id, name')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle()

  if (error) throw error
  const row = data as { id: string; name: string } | null

  return {
    helperId: row?.id ?? null,
    telegramUserId,
    name: row?.name ?? 'Admin',
    isAdmin: true,
  }
}
