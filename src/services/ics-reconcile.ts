import { getSupabase } from './database'
import { fetchJungscharDatesFromIcs, insertNewFutureDates } from './ical-sync'
import { sendTelegramMessage } from './reminders'
import { rerenderRotationMessage, sendRotationUpdateHint } from './rotation'

/**
 * Wöchentlicher Abgleich mit dem ICS-Feed (Samstagmorgen, Reminder-Cron).
 *
 * Kommende Termine, die nicht mehr im Feed stehen ("stale"):
 *  - nicht gepostet (Entwurf oder leer): still entfernen, der nächste Block
 *    rückt von selbst nach.
 *  - im Pin der Helfer-Gruppe: nur eine DM an Marco, nie etwas in die Gruppe.
 *    Die DM sagt genau, was ein Klick in der Gruppe auslöst:
 *      icsm_<id>  Team auf den neuen Termin übertragen (verschoben)
 *      icsd_<id>  Termin aus Pin und Kalender nehmen (ausgefallen)
 *      icsx_<id>  selbst regeln
 *    Pro Termin nur eine DM (settings.ics_notice_<id>).
 */

const NOTIFY_IDS = [5856427770] // Marco

function localIso(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d)
}

function fmt(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const HINT_TEXT = '„🔄 Einteilung aktualisiert. Bitte kurz oben im Pin prüfen, ob eure Termine noch passen!“'

/** Kommende Termine, die nicht mehr im ICS stehen (null = Feed nicht erreichbar). */
export async function staleEventIds(): Promise<string[] | null> {
  const dates = await fetchJungscharDatesFromIcs()
  if (!dates) return null
  const { data } = await getSupabase().from('events').select('id, event_date').gte('event_date', localIso(new Date()))
  return ((data ?? []) as any[]).filter(e => !dates.has(e.event_date)).map(e => e.id)
}

/** Hängt am Termin mehr als Team und Status? Dann nicht löschen, nur aus dem Pin nehmen. */
async function hasHistory(eventId: string): Promise<boolean> {
  const db = getSupabase()
  for (const t of ['reminder_log', 'invitations', 'parent_duties', 'event_photos', 'ideas', 'attendance_votes', 'review_pings']) {
    const { data } = await db.from(t as any).select('id').eq('event_id', eventId).limit(1)
    if ((data?.length ?? 0) > 0) return true
  }
  return false
}

/** Termin entfernen: löschen, wenn nichts dranhängt, sonst nur Team und Pin-Zuordnung weg. */
async function dropEvent(eventId: string): Promise<void> {
  const db = getSupabase()
  await db.from('assignments').delete().eq('event_id', eventId)
  if (await hasHistory(eventId)) {
    await (db as any).from('events').update({ rotation_message_id: null, rotation_chat_id: null }).eq('id', eventId)
    return
  }
  await db.from('event_status').delete().eq('event_id', eventId)
  await db.from('events').delete().eq('id', eventId)
}

/** Neuer ICS-Termin ohne Team, höchstens 7 Tage vom alten entfernt (Ziel beim Verschieben). */
async function findMoveTarget(oldDate: string, dates: Set<string>): Promise<{ id: string; event_date: string } | null> {
  const { data } = await getSupabase()
    .from('events')
    .select('id, event_date, assignments(id)')
    .gte('event_date', localIso(new Date()))
  const day = (iso: string) => new Date(iso + 'T12:00:00').getTime() / 86400000
  const candidates = ((data ?? []) as any[])
    .filter(e => dates.has(e.event_date) && (e.assignments?.length ?? 0) === 0)
    .filter(e => Math.abs(day(e.event_date) - day(oldDate)) <= 7)
    .sort((a, b) => Math.abs(day(a.event_date) - day(oldDate)) - Math.abs(day(b.event_date) - day(oldDate)))
  return candidates[0] ?? null
}

async function loadEvent(id: string) {
  const { data } = await (getSupabase() as any)
    .from('events')
    .select('id, event_date, rotation_message_id, rotation_chat_id, assignments(helper_id, helper:helpers(name))')
    .eq('id', id)
    .maybeSingle()
  return data as any
}

const teamOf = (e: any) => (e?.assignments ?? []).map((a: any) => a.helper?.name).filter(Boolean).join(' + ')

export interface ReconcileResult {
  skipped?: string
  inserted: number
  removedDrafts: string[]
  notified: string[]
}

export async function reconcileWithIcs(): Promise<ReconcileResult> {
  const result: ReconcileResult = { inserted: 0, removedDrafts: [], notified: [] }
  const dates = await fetchJungscharDatesFromIcs()
  if (!dates) return { ...result, skipped: 'ICS nicht erreichbar' }
  result.inserted = await insertNewFutureDates(dates)

  const db = getSupabase()
  const live = Number(process.env.TELEGRAM_CHAT_ID)
  const { data } = await (db as any)
    .from('events')
    .select('id, event_date, rotation_message_id, rotation_chat_id, assignments(helper_id, helper:helpers(name))')
    .gte('event_date', localIso(new Date()))
    .order('event_date', { ascending: true })
  const stale = ((data ?? []) as any[]).filter(e => !dates.has(e.event_date))

  for (const e of stale) {
    const pinned = !!e.rotation_message_id && Number(e.rotation_chat_id) === live
    if (!pinned) {
      await dropEvent(e.id)
      result.removedDrafts.push(e.event_date)
      continue
    }

    const key = `ics_notice_${e.id}`
    const { data: told } = await db.from('settings').select('value').eq('key', key).maybeSingle()
    if (told) continue

    const target = await findMoveTarget(e.event_date, dates)
    const team = teamOf(e) || 'ohne Team'
    const text = target
      ? `📅 <b>Kalender geändert</b>\n\n${fmt(e.event_date)} steht nicht mehr im Kalender, neu ist ${fmt(target.event_date)}.\nTeam vom ${fmt(e.event_date)}: ${esc(team)}\n\n` +
        `Beim Übertragen wird der Pin bearbeitet und in die Helfer-Gruppe geht:\n${HINT_TEXT}`
      : `📅 <b>Kalender geändert</b>\n\n${fmt(e.event_date)} steht nicht mehr im Kalender (Team: ${esc(team)}).\n\n` +
        `Beim Entfernen wird der Termin aus dem Pin genommen und in die Helfer-Gruppe geht:\n${HINT_TEXT}`
    const buttons = target
      ? [[{ text: `Team auf ${fmt(target.event_date)} übertragen`, callback_data: `icsm_${e.id}` }], [{ text: 'Selbst regeln', callback_data: `icsx_${e.id}` }]]
      : [[{ text: 'Aus Pin und Kalender nehmen', callback_data: `icsd_${e.id}` }], [{ text: 'Selbst regeln', callback_data: `icsx_${e.id}` }]]

    for (const uid of NOTIFY_IDS) await sendTelegramMessage(String(uid), text, { inline_keyboard: buttons })
    await db.from('settings').upsert({ key, value: new Date().toISOString() } as any, { onConflict: 'key' })
    result.notified.push(e.event_date)
  }
  return result
}

/**
 * Klick in der DM. Erst hier passiert etwas in der Gruppe (Pin bearbeiten +
 * Hinweis), so wie es in der DM angekündigt war.
 * @returns neuer Text für die DM
 */
export async function handleIcsAction(action: 'icsm' | 'icsd' | 'icsx', eventId: string): Promise<string> {
  const old = await loadEvent(eventId)
  if (!old) return 'Schon erledigt, der Termin ist nicht mehr da.'
  if (action === 'icsx') return `Alles klar, ${fmt(old.event_date)} regelst du selbst. In der Gruppe ist nichts passiert.`

  const messageId: number | null = old.rotation_message_id ?? null
  const chatId: number | null = old.rotation_chat_id ? Number(old.rotation_chat_id) : null
  const db = getSupabase()
  let done: string

  if (action === 'icsm') {
    const dates = await fetchJungscharDatesFromIcs()
    const target = dates ? await findMoveTarget(old.event_date, dates) : null
    if (!target) return `Kein freier neuer Termin in der Nähe von ${fmt(old.event_date)} gefunden. Bitte in der App regeln.`
    const rows = (old.assignments ?? []).map((a: any) => ({ event_id: target.id, helper_id: a.helper_id }))
    if (rows.length) {
      const { error } = await db.from('assignments').insert(rows as any)
      if (error) return `Fehler beim Übertragen: ${error.message}`
    }
    if (messageId) await (db as any).from('events').update({ rotation_message_id: messageId, rotation_chat_id: chatId }).eq('id', target.id)
    await dropEvent(old.id)
    done = `Erledigt: ${esc(teamOf(old) || 'Team')} jetzt am ${fmt(target.event_date)}, ${fmt(old.event_date)} entfernt.`
  } else {
    await dropEvent(old.id)
    done = `Erledigt: ${fmt(old.event_date)} aus Pin und Kalender genommen.`
  }

  if (messageId && chatId) {
    const r = await rerenderRotationMessage(messageId)
    const hint = r.ok ? await sendRotationUpdateHint(messageId, chatId) : false
    done += r.ok ? ` Pin aktualisiert${hint ? ', Hinweis gesendet' : ''}.` : ` Pin konnte nicht aktualisiert werden (${r.reason}).`
  }
  return done
}
