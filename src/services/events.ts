import { getSupabase, getTodayISO } from './database'

/**
 * Gibt das nächste Event zurück (mit Assignments und Helfern)
 */
export async function getNextEvent() {
  const { data } = await getSupabase()
    .from('events')
    .select('*, assignments(*, helper:helpers(*)), parent_duties(*, parent:parents(*))')
    .gte('event_date', getTodayISO())
    .order('event_date', { ascending: true })
    .limit(1)
    .single()
  return data
}

/**
 * Gibt die nächsten Events zurück
 */
export async function getUpcomingEvents(limit = 5) {
  const { data } = await getSupabase()
    .from('events')
    .select('*, assignments(*, helper:helpers(*)), parent_duties(*, parent:parents(*))')
    .gte('event_date', getTodayISO())
    .order('event_date', { ascending: true })
    .limit(limit)
  return data || []
}

/**
 * Gibt ein Event anhand seiner ID zurück
 */
export async function getEventById(eventId: string) {
  const { data } = await getSupabase()
    .from('events')
    .select('*, assignments(*, helper:helpers(*)), parent_duties(*, parent:parents(*))')
    .eq('id', eventId)
    .single()
  return data
}

/**
 * Gibt alle Events zurück (mit Assignments)
 */
export async function getAllEvents() {
  const { data } = await getSupabase()
    .from('events')
    .select('*, assignments(id, helper_id, helper:helpers(id, name)), parent_duties(id, parent_id, parent:parents(id, name))')
    .order('event_date', { ascending: true })
  return data || []
}

/**
 * Extrahiert Helfer-Namen aus einem Event
 */
export function getHelperNames(event: any): string {
  const names = event?.assignments
    ?.map((a: any) => a.helper?.name)
    .filter(Boolean)
  return names?.length ? names.join(' & ') : 'Niemand eingetragen'
}

/**
 * Extrahiert @mentions für Helfer mit Telegram Username
 */
export function getHelperMentions(event: any): string {
  const helpers = event?.assignments?.map((a: any) => a.helper).filter(Boolean) || []
  return helpers
    .filter((h: any) => h.telegram_username)
    .map((h: any) => `@${h.telegram_username}`)
    .join(' ')
}
