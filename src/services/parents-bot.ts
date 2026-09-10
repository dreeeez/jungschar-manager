import { getSupabase } from './database'
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

export const IDEA_PROMPT = 'Was schlägst du vor? Schreib deine Idee einfach als Antwort auf diese Nachricht.'

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

/* ---------- /einladen ---------- */

export const INVITE_PROMPT =
  'Schön, dass ihr die Jungschar zu euch einladen wollt! Wann passt es euch, und gibt es etwas zu beachten? ' +
  'Schreib es einfach als Antwort auf diese Nachricht, z.B. „gerne im Oktober, wir grillen“.'

/**
 * Einladung „kommt zu uns“: landet als Idee im Pool (Kategorie Essen),
 * damit das Team sie beim Planen sieht.
 */
export async function saveInvitation(
  text: string,
  by: { name: string; telegramUserId: number },
): Promise<void> {
  const clean = text.trim()
  const { error } = await getSupabase().from('ideas').insert({
    event_id: null,
    title: `Einladung bei ${by.name}`.slice(0, 200),
    description: clean,
    was_used: false,
    source: 'elterngruppe',
    tags: ['essen'],
    suggested_by: by.name,
    suggested_by_telegram_id: by.telegramUserId,
  } as any)
  if (error) throw error
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
