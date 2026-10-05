import { getSupabase } from './database'
import { halfYearWindow, type HalfYearWindow } from './rotation'
import { hasFoodDuty } from '@/utils/format'

/**
 * Eltern-Einteilung (Essen).
 *
 * Elterndienst gibt es nur an Samstags-Terminen. Pro Samstag im laufenden
 * Halbjahr (gleiches Fenster wie die Helfer-Einteilung) wird ein aktives
 * Elternteil eingeteilt, reihum, damit alle gleich oft drankommen. Die
 * Reihenfolge wird bei jeder Berechnung neu gemischt; wer den letzten
 * Elterndienst vor dem Fenster hatte, kommt nicht als Erstes dran.
 *
 * Kein Automatismus und kein Post: Button „Eltern einteilen“ im Kalender →
 * Vorschau (Namen tauschbar) → Speichern ersetzt den Elterndienst der
 * Samstags-Termine. Die Helfer sehen die Familie im Sonntags-Heads-up.
 */

export interface ParentProposal {
  eventId: string
  eventDate: string
  parent: { id: string; name: string }
}

export interface ParentRotationResult {
  window: HalfYearWindow
  proposals: ParentProposal[]
  parents: number
}

async function loadActiveParents(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await getSupabase()
    .from('parents')
    .select('id, name')
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as { id: string; name: string }[]
}

/** Samstags-Termine im Halbjahres-Fenster. */
async function loadSaturdayEvents(win: HalfYearWindow): Promise<{ id: string; event_date: string }[]> {
  const { data, error } = await getSupabase()
    .from('events')
    .select('id, event_date')
    .gte('event_date', win.from)
    .lte('event_date', win.until)
    .order('event_date', { ascending: true })
  if (error) throw error
  return ((data ?? []) as { id: string; event_date: string }[]).filter(e => hasFoodDuty(e.event_date))
}

/** Elternteil des letzten Samstags-Elterndienstes vor dem Fenster. */
async function lastDutyParentId(win: HalfYearWindow): Promise<string | null> {
  const { data } = await getSupabase()
    .from('events')
    .select('event_date, parent_duties(parent_id)')
    .lt('event_date', win.from)
    .order('event_date', { ascending: false })
    .limit(12)
  for (const e of (data ?? []) as any[]) {
    const parentId = e.parent_duties?.[0]?.parent_id
    if (parentId && hasFoodDuty(e.event_date)) return parentId
  }
  return null
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Frischer Vorschlag für die Samstage des laufenden Halbjahres. Schreibt nichts. */
export async function generateParentRotation(): Promise<ParentRotationResult> {
  const win = halfYearWindow()
  const [parents, events, lastId] = await Promise.all([
    loadActiveParents(),
    loadSaturdayEvents(win),
    lastDutyParentId(win),
  ])
  const result: ParentRotationResult = { window: win, proposals: [], parents: parents.length }
  if (parents.length === 0) return result

  const order = shuffle(parents)
  if (order.length > 1 && order[0].id === lastId) order.push(order.shift()!)

  result.proposals = events.map((e, i) => ({
    eventId: e.id,
    eventDate: e.event_date,
    parent: order[i % order.length],
  }))
  return result
}

/**
 * Speichert die (ggf. angepasste) Vorschau: ersetzt den Elterndienst der
 * enthaltenen Termine. Termine außerhalb des Fensters, Nicht-Samstage und
 * unbekannte Eltern werden ignoriert.
 */
export async function saveParentRotation(
  proposals: { eventId: string; parentId: string }[],
): Promise<{ saved: number }> {
  const db = getSupabase()
  const win = halfYearWindow()
  const [parents, events] = await Promise.all([loadActiveParents(), loadSaturdayEvents(win)])
  const parentIds = new Set(parents.map(p => p.id))
  const eventIds = new Set(events.map(e => e.id))

  const rows = new Map<string, string>()
  for (const p of proposals) {
    if (eventIds.has(p.eventId) && parentIds.has(p.parentId)) rows.set(p.eventId, p.parentId)
  }
  if (rows.size === 0) return { saved: 0 }

  const ids = [...rows.keys()]
  const { error: delError } = await db.from('parent_duties').delete().in('event_id', ids)
  if (delError) throw delError
  const { error } = await db
    .from('parent_duties')
    .insert(ids.map(event_id => ({ event_id, parent_id: rows.get(event_id)! })) as any)
  if (error) throw error
  return { saved: ids.length }
}
