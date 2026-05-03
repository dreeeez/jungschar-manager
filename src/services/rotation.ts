import { getSupabase } from './database'
import { sendTelegramMessage } from './reminders'

const ROTATION_WINDOW_DAYS = 240 // ~8 Monate, deckt alle aktuellen iCal-Termine
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

  // Bevorzuge anderen Tier (Senior+Junior). 2 gleiche Tier wenn der beste
  // gleiche Tier mindestens 1 Einsatz weniger hat als der beste andere Tier
  // — sorgt für gelegentliche 2-Senior- (oder 2-Junior-) Pärchen, wenn
  // die Verteilung das verlangt.
  const oppositeTier = others.filter(h => h.isSenior !== picked.isSenior).sort(sortByScore)
  const sameTier = others.filter(h => h.isSenior === picked.isSenior).sort(sortByScore)

  if (oppositeTier.length === 0) return sameTier[0]
  if (sameTier.length === 0) return oppositeTier[0]

  const bestOpp = oppositeTier[0]
  const bestSame = sameTier[0]
  if (bestSame.count + 1 <= bestOpp.count) return bestSame
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

  const todayIso = localDateString(today)
  const horizonIso = localDateString(horizon)

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

  // 2. Score: NUR bestehende Assignments im Planungs-Fenster zählen.
  //    Historie wird ignoriert — User-Intent: "alle 9 gleich oft" für die
  //    kommende Runde, unabhängig von dem was vorher war.
  const { data: scopeEvents, error: scopeErr } = await db
    .from('events')
    .select('id, event_date')
    .gte('event_date', todayIso)
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
 * Markiert die übergebenen Events mit message_id + chat_id, sodass spätere
 * Helfer-Tausche im Mini-App die Nachricht editieren können.
 */
export async function tagEventsWithRotationMessage(
  eventIds: string[],
  messageId: number,
  chatId: number,
): Promise<void> {
  if (eventIds.length === 0) return
  const db = getSupabase()
  const { error } = await (db as any)
    .from('events')
    .update({ rotation_message_id: messageId, rotation_chat_id: chatId })
    .in('id', eventIds)
  if (error) console.error('tagEventsWithRotationMessage failed:', error)
}

/**
 * Pinnt eine Telegram-Nachricht. Best-effort — Failures werden geloggt, nicht
 * propagiert. Verhindert disable_notification ist true → kein Push für alle.
 */
export async function pinTelegramMessage(chatId: string | number, messageId: number): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/pinChatMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, disable_notification: true }),
    })
    const json = await res.json()
    if (!json.ok) {
      console.error('pinChatMessage failed:', json)
      return false
    }
    return true
  } catch (e) {
    console.error('pinChatMessage error:', e)
    return false
  }
}

export async function unpinTelegramMessage(chatId: string | number, messageId: number): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/unpinChatMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    })
    const json = await res.json()
    return !!json.ok
  } catch {
    return false
  }
}

/**
 * Editiert die Telegram-Nachricht mit der aktuellen Helfer-Verteilung der
 * darin enthaltenen Events. Wird vom Mini-App nach jedem Helfer-Tausch
 * aufgerufen.
 */
export async function rerenderRotationMessage(messageId: number): Promise<{ ok: boolean; reason?: string }> {
  const db = getSupabase()

  const { data: events, error } = await db
    .from('events')
    .select('id, event_date, rotation_chat_id, assignments(helper_id, helper:helpers(id, name, telegram_username, is_senior))')
    .eq('rotation_message_id', messageId)
    .order('event_date', { ascending: true })

  if (error) return { ok: false, reason: error.message }
  if (!events || events.length === 0) return { ok: false, reason: 'no events' }

  const chatId = (events[0] as any).rotation_chat_id
  if (!chatId) return { ok: false, reason: 'no chat_id' }

  const proposals: RotationProposal[] = (events as any[]).map(e => ({
    eventId: e.id,
    eventDate: e.event_date,
    helpers: (e.assignments ?? [])
      .filter((a: any) => a.helper)
      .map((a: any) => ({
        id: a.helper.id,
        name: a.helper.name,
        username: a.helper.telegram_username ?? null,
        isSenior: !!a.helper.is_senior,
        count: 0,
        lastAssigned: null,
      })),
  }))

  const text = formatRotationMessage(proposals)
  const token = process.env.TELEGRAM_BOT_TOKEN

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
      }),
    })
    const json = await res.json()
    if (!json.ok) {
      // "message is not modified" ist kein echter Fehler
      if (typeof json.description === 'string' && json.description.includes('not modified')) {
        return { ok: true }
      }
      return { ok: false, reason: json.description ?? 'edit failed' }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, reason: e.message ?? 'fetch failed' }
  }
}

