import { getSupabase } from './database'

export interface IdeaRecord {
  id: string
  event_id: string | null
  title: string
  description: string | null
  material: string | null
  was_used: boolean
  source: string
  rating: string | null
  created_at: string
}

/**
 * Saves an activity (from Elterngruppe or manual input) to the ideas table.
 */
export async function saveActivity(
  title: string,
  description: string,
  eventId: string | null,
  source: string
): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('ideas')
    .insert({
      event_id: eventId,
      title: title.slice(0, 200),
      description,
      was_used: true,
      source,
    } as any)
    .select('id')
    .single()

  if (error) {
    console.error('Error saving activity:', error)
    return null
  }
  return data?.id ?? null
}

/**
 * Returns the most recent idea/activity for a given event.
 */
export async function getIdeaForEvent(eventId: string): Promise<IdeaRecord | null> {
  const { data } = await getSupabase()
    .from('ideas')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  return (data as IdeaRecord) ?? null
}

/**
 * Returns all logged activities (was_used = true), ordered by newest first.
 * Includes the linked event data.
 */
export async function getAllActivities(): Promise<any[]> {
  const { data } = await getSupabase()
    .from('ideas')
    .select('*, event:events(id, event_date, title)')
    .eq('was_used', true)
    .order('created_at', { ascending: false })
  return data ?? []
}
