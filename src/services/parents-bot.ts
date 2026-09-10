import { getSupabase, getTodayISO } from './database'
import { sendTelegramMessage } from './reminders'
import { berlinNow } from './review-ping'

/**
 * Eltern im Bot: Erkennung, Registrierungs-Code, /idee, /einladen und der
 * Geburtstagsgruß in der Elterngruppe.
 *
 * Eltern werden über die in der Mini-App gepflegte Telegram-ID oder den
 * Benutzernamen erkannt. Beide Befehle laufen im privaten Chat mit dem Bot.
 */

export interface BotParent {
  id: string
  name: string
  telegram_username: string | null
  telegram_user_id: number | null
}

export async function findParentByTelegram(userId: number, username?: string | null): Promise<BotParent | null> {
  const { data } = await getSupabase()
    .from('parents')
    .select('id, name, telegram_username, telegram_user_id')
    .eq('active', true)
  const rows = (data ?? []) as BotParent[]
  const byId = rows.find(p => p.telegram_user_id != null && Number(p.telegram_user_id) === userId)
  if (byId) return byId
  if (username) {
    const u = username.toLowerCase()
    return rows.find(p => p.telegram_username?.toLowerCase() === u) ?? null
  }
  return null
}

/* ---------- Settings ---------- */

export async function getSetting(key: string): Promise<string | null> {
  const { data } = await getSupabase().from('settings').select('value').eq('key', key).maybeSingle()
  return ((data as any)?.value as string | undefined) ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  const { error } = await getSupabase().from('settings').upsert({ key, value } as any, { onConflict: 'key' })
  if (error) throw error
}

/* ---------- Registrierungs-Code ---------- */

export const REGISTER_CODE_KEY = 'register_code'

/** 'ok' = Code passt, 'closed' = kein Code hinterlegt, 'wrong' = falsch/leer. */
export async function checkRegisterCode(input: string | undefined): Promise<'ok' | 'closed' | 'wrong'> {
  const expected = (await getSetting(REGISTER_CODE_KEY))?.trim()
  if (!expected) return 'closed'
  const given = (input ?? '').trim()
  if (!given) return 'wrong'
  return given.localeCompare(expected, undefined, { sensitivity: 'accent' }) === 0 ? 'ok' : 'wrong'
}

/* ---------- /idee ---------- */

export const IDEA_PROMPT =
  'Worauf hätte dein Kind richtig Lust? Ein Ausflug, ein Spiel, etwas Selbstgebautes, ein Ort, den ihr kennt?\n\n' +
  'Schreib es einfach als Antwort auf diese Nachricht. Es muss nicht ausgereift sein, ein Stichwort reicht uns.'

export async function saveParentIdea(
  text: string,
  by: { name: string; telegramUserId: number },
): Promise<void> {
  const clean = text.trim()
  const { error } = await getSupabase().from('ideas').insert({
    event_id: null,
    title: clean.slice(0, 200),
    description: clean,
    was_used: false,
    source: 'elterngruppe',
    suggested_by: by.name,
    suggested_by_telegram_id: by.telegramUserId,
  } as any)
  if (error) throw error
}

/* ---------- /einladen (nur Buttons) ---------- */

export function shortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]
  return `${wd} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
}

/** Kommende Termine, an denen noch niemand eingeladen hat. */
export async function openInviteEvents(limit = 8): Promise<{ id: string; event_date: string }[]> {
  const { data } = await getSupabase()
    .from('events')
    .select('id, event_date, invitations(id)')
    .gte('event_date', getTodayISO())
    .order('event_date', { ascending: true })
    .limit(30)
  return ((data ?? []) as any[])
    .filter(e => (e.invitations?.length ?? 0) === 0)
    .slice(0, limit)
    .map(e => ({ id: e.id, event_date: e.event_date }))
}

export function inviteDateKeyboard(events: { id: string; event_date: string }[]) {
  const buttons = events.map(e => ({ text: shortDate(e.event_date), callback_data: `inv_${e.id}` }))
  const rows: typeof buttons[] = []
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2))
  return { inline_keyboard: rows }
}

export function inviteConfirmKeyboard(eventId: string) {
  return {
    inline_keyboard: [[
      { text: 'Ja, einladen', callback_data: `invy_${eventId}` },
      { text: 'Nein', callback_data: `invn_${eventId}` },
    ]],
  }
}

export async function getEventDate(eventId: string): Promise<string | null> {
  const { data } = await getSupabase().from('events').select('event_date').eq('id', eventId).maybeSingle()
  return ((data as any)?.event_date as string | undefined) ?? null
}

/**
 * Trägt die Einladung ein, wenn der Termin noch frei ist.
 * @returns Text für die Rückmeldung an das Elternteil.
 */
export async function saveInvitation(
  eventId: string,
  parent: BotParent,
): Promise<{ ok: boolean; text: string; eventDate?: string }> {
  const db = getSupabase()
  const { data: event } = await db
    .from('events')
    .select('id, event_date, invitations(parent:parents(name))')
    .eq('id', eventId)
    .maybeSingle()
  if (!event) return { ok: false, text: 'Diesen Termin gibt es nicht mehr.' }
  const eventDate = (event as any).event_date as string
  const taken = ((event as any).invitations ?? [])[0]?.parent?.name
  if (taken) return { ok: false, text: `Am ${shortDate(eventDate)} hat schon ${taken} eingeladen.`, eventDate }

  const { error } = await db.from('invitations').insert({ event_id: eventId, parent_id: parent.id } as any)
  if (error) return { ok: false, text: 'Eintragen hat nicht geklappt, bitte später noch einmal.', eventDate }
  return { ok: true, text: `Danke! Die Jungschar kommt am ${shortDate(eventDate)} zu euch. Wir melden uns wegen der Details.`, eventDate }
}

/* ---------- Geburtstagsgruß ---------- */

const BIRTHDAY_KEY = 'last_birthday_greeting'

/**
 * Gratuliert Kindern, die heute Geburtstag haben, in der Elterngruppe.
 * Läuft am täglichen Cron; pro Tag höchstens einmal (settings-Merker).
 */
export async function postBirthdayGreetings(chatId: string, force = false): Promise<{ posted: string[]; skipped?: string }> {
  const { date } = berlinNow()
  if (!force && (await getSetting(BIRTHDAY_KEY)) === date) return { posted: [], skipped: 'heute schon gelaufen' }

  const { data } = await getSupabase().from('children').select('name, birthday').eq('active', true)
  const mmdd = date.slice(5)
  const todays = ((data ?? []) as { name: string; birthday: string | null }[])
    .filter(c => c.birthday && c.birthday.slice(5) === mmdd)
    .map(c => ({ name: c.name, age: Number(date.slice(0, 4)) - Number(c.birthday!.slice(0, 4)) }))

  if (todays.length === 0) return { posted: [], skipped: 'kein Geburtstag heute' }

  const lines = todays.map(c => `🎂 <b>${c.name}</b> wird heute ${c.age}!`)
  const text = `${lines.join('\n')}\n\nAlles Gute und Gottes Segen zum Geburtstag! 🎉`
  const res = await sendTelegramMessage(chatId, text)
  if (res?.ok) await setSetting(BIRTHDAY_KEY, date)
  return { posted: todays.map(c => c.name) }
}
