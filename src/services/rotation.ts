import { getSupabase } from './database'
import { sendTelegramMessage } from './reminders'

/**
 * Halbjahres-Einteilung.
 *
 * Bewusst einfach gehalten:
 *  - Ein Halbjahr = alle Termine bis Ende Februar (HJ 1, ab September)
 *    bzw. bis Ende August (HJ 2, ab März).
 *  - Zwei Helfer pro Termin, immer Senior + Junior. Zwei Senioren sind
 *    erlaubt, wenn die Verteilung es verlangt. Zwei Junioren nie.
 *  - Fair: jeder kommt im Halbjahr gleich oft dran. Gezählt wird nur
 *    innerhalb des Halbjahres, die Vergangenheit spielt keine Rolle.
 *  - Kein Automatismus. Ausgelöst wird ausschließlich über den Button
 *    "Halbjahr einteilen" in der Mini-App.
 *
 * Ablauf: Vorschau → in die Sandbox-Gruppe posten (speichert die
 * Einteilung, damit Tausche in der App die Nachricht aktualisieren) →
 * wenn alles passt, in die Helfer-Gruppe posten (postet den aktuellen
 * Stand, keine Neuberechnung).
 */

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

export interface HalfYearWindow {
  number: 1 | 2
  label: string
  from: string
  until: string
}

export interface RotationResult {
  window: HalfYearWindow
  proposals: RotationProposal[]
  skipped: { eventId: string; eventDate: string; reason: string }[]
  helpers: { seniors: number; juniors: number }
}

function localIso(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

function lastDayOfFeb(year: number): string {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  return leap ? '29' : '28'
}

/** Halbjahr, in das {today} fällt. HJ 1 = Sep–Feb, HJ 2 = Mär–Aug. */
export function halfYearWindow(today = new Date()): HalfYearWindow {
  const iso = localIso(today)
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  if (m >= 9) {
    return { number: 1, from: iso, until: `${y + 1}-02-${lastDayOfFeb(y + 1)}`, label: `Halbjahr 1 · Sep ${y} – Feb ${y + 1}` }
  }
  if (m <= 2) {
    return { number: 1, from: iso, until: `${y}-02-${lastDayOfFeb(y)}`, label: `Halbjahr 1 · Sep ${y - 1} – Feb ${y}` }
  }
  return { number: 2, from: iso, until: `${y}-08-31`, label: `Halbjahr 2 · Mär – Aug ${y}` }
}

/** Wer am wenigsten dran war; bei Gleichstand wer am längsten nicht, dann Name. */
function pickLowest(pool: RotationCandidate[]): RotationCandidate | null {
  if (pool.length === 0) return null
  return [...pool].sort((a, b) => {
    if (a.count !== b.count) return a.count - b.count
    if (a.lastAssigned !== b.lastAssigned) return (a.lastAssigned ?? '').localeCompare(b.lastAssigned ?? '')
    return a.name.localeCompare(b.name)
  })[0]
}

/**
 * Partner nach der Regel Senior + Junior. Erster Helfer Junior → Partner
 * muss Senior sein. Erster Helfer Senior → Junior, außer ein anderer
 * Senior liegt mindestens einen Einsatz zurück (dann zwei Senioren).
 */
function pickPartner(first: RotationCandidate, pool: RotationCandidate[]): RotationCandidate | null {
  const others = pool.filter(h => h.id !== first.id)
  const seniors = others.filter(h => h.isSenior)
  const juniors = others.filter(h => !h.isSenior)
  if (!first.isSenior) return pickLowest(seniors)
  const bestJ = pickLowest(juniors)
  const bestS = pickLowest(seniors)
  if (!bestJ) return bestS
  if (bestS && bestS.count + 1 <= bestJ.count) return bestS
  return bestJ
}

async function loadHelpers() {
  const { data, error } = await getSupabase()
    .from('helpers')
    .select('id, name, telegram_username, is_senior')
    .order('name')
  if (error) throw error
  return (data ?? []).map((h: any) => ({
    id: h.id as string,
    name: h.name as string,
    username: (h.telegram_username as string | null) ?? null,
    isSenior: !!h.is_senior,
  }))
}

async function loadWindowEvents(win: HalfYearWindow) {
  const { data, error } = await getSupabase()
    .from('events')
    .select('id, event_date, assignments(helper_id, helper:helpers(id, name, telegram_username, is_senior))')
    .gte('event_date', win.from)
    .lte('event_date', win.until)
    .order('event_date', { ascending: true })
  if (error) throw error
  return (data ?? []) as any[]
}

/**
 * Frischer Vorschlag für das laufende Halbjahr. Bestehende Zuweisungen im
 * Fenster werden ignoriert (und beim Speichern ersetzt). Schreibt nichts.
 */
export async function generateHalfYearRotation(): Promise<RotationResult> {
  const win = halfYearWindow()
  const helpers = await loadHelpers()
  const events = await loadWindowEvents(win)

  const seniors = helpers.filter(h => h.isSenior).length
  const juniors = helpers.length - seniors
  const result: RotationResult = { window: win, proposals: [], skipped: [], helpers: { seniors, juniors } }
  if (helpers.length < HELPERS_PER_EVENT) return result

  const counts = new Map<string, number>()
  const last = new Map<string, string>()
  const pool = (): RotationCandidate[] =>
    helpers.map(h => ({ ...h, count: counts.get(h.id) ?? 0, lastAssigned: last.get(h.id) ?? null }))

  for (const evt of events) {
    const first = pickLowest(pool())
    const partner = first ? pickPartner(first, pool()) : null
    if (!first || !partner) {
      result.skipped.push({ eventId: evt.id, eventDate: evt.event_date, reason: 'kein passendes Senior/Junior-Paar verfügbar' })
      continue
    }
    const pair = first.isSenior ? [first, partner] : [partner, first]
    result.proposals.push({ eventId: evt.id, eventDate: evt.event_date, helpers: pair })
    for (const h of pair) {
      counts.set(h.id, (counts.get(h.id) ?? 0) + 1)
      last.set(h.id, evt.event_date)
    }
  }
  return result
}

/** Aktuelle Zuweisungen im Halbjahr als Proposals (für den Live-Post). */
async function currentHalfYearAssignments(): Promise<{ window: HalfYearWindow; proposals: RotationProposal[] }> {
  const win = halfYearWindow()
  const events = await loadWindowEvents(win)
  const proposals: RotationProposal[] = events
    .filter(e => (e.assignments?.length ?? 0) > 0)
    .map(e => ({
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
        }))
        .sort((a: RotationCandidate, b: RotationCandidate) => Number(b.isSenior) - Number(a.isSenior)),
    }))
  return { window: win, proposals }
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
 * propagiert. disable_notification ist true → kein Push für alle.
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
      }))
      .sort((a: RotationCandidate, b: RotationCandidate) => Number(b.isSenior) - Number(a.isSenior)),
  }))

  const title = halfYearWindow(new Date(proposals[0].eventDate + 'T12:00:00')).label
  const text = formatRotationMessage(proposals, title)
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

