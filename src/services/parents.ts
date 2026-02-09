import { getSupabase } from './database'

/**
 * Gibt alle aktiven Eltern zurück
 */
export async function getAllParents() {
  const { data } = await getSupabase()
    .from('parents')
    .select('*')
    .eq('active', true)
    .order('name', { ascending: true })
  return data || []
}

/**
 * Erstellt ein neues Elternteil
 */
export async function createParent(name: string, phone?: string) {
  const { data, error } = await getSupabase()
    .from('parents')
    .insert({ name, phone: phone || null } as any)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Löscht ein Elternteil (Soft-Delete)
 */
export async function deleteParent(parentId: string) {
  const { error } = await getSupabase()
    .from('parents')
    .update({ active: false } as any)
    .eq('id', parentId)

  if (error) throw error
}

/**
 * Weist ein Elternteil einem Event zu (Elterndienst/Essen)
 * Nur 1 Elternteil pro Event - ersetzt bestehende Zuweisung
 */
export async function assignParentToEvent(eventId: string, parentId: string) {
  const db = getSupabase()

  // Bestehende Zuweisung entfernen
  await db.from('parent_duties').delete().eq('event_id', eventId)

  // Neue Zuweisung erstellen
  const { error } = await db
    .from('parent_duties')
    .insert({ event_id: eventId, parent_id: parentId } as any)

  if (error) throw error
}

/**
 * Entfernt die Elterndienst-Zuweisung für ein Event
 */
export async function removeParentFromEvent(eventId: string, parentId: string) {
  const { error } = await getSupabase()
    .from('parent_duties')
    .delete()
    .eq('event_id', eventId)
    .eq('parent_id', parentId)

  if (error) throw error
}

/**
 * Gibt den Elterndienst für ein Event zurück
 */
export async function getParentDutyForEvent(eventId: string) {
  const { data } = await getSupabase()
    .from('parent_duties')
    .select('*, parent:parents(*)')
    .eq('event_id', eventId)
    .limit(1)
    .single()
  return data
}

/**
 * Extrahiert den Eltern-Namen aus einem Event mit parent_duties Join
 */
export function getParentDutyName(event: any): string {
  const duty = event?.parent_duties?.[0]
  return duty?.parent?.name || 'Noch nicht eingeteilt'
}
