import { getSupabase, getTodayISO } from './database'
import { sendTelegramMessage } from './reminders'
import { berlinNow } from './review-ping'
import { APP_URL } from './admins'
import { hasFoodDuty } from '@/utils/format'

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

/**
 * Admins dürfen /einladen auch ohne Eltern-Eintrag nutzen (zum Testen und
 * weil sie selbst Gastgeber sein können). Dafür wird ein inaktiver
 * Eltern-Datensatz angelegt, der in der Eltern-Seite nicht auftaucht.
 */
export async function ensureParentForAdmin(userId: number, name: string, username?: string | null): Promise<BotParent> {
  const db = getSupabase()
  const { data: existing } = await db
    .from('parents')
    .select('id, name, telegram_username, telegram_user_id')
    .eq('telegram_user_id', userId)
    .maybeSingle()
  if (existing) return existing as BotParent

  const { data, error } = await db
    .from('parents')
    .insert({ name, telegram_username: username ?? null, telegram_user_id: userId, active: false } as any)
    .select('id, name, telegram_username, telegram_user_id')
    .single()
  if (error) throw error
  return data as BotParent
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
  'Schreib es einfach als Antwort auf diese Nachricht. Ein Stichwort reicht, gern auch ein Link oder ein Bild mit kurzer Beschreibung.'

/** Antwort, wenn ein Bild ohne Beschreibung kommt. */
export const IDEA_PHOTO_NEEDS_TEXT =
  'Schönes Bild! Schreib bitte kurz in die Bildunterschrift, was die Idee ist, und schick es noch einmal.'

export async function saveParentIdea(
  text: string,
  by: { name: string; telegramUserId: number },
  photoFileId?: string,
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
    photo_file_id: photoFileId ?? null,
  } as any)
  if (error) throw error
}

/* ---------- /einladen (nur Buttons) ---------- */