/**
 * Rückt die Einteilung nach, wenn der Termin {cancelledEventId} ausfällt:
 * Jeder spätere Termin im selben Pin-Batch übernimmt das Duo des vorherigen
 * (Slot-Shift — geplante Paarungen bleiben erhalten, nur um einen Platz
 * verschoben). Das frei werdende letzte Duo geht zurück in den Pool. Der
 * ausgefallene Termin verlässt den Pin (rotation_message_id -> null), damit
 * keine leere Zeile bleibt, danach wird die Nachricht neu gerendert.
 *
 * Liefert null, wenn der Termin keinem Pin-Batch angehört (nichts zu shiften).
 */
export async function shiftRotationOnCancellation(
  cancelledEventId: string,
): Promise<{ shifted: number; messageId: number } | null> {
  const db = getSupabase()

  const { data: cancelled } = await (db as any)
    .from('events')
    .select('event_date, rotation_message_id')
    .eq('id', cancelledEventId)
    .maybeSingle()

  const messageId: number | null = cancelled?.rotation_message_id ?? null
  if (!cancelled || !messageId) return null

  // Alle Termine dieses Pins ab dem Ausfall-Datum (inklusive), chronologisch.
  const { data: batch } = await (db as any)
    .from('events')
    .select('id, event_date')
    .eq('rotation_message_id', messageId)
    .gte('event_date', cancelled.event_date)
    .order('event_date', { ascending: true })

  const events = (batch ?? []) as { id: string; event_date: string }[]
  const ids = events.map(e => e.id)

  // Aktuelle Duos je Termin laden — VOR dem Löschen.
  const { data: assigns } = await db
    .from('assignments')
    .select('event_id, helper_id')
    .in('event_id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'])
  const duoByEvent = new Map<string, string[]>()
  for (const a of (assigns ?? []) as any[]) {
    const arr = duoByEvent.get(a.event_id) ?? []
    arr.push(a.helper_id)
    duoByEvent.set(a.event_id, arr)
  }

  // Slot-Shift: event[i] erbt das Duo von event[i-1]. event[0] (Ausfall)
  // bleibt leer, das letzte Duo der Kette wird freigesetzt.
  const newAssign: { event_id: string; helper_id: string }[] = []
  for (let i = 1; i < events.length; i++) {
    for (const hid of duoByEvent.get(events[i - 1].id) ?? []) {
      newAssign.push({ event_id: events[i].id, helper_id: hid })
    }
  }

  // Schreiben: alte Zuweisungen der Batch-Termine weg, neue setzen.
  if (ids.length > 0) {
    await db.from('assignments').delete().in('event_id', ids)
  }
  if (newAssign.length > 0) {
    await db.from('assignments').insert(newAssign as any)
  }

  // Ausgefallenen Termin aus dem Pin nehmen (sonst leere Zeile im Pin).
  await (db as any)
    .from('events')
    .update({ rotation_message_id: null, rotation_chat_id: null })
    .eq('id', cancelledEventId)

  await rerenderRotationMessage(messageId)

  return { shifted: Math.max(0, events.length - 1), messageId }
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
export function formatRotationMessage(proposals: RotationProposal[], title?: string): string {
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
  lines.push(`📅 <b>Jungschar-Einteilung${title ? ` · ${title}` : ''}</b>`)
  lines.push('')

  for (const [, ps] of groups) {
    const { name, num } = monthLabel(ps[0].eventDate)
    const emoji = MONTH_EMOJI[num] ?? '📅'
    lines.push(`${emoji} <b>${name}</b>`)
    for (const p of ps) {
      lines.push(`▶ ${fmtDay(p.eventDate)}  ${p.helpers.map(tag).join(' ')}`)
    }
    lines.push('')
  }

  lines.push('👍 Nehmt euch bitte kurz Zeit zu schauen, ob es bei euch passt - gerne mit Daumen hoch reacten.')
  lines.push('')
  lines.push('🤝 Falls es nicht passt: Hier melden! Dann tauschen wir!')

  return lines.join('\n')
}

