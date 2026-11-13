import { getSupabase } from './database'
import { sendTelegramMessage } from './reminders'
import { APP_URL } from './admins'

/**
 * Einteilung in Blöcken zu je 4 Terminen.
 *
 *  - Sichtbar ist immer ein Block: eine gepinnte Nachricht in der
 *    Helfer-Gruppe mit 4 Terminen. Termine eines Blocks erkennt man an
 *    derselben events.rotation_message_id (+ rotation_chat_id = Helfer-Gruppe).
 *  - Ist der vorletzte Termin des Blocks vorbei, zieht der tägliche Cron den
 *    nächsten Block als Entwurf (Zuweisungen gespeichert, aber noch nicht
 *    gepostet) und schickt Marco eine DM. Der Entwurf lässt sich in der App
 *    prüfen, tauschen, neu ziehen.
 *  - Gepostet wird nur von Hand (App), meist in der Woche vor dem letzten
 *    Termin. Die neue Nachricht enthält die noch offenen Termine des alten
 *    Blocks (sonst verschwänden sie aus dem Pin) plus den neuen Block, wird
 *    gepinnt und löst den alten Pin.
 *  - Paare: immer Senior + Junior. Zwei Senioren nur, wenn ein Senior
 *    mindestens einen Einsatz zurückliegt. Zwei Junioren nie.
 *  - A-Team (helpers.is_ateam, Work and Travel): kommt nur gemeinsam als
 *    Duo dran, nie mit anderen. Ist einer davon am weitesten zurück, ist das
 *    ganze Duo dran.
 *  - Fair über die ganze Zeit (Quote): pro Helfer Ist (Einsätze) minus Soll
 *    (fairer Anteil an allen Terminen seit seiner Registrierung). Wer am
 *    weitesten zurückliegt, kommt zuerst dran. Neue Helfer starten bei 0,
 *    müssen also nichts aufholen und werden nicht verheizt.
 */

const HELPERS_PER_EVENT = 2
export const BLOCK_SIZE = 4
/** Bekommt die DM, wenn ein neuer Entwurf steht (Marco). */
const DRAFT_NOTIFY_IDS = [5856427770]
/** Hinweis nach Tauschen höchstens alle 30 Minuten (ein Tausch = zwei Änderungen). */
const HINT_COOLDOWN_MS = 30 * 60 * 1000

