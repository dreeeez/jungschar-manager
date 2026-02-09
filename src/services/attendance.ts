import { getSupabase } from './database'

/**
 * Speichert oder aktualisiert eine Abstimmung (UPSERT)
 */
export async function recordVote(eventId: string, helperId: string, attending: boolean) {
  const db = getSupabase()

  // Prüfe ob Vote existiert
  const { data: existing } = await db
    .from('attendance_votes')
    .select('id')
    .eq('event_id', eventId)
    .eq('helper_id', helperId)
    .single()

  if (existing) {
    const { error } = await db
      .from('attendance_votes')
      .update({ attending, voted_at: new Date().toISOString() } as any)
      .eq('id', existing.id)

    if (error) throw error
  } else {
    const { error } = await db
      .from('attendance_votes')
      .insert({ event_id: eventId, helper_id: helperId, attending } as any)

    if (error) throw error
  }
}

/**
 * Gibt alle Stimmen für ein Event zurück (mit Helfer-Namen)
 */
export async function getVotesForEvent(eventId: string) {
  const { data } = await getSupabase()
    .from('attendance_votes')
    .select('*, helper:helpers(id, name, telegram_username)')
    .eq('event_id', eventId)
  return data || []
}

/**
 * Gibt die Namen der Helfer zurück, die zugesagt haben
 */
export async function getAttendingHelperNames(eventId: string): Promise<string[]> {
  const votes = await getVotesForEvent(eventId)
  return votes
    .filter((v: any) => v.attending)
    .map((v: any) => v.helper?.name)
    .filter(Boolean)
}
