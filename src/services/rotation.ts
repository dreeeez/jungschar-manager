import { getSupabase } from './database'

const ROTATION_WINDOW_DAYS = 84 // 12 Wochen
const HISTORY_WINDOW_DAYS = 180 // letzte 6 Monate für Fairness-Score
const HELPERS_PER_EVENT = 2

export interface RotationCandidate {
  id: string
  name: string
  username: string | null
  isSenior: boolean
  count: number
  lastAssigned: string | null
}

export interface RotationProposal {
  eventId: string
  eventDate: string
  helpers: RotationCandidate[]
}

export interface RotationResult {
  proposals: RotationProposal[]
  skipped: { eventId: string; eventDate: string; reason: string }[]
}

function todayLocal(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function localDateString(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

function pickPartner(
  picked: RotationCandidate,
  pool: RotationCandidate[],
): RotationCandidate | null {
  const others = pool.filter(h => h.id !== picked.id)
  if (others.length === 0) return null

  const sortByScore = (a: RotationCandidate, b: RotationCandidate) => {
    if (a.count !== b.count) return a.count - b.count
    if (a.lastAssigned !== b.lastAssigned) {
      return (a.lastAssigned ?? '').localeCompare(b.lastAssigned ?? '')
    }
    return a.name.localeCompare(b.name)
  }

  // Bevorzuge anderen Tier (Senior+Junior). 2 gleiche Tier nur, wenn der
  // beste gleiche Tier mindestens 2 Einsätze weniger hat als der beste
  // andere Tier.
  const oppositeTier = others.filter(h => h.isSenior !== picked.isSenior).sort(sortByScore)
  const sameTier = others.filter(h => h.isSenior === picked.isSenior).sort(sortByScore)

  if (oppositeTier.length === 0) return sameTier[0]
  if (sameTier.length === 0) return oppositeTier[0]

  const bestOpp = oppositeTier[0]
  const bestSame = sameTier[0]
  if (bestSame.count + 2 <= bestOpp.count) return bestSame
  return bestOpp
}

function pickFirst(pool: RotationCandidate[]): RotationCandidate | null {
  if (pool.length === 0) return null
  const sorted = [...pool].sort((a, b) => {
    if (a.count !== b.count) return a.count - b.count
    if (a.lastAssigned !== b.lastAssigned) {
      return (a.lastAssigned ?? '').localeCompare(b.lastAssigned ?? '')
    }
    return a.name.localeCompare(b.name)
  })
  return sorted[0]
}

/**
 * Generiert einen Rotations-Vorschlag für die nächsten 12 Wochen.
 * Schreibt nichts in die DB — nur Vorschlag.
 */
export async function generateRotation(): Promise<RotationResult> {
  const db = getSupabase()
  const today = todayLocal()
  const horizon = new Date(today.getTime() + ROTATION_WINDOW_DAYS * 24 * 3600 * 1000)
  const historyStart = new Date(today.getTime() - HISTORY_WINDOW_DAYS * 24 * 3600 * 1000)

  const todayIso = localDateString(today)
  const horizonIso = localDateString(horizon)
  const historyStartIso = localDateString(historyStart)

  // 1. Helfer laden
  const { data: helpersData, error: helpersErr } = await db
    .from('helpers')
    .select('id, name, telegram_username, is_admin, is_senior')
  if (helpersErr) throw helpersErr

  // is_senior ist über Migration 006 hinzugekommen — als any lesen.
  const helpers = (helpersData ?? []).map((h: any) => ({
    id: h.id as string,
    name: h.name as string,
    username: h.telegram_username as string | null,
    isSenior: !!h.is_senior,
  }))

  if (helpers.length < HELPERS_PER_EVENT) {
    return { proposals: [], skipped: [] }
  }

  // 2. Events im Score-Fenster [history-start, horizon] laden, dann
  //    Assignments separat nach event_id filtern (Postgrest filter-on-join
  //    ist umständlich).
  const { data: scopeEvents, error: scopeErr } = await db
    .from('events')
    .select('id, event_date')
    .gte('event_date', historyStartIso)
    .lte('event_date', horizonIso)
  if (scopeErr) throw scopeErr

  const eventDateById = new Map<string, string>()
  for (const e of (scopeEvents ?? []) as any[]) {
    eventDateById.set(e.id, e.event_date)
  }

  const eventIds = [...eventDateById.keys()]
  const scopeAssign = eventIds.length > 0
    ? (await db.from('assignments').select('helper_id, event_id').in('event_id', eventIds)).data
    : []

  // 3. Score pro Helfer (Anzahl Einsätze + jüngstes Einsatz-Datum)
  const counts = new Map<string, number>()
  const lastAssigned = new Map<string, string>()
  for (const a of (scopeAssign ?? []) as any[]) {
    const date = eventDateById.get(a.event_id)
    if (!date) continue
    counts.set(a.helper_id, (counts.get(a.helper_id) ?? 0) + 1)
    const prev = lastAssigned.get(a.helper_id)
    if (!prev || date > prev) {
      lastAssigned.set(a.helper_id, date)
    }
  }

  // 4. Zukünftige Events im 12-Wochen-Fenster
  const { data: futureEvents, error: eventsErr } = await db
    .from('events')
    .select('id, event_date, assignments(helper_id, helper:helpers(id, name, telegram_username))')
    .gte('event_date', todayIso)
    .lte('event_date', horizonIso)
    .order('event_date', { ascending: true })
  if (eventsErr) throw eventsErr

  const proposals: RotationProposal[] = []
  const skipped: RotationResult['skipped'] = []

  // Mutable-Score während wir iterativ einteilen
  const candidates = (): RotationCandidate[] => helpers.map(h => ({
    ...h,
    count: counts.get(h.id) ?? 0,
    lastAssigned: lastAssigned.get(h.id) ?? null,
  }))

  for (const evt of (futureEvents ?? []) as any[] ) {
    const existingHelperIds = (evt.assignments ?? []).map((a: any) => a.helper_id) as string[]

    if (existingHelperIds.length >= HELPERS_PER_EVENT) {
      skipped.push({
        eventId: evt.id,
        eventDate: evt.event_date,
        reason: `bereits ${existingHelperIds.length} Helfer eingeteilt`,
      })
      continue
    }

    const slotsNeeded = HELPERS_PER_EVENT - existingHelperIds.length
    const pool = candidates().filter(c => !existingHelperIds.includes(c.id))

    const chosen: RotationCandidate[] = []
    if (slotsNeeded === 1 && existingHelperIds.length === 1) {
      // Es gibt schon einen Helfer — wähle Partner mit Tier-Präferenz.
      const existingHelper = helpers.find(h => h.id === existingHelperIds[0])
      if (existingHelper) {
        const stub: RotationCandidate = {
          ...existingHelper,
          count: counts.get(existingHelper.id) ?? 0,
          lastAssigned: lastAssigned.get(existingHelper.id) ?? null,
        }
        const partner = pickPartner(stub, pool)
        if (partner) chosen.push(partner)
      }
    } else {
      // 2 Slots offen — pick first, dann Partner
      const first = pickFirst(pool)
      if (first) {
        chosen.push(first)
        const partner = pickPartner(first, pool)
        if (partner) chosen.push(partner)
      }
    }

    if (chosen.length < slotsNeeded) {
      skipped.push({
        eventId: evt.id,
        eventDate: evt.event_date,
        reason: 'nicht genug verfügbare Helfer',
      })
      continue
    }

    // Existierende Helfer in die Anzeige mit reinnehmen
    const existingDisplay: RotationCandidate[] = (evt.assignments ?? [])
      .filter((a: any) => a.helper)
      .map((a: any) => ({
        id: a.helper.id,
        name: a.helper.name,
        username: a.helper.telegram_username ?? null,
        isSenior: helpers.find(h => h.id === a.helper.id)?.isSenior ?? false,
        count: counts.get(a.helper.id) ?? 0,
        lastAssigned: lastAssigned.get(a.helper.id) ?? null,
      }))

    proposals.push({
      eventId: evt.id,
      eventDate: evt.event_date,
      helpers: [...existingDisplay, ...chosen],
    })

    // Score updaten für nächste Iteration
    for (const c of chosen) {
      counts.set(c.id, (counts.get(c.id) ?? 0) + 1)
      if (!lastAssigned.get(c.id) || evt.event_date > lastAssigned.get(c.id)!) {
        lastAssigned.set(c.id, evt.event_date)
      }
    }
  }

  return { proposals, skipped }
}

/**
 * Schreibt den Vorschlag in assignments und gibt die geschriebenen Pärchen zurück.
 * Existierende Assignments werden NICHT angefasst — nur fehlende Slots aufgefüllt.
 */
export async function commitRotation(proposals: RotationProposal[]): Promise<{ inserted: number }> {
  const db = getSupabase()
  let inserted = 0

  for (const p of proposals) {
    const { data: existing } = await db
      .from('assignments')
      .select('helper_id')
      .eq('event_id', p.eventId)
    const existingIds = new Set(((existing ?? []) as any[]).map(a => a.helper_id))

    const toInsert = p.helpers
      .filter(h => !existingIds.has(h.id))
      .map(h => ({ event_id: p.eventId, helper_id: h.id }))

    if (toInsert.length === 0) continue

    const { error } = await db.from('assignments').insert(toInsert as any)
    if (error) {
      console.error(`Insert failed for event ${p.eventId}:`, error)
      continue
    }
    inserted += toInsert.length
  }

  return { inserted }
}

/**
 * Baut den Telegram-Nachrichten-Text für die Einteilung.
 */
export function formatRotationMessage(proposals: RotationProposal[]): string {
  if (proposals.length === 0) return 'Keine Termine im Planungsfenster.'

  const fmt = (iso: string) => {
    const d = new Date(iso + 'T12:00:00')
    return new Intl.DateTimeFormat('de-DE', {
      weekday: 'short', day: '2-digit', month: '2-digit',
    }).format(d)
  }

  const tag = (h: RotationCandidate) =>
    h.username ? `@${h.username}` : h.name

  const monthRange = (() => {
    const first = new Date(proposals[0].eventDate + 'T12:00:00')
    const last = new Date(proposals[proposals.length - 1].eventDate + 'T12:00:00')
    const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'long' })
    const a = monthFmt.format(first)
    const b = monthFmt.format(last)
    return a === b ? a : `${a}–${b}`
  })()

  const lines = proposals.map(p =>
    `• ${fmt(p.eventDate)} — ${p.helpers.map(tag).join(' &amp; ')}`,
  )

  return [
    `📅 <b>Jungschar-Einteilung ${monthRange}</b>`,
    '',
    ...lines,
    '',
    'Falls etwas nicht passt: einfach hier melden, dann tauschen wir.',
  ].join('\n')
}
