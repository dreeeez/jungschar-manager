import { getSupabase, getTodayISO } from './database'
import { getDaysUntil } from '@/utils/format'
import { fetchJungscharDatesFromIcs } from './ical-sync'

const STAGES = ['stage1_sunday', 'stage2_wednesday', 'stage3_saturday']

export interface BotStatus {
  now: string
  calendar: {
    feedReachable: boolean
    feedJungscharCount: number | null
    lastSync: any
  }
  upcoming: Array<{
    date: string
    daysUntil: number
    inFeed: boolean | null
    pinned: boolean
    duo: string[]
    remindersSent: string[]
  }>
  drift: {
    staleInDb: string[]
    missingFromDb: string[]
  }
}

/**
 * Read-only Health-Snapshot des Bots. Sendet/schreibt NICHTS. Vergleicht die
 * events-Tabelle mit dem aktuellen iCal-Feed und sammelt Einteilung + Reminder-
 * Status je kommendem Termin. Basis für die Status-Karte in der Mini-App.
 */
export async function getBotStatus(): Promise<BotStatus> {
  const db = getSupabase()
  const todayIso = getTodayISO()

  // Feed frisch holen (null = nicht erreichbar -> Drift unbestimmt).
  const feed = await fetchJungscharDatesFromIcs()

  // Alle zukünftigen Termine (für Detail-Liste UND Drift-Abgleich).
  const { data: eventsData } = await db
    .from('events')
    .select('id, event_date, rotation_message_id')
    .gte('event_date', todayIso)
    .order('event_date', { ascending: true })
  const events = (eventsData ?? []) as any[]
  const ids = events.map(e => e.id)
  const safeIds = ids.length ? ids : ['00000000-0000-0000-0000-000000000000']

  const [assignsRes, logsRes, syncRes] = await Promise.all([
    db.from('assignments').select('event_id, helper:helpers(name, is_senior)').in('event_id', safeIds),
    db.from('reminder_log').select('event_id, reminder_type').in('event_id', safeIds).in('reminder_type', STAGES),
    db.from('settings').select('value').eq('key', 'last_ical_sync').maybeSingle(),
  ])

  const duoByEvent = new Map<string, string[]>()
  for (const a of (assignsRes.data ?? []) as any[]) {
    if (!a.helper) continue
    const arr = duoByEvent.get(a.event_id) ?? []
    arr.push(`${a.helper.name}${a.helper.is_senior ? ' (S)' : ' (J)'}`)
    duoByEvent.set(a.event_id, arr)
  }

  const remByEvent = new Map<string, string[]>()
  for (const l of (logsRes.data ?? []) as any[]) {
    const arr = remByEvent.get(l.event_id) ?? []
    arr.push(l.reminder_type)
    remByEvent.set(l.event_id, arr)
  }

  const upcoming = events.slice(0, 10).map(e => ({
    date: e.event_date,
    daysUntil: getDaysUntil(new Date(e.event_date)),
    inFeed: feed ? feed.has(e.event_date) : null,
    pinned: !!e.rotation_message_id,
    duo: (duoByEvent.get(e.id) ?? []).sort(),
    remindersSent: (remByEvent.get(e.id) ?? []).sort(),
  }))

  // Drift nur bestimmbar, wenn der Feed erreichbar war.
  const dbFuture = new Set(events.map(e => e.event_date))
  const staleInDb = feed ? events.filter(e => !feed.has(e.event_date)).map(e => e.event_date) : []
  const missingFromDb = feed ? [...feed].filter(d => d >= todayIso && !dbFuture.has(d)).sort() : []

  let lastSync: any = null
  const rawSync = (syncRes.data as any)?.value
  if (rawSync) {
    try { lastSync = JSON.parse(rawSync) } catch { lastSync = rawSync }
  }

  return {
    now: todayIso,
    calendar: {
      feedReachable: feed !== null,
      feedJungscharCount: feed ? feed.size : null,
      lastSync,
    },
    upcoming,
    drift: { staleInDb, missingFromDb },
  }
}