const MONTH_EMOJI: Record<number, string> = {
  1: '❄️', 2: '❄️', 3: '🌱', 4: '🌷', 5: '🌸',
  6: '☀️', 7: '☀️', 8: '🏖️', 9: '🍂', 10: '🎃', 11: '🍁', 12: '🎄',
}
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/**
 * Baut den Telegram-Nachrichten-Text für die Einteilung.
 * Gruppiert nach Monat mit Emoji-Header.
 */
export function formatRotationMessage(proposals: RotationProposal[]): string {
  if (proposals.length === 0) return 'Keine Termine im Planungsfenster.'

  const fmtDay = (iso: string) => {
    const d = new Date(iso + 'T12:00:00')
    return `${WEEKDAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
  }
  const monthLabel = (iso: string) => {
    const d = new Date(iso + 'T12:00:00')
    const name = new Intl.DateTimeFormat('de-DE', { month: 'long' }).format(d)
    const year = d.getFullYear()
    return { name, year, num: d.getMonth() + 1 }
  }
  const tag = (h: RotationCandidate) =>
    h.username ? `@${h.username}` : `<i>${h.name}</i>`

  const groups = new Map<string, RotationProposal[]>()
  for (const p of proposals) {
    const { name, year } = monthLabel(p.eventDate)
    const key = `${year}-${name}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }

  const lines: string[] = []
  lines.push('📅 <b>Jungschar-Einteilung</b>')
  lines.push(`<i>${proposals.length} Termine</i>`)
  lines.push('')

  for (const [, ps] of groups) {
    const { name, num } = monthLabel(ps[0].eventDate)
    const emoji = MONTH_EMOJI[num] ?? '📅'
    lines.push(`${emoji} <b>${name}</b>`)
    for (const p of ps) {
      lines.push(`➡️ ${fmtDay(p.eventDate)} - ${p.helpers.map(tag).join(' &amp; ')}`)
    }
  }

  lines.push('')
  lines.push('👍 Nehmt euch bitte kurz Zeit zu schauen, ob es bei euch passt - gerne mit Daumen hoch reacten.')
  lines.push('')
  lines.push('🤝 Falls es nicht passt: Hier melden! Dann tauschen wir!')

  return lines.join('\n')
}

export interface ExecuteRotationOptions {
  chatId: string | number
  isTest: boolean
  splitAt?: string | null
  untilDate?: string | null
}

export interface ExecuteRotationResult {
  proposals: RotationProposal[]
  skipped: RotationResult['skipped']
  inserted: number
  messageIds: number[]
  telegram: any[]
}

/**
 * End-to-end Rotation: generieren → alte unpinnen → Posts senden → tagen +
 * pinnen → DB-Writes (außer im Test-Mode). Wird sowohl von der API-Route
 * als auch vom Daily-Cron aufgerufen.
 */
/**
 * Baut Proposals aus bereits eingeteilten Events (für den Fall, dass
 * nichts Neues mehr zu generieren ist, aber wir die aktuelle Einteilung
 * trotzdem als Übersichts-Nachricht posten wollen).
 */
async function buildProposalsFromExisting(untilDate?: string | null): Promise<RotationProposal[]> {
  const db = getSupabase()
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  let query: any = (db as any)
    .from('events')
    .select('id, event_date, assignments(helper_id, helper:helpers(id, name, telegram_username, is_senior))')
    .gte('event_date', todayIso)
    .order('event_date', { ascending: true })
  if (untilDate) query = query.lte('event_date', untilDate)
  const { data } = await query

  return (data ?? [])
    .filter((e: any) => (e.assignments?.length ?? 0) > 0)
    .map((e: any) => ({
      eventId: e.id,
      eventDate: e.event_date,
      helpers: (e.assignments ?? [])
        .filter((a: any) => a.helper)
        .map((a: any) => ({
          id: a.helper.id,
          name: a.helper.name,
          username: a.helper.telegram_username ?? null,
          isSenior: !!a.helper.is_senior,
          count: 0,
          lastAssigned: null,
        })),
    }))
}

