import { getSupabase } from './database'

/**
 * Zugangsliste (Telegram-User-IDs) = Admins.
 *
 * Admins dürfen die ganze Mini-App benutzen. Registrierte Helfer (Tabelle
 * `helpers`) bekommen eine eigene Rolle mit genau einer Seite, dem
 * Ideenpool (/ideen), nur lesend. Sämtliche Daten laufen über den Server
 * (services/telegram-auth.ts + /api/db), der die Rolle aus dem Session-
 * Cookie prüft. Wer weder Admin noch Helfer ist, bekommt 403.
 *
 * Aktuell Admins: Marco, Jens.
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

export type AppRole = 'admin' | 'helper'

export interface AllowedUser {
  helperId: string | null
  telegramUserId: number
  name: string
  isAdmin: boolean
  role: AppRole
}

/**
 * Liefert den zugelassenen Nutzer mit Rolle — oder null. Admin: steht auf
 * der Zugangsliste (helperId aus `helpers`, falls registriert). Helfer:
 * steht nur in `helpers` (per /register) und sieht ausschließlich /ideen.
 */
export async function findAllowedHelper(telegramUserId: number): Promise<AllowedUser | null> {
  const { data, error } = await getSupabase()
    .from('helpers')
    .select('id, name')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle()

  if (error) throw error
  const row = data as { id: string; name: string } | null
  const admin = isAdmin(telegramUserId)
  if (!admin && !row) return null

  return {
    helperId: row?.id ?? null,
    telegramUserId,
    name: row?.name ?? 'Admin',
    isAdmin: admin,
    role: admin ? 'admin' : 'helper',
  }
}