export interface RotationCandidate {
  id: string
  name: string
  username: string | null
  telegramUserId: number | null
  isSenior: boolean
  /** A-Team (Work and Travel): nur gemeinsam als Duo, nie mit anderen. */
  isATeam?: boolean
  /** Bilanz in Einsätzen: Ist minus Soll. Negativ = liegt zurück, ist dran. */
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

/** Halbjahr, in das {today} fällt. HJ 1 = Sep–Feb, HJ 2 = Mär–Aug. (Für den Elterndienst.) */
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

/* ---------- Quote ---------- */

/** Bis zu diesem Abstand (in Einsätzen) gilt eine Bilanz als Gleichstand. */
const TIE = 0.5

/**
 * Wer am weitesten zurückliegt. Bei (ungefährem) Gleichstand entscheidet der
 * Zufall, damit "Neu ziehen" eine neue Verteilung liefert. Wer beim direkt
 * vorherigen Termin dran war, wird dabei gemieden, solange es Alternativen gibt.
 */
function pickLowest(pool: RotationCandidate[], prevEventDate: string | null = null): RotationCandidate | null {
  if (pool.length === 0) return null
  const minCount = Math.min(...pool.map(h => h.count))
  let tied = pool.filter(h => h.count <= minCount + TIE)
  const rested = tied.filter(h => h.lastAssigned !== prevEventDate)
  if (rested.length > 0) tied = rested
  return tied[Math.floor(Math.random() * tied.length)]
}

/**
 * Partner nach der Regel Senior + Junior. Erster Helfer Junior → Partner
 * muss Senior sein. Erster Helfer Senior → Junior, außer ein anderer
 * Senior liegt mindestens einen Einsatz zurück (dann zwei Senioren).
 */
function pickPartner(first: RotationCandidate, pool: RotationCandidate[], prevEventDate: string | null): RotationCandidate | null {
  const others = pool.filter(h => h.id !== first.id)
  const seniors = others.filter(h => h.isSenior)
  const juniors = others.filter(h => !h.isSenior)
  if (!first.isSenior) return pickLowest(seniors, prevEventDate)
  const bestJ = pickLowest(juniors, prevEventDate)
  const bestS = pickLowest(seniors, prevEventDate)
  if (!bestJ) return bestS
  if (bestS && bestS.count + 1 <= bestJ.count) return bestS
  return bestJ
}

async function loadHelpers() {
  const { data, error } = await getSupabase()
    .from('helpers')
    .select('id, name, telegram_username, telegram_user_id, is_senior, is_ateam, created_at')
    .order('name')
  if (error) throw error
  return (data ?? []).map((h: any) => ({
    id: h.id as string,
    name: h.name as string,
    username: (h.telegram_username as string | null) ?? null,
    telegramUserId: h.telegram_user_id ? Number(h.telegram_user_id) : null,
    isSenior: !!h.is_senior,
    isATeam: !!h.is_ateam,
    since: h.created_at ? localIso(new Date(h.created_at)) : '0000-00-00',
  }))
}

/**
 * Bilanz aus allen Terminen mit Team vor {before} (auch schon eingeteilte,
 * noch kommende): Ist = Einsätze, Soll = fairer Anteil an jedem Termin, an
 * dem der Helfer schon dabei war (Registrierung oder erster Einsatz, was
 * früher ist). Pro Termin wird das Team gleichmäßig auf alle damals
 * Dabeigewesenen verteilt. Dazu das Team des letzten Termins davor.
 */
async function loadBalance(helpers: { id: string; since: string }[], before: string) {
  const { data, error } = await getSupabase()
    .from('events')
    .select('event_date, assignments(helper_id)')
    .lt('event_date', before)
    .order('event_date', { ascending: true })
  if (error) throw error
  const past = ((data ?? []) as any[]).filter(e => (e.assignments?.length ?? 0) > 0)

  const since = new Map(helpers.map(h => [h.id, h.since]))
  for (const e of past) {
    for (const a of e.assignments) {
      const s = since.get(a.helper_id)
      if (s && e.event_date < s) since.set(a.helper_id, e.event_date)
    }
  }

  const balance = new Map<string, number>(helpers.map(h => [h.id, 0]))
  for (const e of past) {
    const present = helpers.filter(h => (since.get(h.id) ?? '') <= e.event_date)
    if (present.length === 0) continue
    const share = e.assignments.length / present.length
    for (const h of present) balance.set(h.id, balance.get(h.id)! - share)
    for (const a of e.assignments) if (balance.has(a.helper_id)) balance.set(a.helper_id, balance.get(a.helper_id)! + 1)
  }
  const lastTeam: string[] = past.length ? past[past.length - 1].assignments.map((a: any) => a.helper_id) : []
  return { balance, lastTeam }
}

/** Bilanz aller Helfer vor {before} (für den Ersatz-Vorschlag in der App). */
export async function helperBalances(before: string): Promise<Record<string, number>> {
  const helpers = await loadHelpers()
  const { balance } = await loadBalance(helpers, before)
  return Object.fromEntries(balance)
}

export interface PlanResult {
  proposals: RotationProposal[]
  skipped: { eventId: string; eventDate: string; reason: string }[]
  helpers: { seniors: number; juniors: number }
  /** Bilanz vor dem ersten Termin, je Helfer-ID. */
  balances: Record<string, number>
}

/**
 * Besetzt {events} (chronologisch) per Quote. Ausgangspunkt ist die Bilanz
 * aller Termine davor. Schreibt nichts.
 */
async function planEvents(events: { id: string; event_date: string }[]): Promise<PlanResult> {
  const helpers = await loadHelpers()
  const seniors = helpers.filter(h => h.isSenior).length
  const result: PlanResult = { proposals: [], skipped: [], helpers: { seniors, juniors: helpers.length - seniors }, balances: {} }
  if (events.length === 0 || helpers.length < HELPERS_PER_EVENT) return result

  const { balance: counts, lastTeam } = await loadBalance(helpers, events[0].event_date)
  result.balances = Object.fromEntries(counts)
  const last = new Map<string, string>()
  const pool = (): RotationCandidate[] =>
    helpers.map(({ since, ...h }) => ({ ...h, count: counts.get(h.id) ?? 0, lastAssigned: last.get(h.id) ?? null }))

  let prevEventDate: string | null = null
  for (const id of lastTeam) {
    if (!counts.has(id)) continue
    last.set(id, 'last')
    prevEventDate = 'last'
  }
  // Soll pro geplantem Termin: das Team gleichmäßig auf alle verteilt.
  const sharePerEvent = HELPERS_PER_EVENT / helpers.length

  for (const evt of events) {
    let first = pickLowest(pool(), prevEventDate)
    let partner: RotationCandidate | null = null
    if (first?.isATeam) {
      // A-Team ist dran: das ganze Duo. Gibt es keinen zweiten, normal weiter.
      partner = pickLowest(pool().filter(h => h.isATeam && h.id !== first!.id), prevEventDate)
      if (!partner) first = pickLowest(pool().filter(h => !h.isATeam), prevEventDate)
    }
    if (first && !first.isATeam) partner = pickPartner(first, pool().filter(h => !h.isATeam), prevEventDate)
    if (!first || !partner) {
      result.skipped.push({ eventId: evt.id, eventDate: evt.event_date, reason: 'kein passendes Senior/Junior-Paar verfügbar' })
      continue
    }
    const pair = first.isSenior ? [first, partner] : [partner, first]
    result.proposals.push({ eventId: evt.id, eventDate: evt.event_date, helpers: pair })
    for (const h of helpers) counts.set(h.id, (counts.get(h.id) ?? 0) - sharePerEvent)
    for (const h of pair) {
      counts.set(h.id, (counts.get(h.id) ?? 0) + 1)
      last.set(h.id, evt.event_date)
    }
    prevEventDate = evt.event_date
  }
  return result
}

/* ---------- Blöcke ---------- */

const EVENT_SELECT = 'id, event_date, rotation_message_id, rotation_chat_id, assignments(helper_id, helper:helpers(id, name, telegram_username, telegram_user_id, is_senior, is_ateam))'

function toProposal(e: any): RotationProposal {
  return {
    eventId: e.id,
    eventDate: e.event_date,
    helpers: (e.assignments ?? [])
      .filter((a: any) => a.helper)
      .map((a: any) => ({
        id: a.helper.id,
        name: a.helper.name,
        username: a.helper.telegram_username ?? null,
        telegramUserId: a.helper.telegram_user_id ? Number(a.helper.telegram_user_id) : null,
        isSenior: !!a.helper.is_senior,
        isATeam: !!a.helper.is_ateam,
        count: 0,
        lastAssigned: null,
      }))
      .sort((a: RotationCandidate, b: RotationCandidate) => Number(b.isSenior) - Number(a.isSenior)),
  }
}

function liveChatId(): number | null {
  const id = process.env.TELEGRAM_CHAT_ID
  return id ? Number(id) : null
}

export interface BlockInfo {
  messageId: number
  events: RotationProposal[]
}

/** Der zuletzt in der Helfer-Gruppe gepostete Block (gepinnte Einteilung). */
export async function currentBlock(): Promise<BlockInfo | null> {
  const chat = liveChatId()
  if (!chat) return null
  const db = getSupabase()
  const { data: latest } = await (db as any)
    .from('events')
    .select('rotation_message_id')
    .eq('rotation_chat_id', chat)
    .not('rotation_message_id', 'is', null)
    .order('rotation_message_id', { ascending: false })
    .limit(1)
  const messageId: number | undefined = latest?.[0]?.rotation_message_id
  if (!messageId) return null
  const { data } = await (db as any)
    .from('events')
    .select(EVENT_SELECT)
    .eq('rotation_message_id', messageId)
    .order('event_date', { ascending: true })
  return { messageId, events: ((data ?? []) as any[]).map(toProposal) }
}

/**
 * Die nächsten {BLOCK_SIZE} Termine nach dem aktuellen Block (bzw. ab heute,
 * wenn es keinen gibt), mit ihren gespeicherten Zuweisungen.
 * posted = schon in der Helfer-Gruppe gepostet (sonst Entwurf bzw. leer).
 */
export async function nextBlock(): Promise<{ after: string | null; events: (RotationProposal & { posted: boolean })[] }> {
  const block = await currentBlock()
  const today = localIso(new Date())
  const lastDate = block?.events.length ? block.events[block.events.length - 1].eventDate : null
  const after = lastDate && lastDate >= today ? lastDate : null
  let q = (getSupabase() as any).from('events').select(EVENT_SELECT).order('event_date', { ascending: true }).limit(BLOCK_SIZE)
  q = after ? q.gt('event_date', after) : q.gte('event_date', today)
  const { data } = await q
  const chat = liveChatId()
  return {
    after,
    events: ((data ?? []) as any[]).map(e => ({ ...toProposal(e), posted: !!e.rotation_message_id && Number(e.rotation_chat_id) === chat })),
  }
}

/** Neuen Vorschlag für den nächsten Block berechnen (schreibt nichts). */
export async function planNextBlock(): Promise<PlanResult & { after: string | null }> {
  const next = await nextBlock()
  const plan = await planEvents(next.events.map(e => ({ id: e.eventId, event_date: e.eventDate })))
  return { ...plan, after: next.after }
}

/** Zuweisungen dieser Termine ersetzen. */
async function saveAssignments(proposals: { eventId: string; helperIds: string[] }[]): Promise<number> {
  const db = getSupabase()
  const ids = proposals.map(p => p.eventId)
  if (ids.length === 0) return 0
  await db.from('assignments').delete().in('event_id', ids)
  const rows = proposals.flatMap(p => Array.from(new Set(p.helperIds)).map(h => ({ event_id: p.eventId, helper_id: h })))
  if (rows.length > 0) {
    const { error } = await db.from('assignments').insert(rows as any)
    if (error) throw error
  }
  return rows.length
}

/** Baut aus {eventId, helperIds} vollständige Proposals (für Nachrichten-Vorschau). */
export async function proposalsFromOverride(
  override: { eventId: string; helperIds: string[] }[],
): Promise<RotationProposal[]> {
  const helpers = new Map((await loadHelpers()).map(h => [h.id, h]))
  const ids = override.map(o => o.eventId)
  if (ids.length === 0) return []
  const { data } = await getSupabase().from('events').select('id, event_date').in('id', ids)
  const dates = new Map(((data ?? []) as any[]).map(e => [e.id as string, e.event_date as string]))
  const proposals: RotationProposal[] = []
  for (const o of override) {
    const eventDate = dates.get(o.eventId)
    if (!eventDate) continue
    const picked = Array.from(new Set(o.helperIds)).flatMap(id => helpers.get(id) ?? [])
    proposals.push({
      eventId: o.eventId,
      eventDate,
      helpers: picked
        .map(({ since, ...h }) => ({ ...h, count: 0, lastAssigned: null }))
        .sort((a, b) => Number(b.isSenior) - Number(a.isSenior)),
    })
  }
  return proposals.sort((a, b) => a.eventDate.localeCompare(b.eventDate))
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
    .select('id, event_date, rotation_chat_id, assignments(helper_id, helper:helpers(id, name, telegram_username, telegram_user_id, is_senior))')
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
        telegramUserId: a.helper.telegram_user_id ? Number(a.helper.telegram_user_id) : null,
        isSenior: !!a.helper.is_senior,
        count: 0,
        lastAssigned: null,
      }))
      .sort((a: RotationCandidate, b: RotationCandidate) => Number(b.isSenior) - Number(a.isSenior)),
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
  // @username löst einen Push aus; ohne Username tut das auch der ID-Link.
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const tag = (h: RotationCandidate) => {
    if (h.username) return `@${h.username}`
    if (h.telegramUserId) return `<a href="tg://user?id=${h.telegramUserId}">${esc(h.name)}</a>`
    return `<i>${esc(h.name)}</i>`
  }

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