export function shortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]
  return `${wd} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
}

export interface InviteTarget {
  id: string
  event_date: string
  /** Wer schon eingeladen hat, sonst null. */
  takenBy: { parentId: string; name: string } | null
}

/**
 * Der eine Termin, zu dem Eltern gerade einladen können: die nächste
 * Samstags-Jungschar (freitags bekommen wir immer Essen). Keine Auswahl
 * weiterer Termine. Eine Einladung pro Termin, wer zuerst kommt.
 */
export async function nextInviteEvent(): Promise<InviteTarget | null> {
  const { data } = await getSupabase()
    .from('events')
    .select('id, event_date, invitations(parent_id, parent:parents(name))')
    .gte('event_date', getTodayISO())
    .order('event_date', { ascending: true })
    .limit(12)
  const next = ((data ?? []) as any[]).find(e => hasFoodDuty(e.event_date))
  if (!next) return null
  const inv = Array.isArray(next.invitations) ? next.invitations[0] : next.invitations
  return {
    id: next.id,
    event_date: next.event_date,
    takenBy: inv?.parent_id ? { parentId: inv.parent_id, name: inv.parent?.name ?? '' } : null,
  }
}

export function cancelInviteKeyboard(eventId: string) {
  return { inline_keyboard: [[{ text: 'Einladung zurückziehen', callback_data: `invx_${eventId}` }]] }
}

/** Zieht die Einladung dieses Elternteils für den Termin zurück; der Termin wird wieder frei. */
export async function cancelInvitation(
  eventId: string,
  parentId: string,
): Promise<{ ok: boolean; eventDate: string | null }> {
  const { data } = await getSupabase()
    .from('invitations')
    .delete()
    .eq('event_id', eventId)
    .eq('parent_id', parentId)
    .select('event:events(event_date)')
  const row = ((data ?? []) as any[])[0]
  return { ok: !!row, eventDate: row?.event?.event_date ?? null }
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
    .select('id, event_date, invitations(parent:parents(name)), assignments(helper:helpers(name, telegram_username))')
    .eq('id', eventId)
    .maybeSingle()
  if (!event) return { ok: false, text: 'Diesen Termin gibt es nicht mehr.' }
  const eventDate = (event as any).event_date as string
  const taken = ((event as any).invitations ?? [])[0]?.parent?.name
  if (taken) return { ok: false, text: `Zu spät, für ${shortDate(eventDate)} war jemand anderes schneller! Gerne bei der nächsten Gelegenheit.`, eventDate }

  const { error } = await db.from('invitations').insert({ event_id: eventId, parent_id: parent.id } as any)
  if (error) return { ok: false, text: 'Eintragen hat nicht geklappt, bitte später noch einmal.', eventDate }
  // Ansprechpartner = eingeteiltes Team des Termins, nur als @username,
  // damit die Eltern direkt antippen können; ohne Username bleibt der Name.
  const team = (((event as any).assignments ?? []) as any[])
    .map(a => a.helper)
    .filter(Boolean)
    .map(h => (h.telegram_username ? `@${h.telegram_username}` : h.name))
  const contact = team.length > 0
    ? `Für detaillierte Infos sind eure Ansprechpartner: ${team.join(' und ')}.`
    : 'Eure Ansprechpartner für Details melden sich, sobald die Einteilung steht.'
  return {
    ok: true,
    text:
      `Cool, dass wir eingeladen werden! 🎉 Notiert, wir haben den ${shortDate(eventDate)} auf dem Schirm.\n` +
      `${contact}\n\n` +
      'Keine Idee, was es zum Essen geben soll? /inspo zeigt dir, was wir sonst so von den Eltern bekommen 😉',
    eventDate,
  }
}

/* ---------- /inspo (Spaß) ---------- */

/** Bilder liegen in public/inspo (Live-URL). */
const INSPO_IMAGES = ['essen-1.jpg', 'essen-2.jpg', 'essen-3.jpg'].map(f => `${APP_URL}/inspo/${f}`)
/** Text unter dem Album: was auf den Bildern zu sehen ist, dann die Auflösung. */
const INSPO_TEXT =
  'Ein paar einfache Essensideen, die wir für gewöhnlich von den Eltern bekommen:\n' +
  '▶ Feinster Hummer mit Zitrone, von Familie Krabbenburger\n' +
  '▶ Sushi-Platte mit Lachs-Nigiri, von Familie Nakamura\n' +
  '▶ Gebratene Jakobsmuschel auf Rucola und Granatapfel, von Familie Sternekoch\n\n' +
  'Spaß! 😄 Es reicht etwas völlig Einfaches. Danke schonmal!'
const INSPO_FILE_IDS_KEY = 'inspo_file_ids'

/**
 * Album senden. Beim ersten Mal lädt der Server die Bilder selbst hoch
 * (Telegram holt URLs von Vercel nicht zuverlässig: WEBPAGE_CURL_FAILED)
 * und merkt sich die file_ids in settings; danach geht es direkt per file_id.
 */
async function sendInspoAlbum(chatId: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const cached = await getSetting(INSPO_FILE_IDS_KEY)
  if (cached) {
    const ids: string[] = JSON.parse(cached)
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        media: ids.map(id => ({ type: 'photo', media: id })),
      }),
    }).then(r => r.json())
    if (res?.ok) return true
    console.error('inspo album (file_ids) failed, lade neu hoch:', res)
  }

  const form = new FormData()
  form.append('chat_id', chatId)
  form.append(
    'media',
    JSON.stringify(INSPO_IMAGES.map((_, i) => ({ type: 'photo', media: `attach://f${i}` }))),
  )
  for (let i = 0; i < INSPO_IMAGES.length; i++) {
    const blob = await fetch(INSPO_IMAGES[i]).then(r => r.blob())
    form.append(`f${i}`, blob, `essen-${i + 1}.jpg`)
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, { method: 'POST', body: form }).then(r => r.json())
  if (!res?.ok) {
    console.error('inspo album upload failed:', res)
    return false
  }
  const ids = (res.result as any[]).map(m => m.photo?.[m.photo.length - 1]?.file_id).filter(Boolean)
  if (ids.length === INSPO_IMAGES.length) await setSetting(INSPO_FILE_IDS_KEY, JSON.stringify(ids)).catch(() => {})
  return true
}

/**
 * /inspo: Album mit „typischen“ Essensideen (Hummer, Sushi, Sterneküche)
 * ohne Caption, darunter als Text, was zu sehen ist, und die Auflösung,
 * dass etwas völlig Einfaches reicht.
 */
export async function sendFoodInspo(chatId: string): Promise<boolean> {
  const ok = await sendInspoAlbum(chatId)
  await sendTelegramMessage(chatId, ok ? INSPO_TEXT : 'Die Bilder wollten gerade nicht. Kurz gesagt: Es reicht etwas völlig Einfaches. Danke schonmal! 😄')
  return ok
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
