import { getSupabase, getTodayISO } from './database'
import { getDaysUntil } from '@/utils/format'
import { fetchJungscharDatesFromIcs } from './ical-sync'

const STAGES = ['stage1_sunday', 'stage2_wednesday', 'stage3_saturday']

export type PingType = 'stage1_sunday' | 'stage2_wednesday' | 'poll_thursday' | 'stage3_saturday'

export interface NextPing {
  type: PingType
  /** Zeitpunkt des Cron-Laufs, ISO UTC */
  at: string
  eventDate: string
  label: string
}

const PING_LABELS: Record<PingType, string> = {
  stage1_sunday: 'Heads-up (Sonntag)',
  stage2_wednesday: 'Countdown (Mittwoch)',
  poll_thursday: 'Nicht-Voter-Ping (Donnerstag)',
  stage3_saturday: 'Aufwacher (Samstag)',
}

/** Cron-Uhrzeiten aus vercel.json (UTC). */
const REMINDER_CRON_HOUR_UTC = 8
const POLL_CRON_HOUR_UTC = 16
const POLL_CRON_WEEKDAY = 4 // Donnerstag

/** Wie viele Termine processReminders() pro Lauf betrachtet (getUpcomingEvents(5)). */
const REMINDER_EVENT_WINDOW = 5

const DAY_MS = 24 * 60 * 60 * 1000

function utcDate(iso: string): Date {
  return new Date(iso + 'T00:00:00Z')
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Spiegelt die Schedule-Logik aus reminders.ts / poll-reminder.ts und
 * berechnet für ein Event die noch ausstehenden Cron-Pings.
 *
 * Der Reminder-Cron läuft täglich 08:00 UTC; an jedem Lauf gilt
 *   Stage 1: Sonntag  und 6 <= daysUntil <= 8
 *   Stage 2: Mittwoch und 3 <= daysUntil <= 4
 *   Stage 3: daysUntil === 0
 * Der Poll-Cron läuft Donnerstag 16:00 UTC und antwortet auf den zuletzt
 * gesendeten Mittwochs-Reminder eines noch bevorstehenden Events.
 */
function predictPings(eventDate: string, sent: Set<string>, now: Date): NextPing[] {
  const out: NextPing[] = []
  const event = utcDate(eventDate)
  const todayIso = isoDay(now)
  const start = utcDate(todayIso)
  const totalDays = Math.round((event.getTime() - start.getTime()) / DAY_MS)
  if (totalDays < 0) return out

  const pending = new Set<PingType>()
  if (!sent.has('stage1_sunday')) pending.add('stage1_sunday')
  if (!sent.has('stage2_wednesday')) pending.add('stage2_wednesday')
  if (!sent.has('stage3_saturday')) pending.add('stage3_saturday')

  let stage2Day: Date | null = null

  for (let i = 0; i <= totalDays; i++) {
    const day = new Date(start.getTime() + i * DAY_MS)
    const at = new Date(day.getTime() + REMINDER_CRON_HOUR_UTC * 60 * 60 * 1000)
    const dow = day.getUTCDay()
    const daysUntil = totalDays - i
    const future = at.getTime() > now.getTime()

    if (pending.has('stage1_sunday') && dow === 0 && daysUntil >= 6 && daysUntil <= 8) {
      if (future) out.push({ type: 'stage1_sunday', at: at.toISOString(), eventDate, label: PING_LABELS.stage1_sunday })
      pending.delete('stage1_sunday')
    }
    if (pending.has('stage2_wednesday') && dow === 3 && daysUntil >= 3 && daysUntil <= 4) {
      if (future) {
        out.push({ type: 'stage2_wednesday', at: at.toISOString(), eventDate, label: PING_LABELS.stage2_wednesday })
        stage2Day = day
      }
      pending.delete('stage2_wednesday')
    }
    if (pending.has('stage3_saturday') && daysUntil === 0) {
      if (future) out.push({ type: 'stage3_saturday', at: at.toISOString(), eventDate, label: PING_LABELS.stage3_saturday })
      pending.delete('stage3_saturday')
    }
  }

  // Donnerstags-Ping: nur wenn der Mittwochs-Reminder gesendet ist oder
  // noch ansteht. Nächster Donnerstag 16:00 UTC nach dem Mittwoch, vor dem Event.
  if (sent.has('stage2_wednesday') || stage2Day) {
    const from = stage2Day ?? start
    for (let i = stage2Day ? 1 : 0; i <= 7; i++) {
      const day = new Date(from.getTime() + i * DAY_MS)
      if (day.getTime() > event.getTime()) break
      if (day.getUTCDay() !== POLL_CRON_WEEKDAY) continue
      const at = new Date(day.getTime() + POLL_CRON_HOUR_UTC * 60 * 60 * 1000)
      if (at.getTime() > now.getTime()) {
        out.push({ type: 'poll_thursday', at: at.toISOString(), eventDate, label: PING_LABELS.poll_thursday })
      }
      break
    }
  }

  return out
}

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
  health: {
    ok: boolean
    issues: string[]
  }
  nextPings: NextPing[]
  nextEvent: { date: string; daysUntil: number; duo: string[] } | null
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

  // Ausstehende Pings — nur für die Termine, die der Reminder-Cron überhaupt
  // betrachtet (die nächsten 5), sonst würden Prognosen weit hinten auftauchen.
  const now = new Date()
  const nextPings = events
    .slice(0, REMINDER_EVENT_WINDOW)
    .flatMap(e => predictPings(e.event_date, new Set(remByEvent.get(e.id) ?? []), now))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 8)

  const nextEvent = upcoming.length
    ? { date: upcoming[0].date, daysUntil: upcoming[0].daysUntil, duo: upcoming[0].duo }
    : null

  const issues: string[] = []
  if (feed === null) issues.push('Kalender-Feed nicht erreichbar.')
  if (staleInDb.length) issues.push(`${staleInDb.length} Termin(e) in der Datenbank stehen nicht mehr im Feed.`)
  if (missingFromDb.length) issues.push(`${missingFromDb.length} Feed-Termin(e) fehlen in der Datenbank.`)
  for (const ev of upcoming) {
    if (ev.daysUntil <= 7 && ev.duo.length === 0) {
      issues.push(`Termin am ${ev.date} in ${ev.daysUntil} Tag(en) hat noch keine Einteilung.`)
    }
  }

  return {
    health: { ok: issues.length === 0, issues },
    nextPings,
    nextEvent,
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