async function postAndPin(chatId: string, text: string, eventIds: string[], tag: boolean): Promise<{ messageId: number | null; telegram: any }> {
  const db = getSupabase()
  const targetChatId = parseInt(chatId)

  // Alte Pins dieses Chats lösen (nur beim echten Post, Tests lassen alles stehen).
  if (tag) {
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
  }

  const send = await sendTelegramMessage(chatId, text)
  const messageId: number | null = send?.result?.message_id ?? null
  const resolvedChatId: number = send?.result?.chat?.id ?? targetChatId
  if (messageId) {
    if (tag) await tagEventsWithRotationMessage(eventIds, messageId, resolvedChatId)
    await pinTelegramMessage(resolvedChatId, messageId)
  }
  return { messageId, telegram: send }
}

export interface PostResult {
  mode: 'sandbox' | 'live'
  proposals: RotationProposal[]
  messageId: number | null
}

/**
 * Speichert optional {save} (Zuweisungen dieser Termine ersetzen) und postet
 * die Termine {eventIds} als neue Nachricht, gepinnt.
 *   isTest = Sandbox: nichts wird als gepostet markiert, alte Pins bleiben.
 *   Live: Termine bekommen die neue message_id (= aktueller Block), der alte
 *   Pin wird gelöst. Tausche in der App editieren danach diese Nachricht.
 */