export async function executeRotation(opts: ExecuteRotationOptions): Promise<ExecuteRotationResult> {
  const { chatId, isTest, splitAt, untilDate } = opts
  const rotation = await generateRotation()

  // untilDate: nur Termine bis inklusive dieses Datums posten/persistieren
  let filteredProposals = untilDate
    ? rotation.proposals.filter(p => p.eventDate <= untilDate)
    : rotation.proposals

  // Fallback: wenn es nichts Neues zu posten gibt, aber bestehende
  // Einteilungen im Fenster vorhanden sind, posten wir die als Übersicht.
  if (filteredProposals.length === 0) {
    filteredProposals = await buildProposalsFromExisting(untilDate)
  }

  const result: ExecuteRotationResult = {
    proposals: filteredProposals,
    skipped: rotation.skipped,
    inserted: 0,
    messageIds: [],
    telegram: [],
  }

  if (filteredProposals.length === 0) return result

  const batches = splitAt
    ? [
        filteredProposals.filter(p => p.eventDate < splitAt),
        filteredProposals.filter(p => p.eventDate >= splitAt),
      ].filter(b => b.length > 0)
    : [filteredProposals]

  // Alte Rotations-Pins in dem Ziel-Chat unpinnen (sowohl Test als auch Live).
  {
    const db = getSupabase()
    const targetChatId = typeof chatId === 'string' ? parseInt(chatId) : chatId
    const { data: oldMsgs } = await db
      .from('events')
      .select('rotation_message_id, rotation_chat_id')
      .eq('rotation_chat_id', targetChatId)
      .not('rotation_message_id', 'is', null)
    const seen = new Set<string>()
    for (const row of (oldMsgs ?? []) as any[]) {
      const key = `${row.rotation_chat_id}:${row.rotation_message_id}`
      if (seen.has(key)) continue
      seen.add(key)
      await unpinTelegramMessage(row.rotation_chat_id, row.rotation_message_id)
    }
  }

  for (const batch of batches) {
    const text = formatRotationMessage(batch)
    const sendResult = await sendTelegramMessage(chatId as string, text)
    result.telegram.push(sendResult)

    const messageId = sendResult?.result?.message_id
    const resolvedChatId = sendResult?.result?.chat?.id ?? chatId
    if (messageId) {
      result.messageIds.push(messageId)
      // Auch im Test-Modus taggen, damit Auto-Edit-Funktion testbar ist.
      // Beim späteren Live-Post wird das Tagging sauber überschrieben.
      await tagEventsWithRotationMessage(
        batch.map(p => p.eventId),
        messageId,
        typeof resolvedChatId === 'string' ? parseInt(resolvedChatId) : resolvedChatId,
      )
      await pinTelegramMessage(resolvedChatId, messageId)
    }
  }

  if (!isTest) {
    const commit = await commitRotation(filteredProposals)
    result.inserted = commit.inserted
  }

  return result
}

/**
 * Daily-Cron-Hook: prüft, ob die letzte aktive Rotations-Nachricht durch
 * ist (alle Events past) und es zukünftige Events ohne Rotation gibt. Wenn
 * ja: postet die nächste Rotation in den Live-Chat (mit Halbjahr-Split).
 */
export async function maybeAutoRotate(chatId: string): Promise<{ triggered: boolean; reason?: string; result?: ExecuteRotationResult }> {
  const db = getSupabase()

  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  // 1. Latest pinned rotation: spätestes event_date mit message_id NOT NULL
  const { data: latestPinned } = await (db as any)
    .from('events')
    .select('event_date')
    .not('rotation_message_id', 'is', null)
    .order('event_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!latestPinned) return { triggered: false, reason: 'noch nie eine Rotation gepostet' }
  if (latestPinned.event_date >= todayIso) {
    return { triggered: false, reason: 'aktuelle Rotation noch nicht durch' }
  }

  // 2. Gibt es überhaupt zukünftige Events ohne rotation_message_id?
  const { data: futureUnassigned } = await (db as any)
    .from('events')
    .select('id')
    .gte('event_date', todayIso)
    .is('rotation_message_id', null)
    .limit(1)

  if (!futureUnassigned || futureUnassigned.length === 0) {
    return { triggered: false, reason: 'keine zukünftigen Events ohne Rotation' }
  }

  const splitDate = new Date()
  splitDate.setMonth(splitDate.getMonth() + 6)
  const splitAt = `${splitDate.getFullYear()}-${String(splitDate.getMonth() + 1).padStart(2, '0')}-${String(splitDate.getDate()).padStart(2, '0')}`

  const result = await executeRotation({ chatId, isTest: false, splitAt })
  return { triggered: true, result }
}