export interface ExecuteHalfYearOptions {
  chatId: string
  /** true = Sandbox-Gruppe: neu berechnen, speichern, posten. false = Helfer-Gruppe: aktuellen Stand posten. */
  isTest: boolean
}

export interface ExecuteHalfYearResult {
  mode: 'sandbox' | 'live'
  window: HalfYearWindow
  proposals: RotationProposal[]
  skipped: RotationResult['skipped']
  replaced: number
  inserted: number
  messageId: number | null
  telegram: any
}

async function postAndPin(chatId: string, text: string, eventIds: string[]): Promise<{ messageId: number | null; telegram: any }> {
  const db = getSupabase()
  const targetChatId = parseInt(chatId)

  // Alte Pins dieses Chats lösen.
  const { data: oldMsgs } = await db
    .from('events')
    .select('rotation_message_id, rotation_chat_id')
    .eq('rotation_chat_id', targetChatId)
    .not('rotation_message_id', 'is', null)
  const seen = new Set<number>()
  for (const row of (oldMsgs ?? []) as any[]) {
    if (seen.has(row.rotation_message_id)) continue
    seen.add(row.rotation_message_id)
    await unpinTelegramMessage(row.rotation_chat_id, row.rotation_message_id)
  }

  const send = await sendTelegramMessage(chatId, text)
  const messageId: number | null = send?.result?.message_id ?? null
  const resolvedChatId: number = send?.result?.chat?.id ?? targetChatId
  if (messageId) {
    await tagEventsWithRotationMessage(eventIds, messageId, resolvedChatId)
    await pinTelegramMessage(resolvedChatId, messageId)
  }
  return { messageId, telegram: send }
}

/**
 * Sandbox: Halbjahr neu berechnen, Zuweisungen im Fenster ersetzen, in die
 * Sandbox-Gruppe posten und pinnen. Tausche in der App editieren danach
 * diese Nachricht.
 * Live: den aktuellen Stand der Zuweisungen in die Helfer-Gruppe posten und
 * pinnen. Keine Neuberechnung, damit Korrekturen aus der Sandbox-Phase
 * erhalten bleiben. Gibt es noch keine Zuweisungen, wird einmal berechnet.
 */
export async function executeHalfYearRotation(opts: ExecuteHalfYearOptions): Promise<ExecuteHalfYearResult> {
  const db = getSupabase()
  let replaced = 0
  let inserted = 0
  let proposals: RotationProposal[]
  let skipped: RotationResult['skipped'] = []
  let win: HalfYearWindow

  const current = await currentHalfYearAssignments()
  const needsFresh = opts.isTest || current.proposals.length === 0

  if (needsFresh) {
    const plan = await generateHalfYearRotation()
    win = plan.window
    proposals = plan.proposals
    skipped = plan.skipped
    const eventIds = proposals.map(p => p.eventId)
    if (eventIds.length > 0) {
      const { data: old } = await db.from('assignments').select('id').in('event_id', eventIds)
      replaced = old?.length ?? 0
      await db.from('assignments').delete().in('event_id', eventIds)
      const rows = proposals.flatMap(p => p.helpers.map(h => ({ event_id: p.eventId, helper_id: h.id })))
      const { error } = await db.from('assignments').insert(rows as any)
      if (error) throw error
      inserted = rows.length
    }
  } else {
    win = current.window
    proposals = current.proposals
  }

  const result: ExecuteHalfYearResult = {
    mode: opts.isTest ? 'sandbox' : 'live',
    window: win,
    proposals,
    skipped,
    replaced,
    inserted,
    messageId: null,
    telegram: null,
  }
  if (proposals.length === 0) return result

  const text = formatRotationMessage(proposals, win.label)
  const posted = await postAndPin(opts.chatId, text, proposals.map(p => p.eventId))
  result.messageId = posted.messageId
  result.telegram = posted.telegram
  return result
}