export async function postBlock(opts: {
  chatId: string
  isTest: boolean
  eventIds: string[]
  save?: { eventId: string; helperIds: string[] }[]
}): Promise<PostResult> {
  if (opts.save?.length) await saveAssignments(opts.save)
  // Neuer Block: die noch offenen Termine des gepinnten Blocks kommen oben mit
  // rein, sonst verschwänden sie aus dem Pin, bevor sie stattfinden.
  const remaining = opts.save?.length ? (await currentBlockRemaining()).map(p => p.eventId) : []
  const ids = Array.from(new Set([...remaining, ...opts.eventIds, ...(opts.save ?? []).map(s => s.eventId)]))
  const result: PostResult = { mode: opts.isTest ? 'sandbox' : 'live', proposals: [], messageId: null }
  if (ids.length === 0) return result

  const { data } = await (getSupabase() as any).from('events').select(EVENT_SELECT).in('id', ids).order('event_date', { ascending: true })
  result.proposals = ((data ?? []) as any[]).map(toProposal).filter(p => p.helpers.length > 0)
  if (result.proposals.length === 0) return result

  const posted = await postAndPin(opts.chatId, formatRotationMessage(result.proposals), result.proposals.map(p => p.eventId), !opts.isTest)
  if (!posted.messageId) {
    throw new Error(`Telegram hat die Nachricht abgelehnt: ${posted.telegram?.description ?? 'unbekannt'}`)
  }
  result.messageId = posted.messageId
  return result
}

