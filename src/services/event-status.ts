import { getSupabase } from './database'

/**
 * Gibt den Status eines Events zurück
 */
export async function getEventStatus(eventId: string) {
  const { data } = await getSupabase()
    .from('event_status')
    .select('*')
    .eq('event_id', eventId)
    .single()
  return data
}

/**
 * Erstellt oder aktualisiert den Event-Status (UPSERT)
 */
export async function upsertEventStatus(eventId: string, updates: Record<string, any>) {
  const db = getSupabase()

  const { data: existing } = await db
    .from('event_status')
    .select('id')
    .eq('event_id', eventId)
    .single()

  if (existing) {
    const { error } = await db
      .from('event_status')
      .update({ ...updates, updated_at: new Date().toISOString() } as any)
      .eq('id', existing.id)

    if (error) throw error
  } else {
    const { error } = await db
      .from('event_status')
      .insert({ event_id: eventId, ...updates } as any)

    if (error) throw error
  }
}
