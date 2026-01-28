import { getSupabase, getTodayISO } from './database'

/**
 * Findet einen Helfer anhand seiner Telegram User ID
 */
export async function getHelperByTelegramId(telegramUserId: number) {
  const { data } = await getSupabase()
    .from('helpers')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .single()
  return data
}

/**
 * Registriert einen neuen Helfer oder verknüpft einen bestehenden mit Telegram
 */
export async function registerHelper(
  name: string,
  telegramUserId: number,
  username?: string
) {
  const db = getSupabase()

  // Erst versuchen, existierenden Helfer per Name zu finden
  const { data: existing } = await db
    .from('helpers')
    .select('*')
    .ilike('name', name)
    .single()

  if (existing) {
    // Existierenden Helfer mit Telegram-Info aktualisieren
    const { data, error } = await db
      .from('helpers')
      .update({
        telegram_user_id: telegramUserId,
        telegram_username: username,
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw error
    return data
  }

  // Neuen Helfer erstellen
  const { data, error } = await db
    .from('helpers')
    .insert({
      name,
      telegram_user_id: telegramUserId,
      telegram_username: username,
    } as any)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Gibt alle Helfer zurück
 */
export async function getAllHelpers() {
  const { data } = await getSupabase()
    .from('helpers')
    .select('id, name')
    .order('name', { ascending: true })
  return data || []
}

/**
 * Gibt die Einsätze eines Helfers zurück
 */
export async function getHelperAssignments(helperId: string, limit = 5) {
  const { data } = await getSupabase()
    .from('assignments')
    .select('*, event:events(*)')
    .eq('helper_id', helperId)
    .gte('events.event_date', getTodayISO())
    .order('events(event_date)', { ascending: true })
    .limit(limit)
  return data || []
}