/** Noch nicht vergangene Termine des gepinnten Blocks (heute zählt mit). */
export async function currentBlockRemaining(): Promise<RotationProposal[]> {
  const block = await currentBlock()
  const today = localIso(new Date())
  return (block?.events ?? []).filter(e => e.eventDate >= today)
}

/** Text der neuen Einteilungs-Nachricht: offene Termine des alten Blocks + {proposals}. */
export async function blockMessagePreview(proposals: RotationProposal[]): Promise<string> {
  const remaining = await currentBlockRemaining()
  const ids = new Set(proposals.map(p => p.eventId))
  const all = [...remaining.filter(p => !ids.has(p.eventId)), ...proposals]
    .filter(p => p.helpers.length > 0)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
  return formatRotationMessage(all)
}

/** Entwurf speichern, ohne zu posten. */
export async function saveDraft(proposals: { eventId: string; helperIds: string[] }[]): Promise<number> {
  return saveAssignments(proposals)
}

/* ---------- Hinweis nach Tauschen ---------- */

/**
 * Nach einer Änderung an einer geposteten Einteilung: kurzer Hinweis als
 * Antwort auf die gepinnte Nachricht (das Bearbeiten selbst benachrichtigt
 * niemanden). Höchstens alle 30 Minuten, weil ein Tausch zwei Änderungen sind.
 */
export async function sendRotationUpdateHint(messageId: number, chatId: number): Promise<boolean> {
  const db = getSupabase()
  const key = `rotation_hint_${messageId}`
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle()
  const lastAt = Number((data as any)?.value ?? 0)
  if (Date.now() - lastAt < HINT_COOLDOWN_MS) return false
  await db.from('settings').upsert({ key, value: String(Date.now()) } as any, { onConflict: 'key' })

  const token = process.env.TELEGRAM_BOT_TOKEN
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: '🔄 <b>Einteilung aktualisiert</b>\nBitte kurz oben im Pin prüfen, ob eure Termine noch passen!',
      parse_mode: 'HTML',
      reply_parameters: { message_id: messageId, allow_sending_without_reply: true },
    }),
  }).then(r => r.json()).catch(() => null)
  return !!res?.ok
}

/* ---------- Cron ---------- */

/** DM an Marco: nächster Block steht als Entwurf, mit Button in die App. */
export async function sendDraftDm(draft: RotationProposal[], note: string, recipients: number[] = DRAFT_NOTIFY_IDS) {
  // Namen statt @-Tags: die DM ist nur zum Prüfen, niemand soll markiert wirken.
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const day = (iso: string) => {
    const d = new Date(iso + 'T12:00:00')
    return `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
  }
  const lines = draft.map(p => `▶ ${day(p.eventDate)}  ${p.helpers.map(h => esc(h.name) + (h.isSenior ? ' (S)' : h.isATeam ? ' (A)' : '')).join(' + ')}`)
  const text =
    '📋 <b>Nächster Block steht (Entwurf)</b>\n\n' +
    lines.join('\n') +
    `\n\n${note}`
  for (const uid of recipients) {
    const res = await sendTelegramMessage(String(uid), text, {
      inline_keyboard: [[{ text: 'In der App prüfen', web_app: { url: `${APP_URL}/calendar` } }]],
    }).catch((e: any) => ({ ok: false, description: e.message }))
    if (!res?.ok) console.error('draft DM failed:', res)
  }
}

function draftKey(messageId: number) {
  return `rotation_draft_for_${messageId}`
}

/**
 * Entwurf für den nächsten Block: alle noch nicht geposteten Termine per
 * Quote neu ziehen und speichern (vorher gespeicherte Zuweisungen dieser
 * Termine werden ersetzt).
 */
async function draftNextBlock(): Promise<RotationProposal[]> {
  const next = await nextBlock()
  const open = next.events.filter(e => !e.posted)
  if (open.length === 0) return []
  const plan = await planEvents(open.map(e => ({ id: e.eventId, event_date: e.eventDate })))
  await saveAssignments(plan.proposals.map(p => ({ eventId: p.eventId, helperIds: p.helpers.map(h => h.id) })))
  return plan.proposals
}

export interface BlockCronResult {
  block: number | null
  remaining: number
  drafted?: number
  skipped?: string
}

/**
 * Täglich vom Reminder-Cron (nur live): Ist der vorletzte Termin des
 * gepinnten Blocks vorbei, den nächsten Block als Entwurf ziehen und Marco
 * per DM Bescheid geben, einmal pro Block. Gepostet wird nie automatisch.
 */
export async function processRotationBlocks(): Promise<BlockCronResult> {
  const block = await currentBlock()
  if (!block) return { block: null, remaining: 0, skipped: 'kein geposteter Block' }

  const today = localIso(new Date())
  const remaining = block.events.filter(e => e.eventDate >= today).length
  const result: BlockCronResult = { block: block.messageId, remaining }
  if (remaining > 1) return result

  const db = getSupabase()
  const key = draftKey(block.messageId)
  const { data: flag } = await db.from('settings').select('value').eq('key', key).maybeSingle()
  if (flag) return result

  const draft = await draftNextBlock()
  result.drafted = draft.length
  if (draft.length === 0) {
    // Kalender noch leer: nicht als erledigt merken, morgen wieder versuchen
    // (neue Termine kommen per ICS). Marco einmal pro Block Bescheid geben.
    result.skipped = 'keine weiteren Termine im Kalender'
    const emptyKey = `rotation_nocal_for_${block.messageId}`
    const { data: told } = await db.from('settings').select('value').eq('key', emptyKey).maybeSingle()
    if (!told) {
      await db.from('settings').upsert({ key: emptyKey, value: new Date().toISOString() } as any, { onConflict: 'key' })
      for (const uid of DRAFT_NOTIFY_IDS) {
        await sendTelegramMessage(
          String(uid),
          '📋 <b>Nächster Block</b>\n\nIm Kalender stehen keine weiteren Termine. Sobald die neuen drin sind (ICS in den Einstellungen hochladen oder der Abgleich am Monatsersten), ziehe ich den Entwurf und melde mich.',
        ).catch((e: any) => console.error('no-calendar DM failed:', e))
      }
    }
    return result
  }
  await db.from('settings').upsert({ key, value: new Date().toISOString() } as any, { onConflict: 'key' })
  await sendDraftDm(draft, 'Prüfen und tauschen in der App, posten wann du willst. Die offenen Termine der jetzigen Einteilung kommen automatisch mit in die neue Nachricht.')
  return result
}
