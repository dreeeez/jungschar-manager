import { getSupabase } from './database'
import { sendTelegramMessage } from './reminders'
import { berlinNow } from './review-ping'
import { ADMIN_TELEGRAM_USER_IDS } from './admins'

/**
 * Fotos zur Jungschar.
 *
 * Nur Helfer (inkl. Admins) schicken Bilder privat an den Bot; Eltern sind
 * hier bewusst raus und werden vom Bot nie aktiv angeschrieben. Der Bot speichert nur die
 * Telegram-file_id und ordnet sie dem Termin des Tages zu (bis drei Tage
 * danach). Admins sehen mit /bilder den Stand und posten mit /senden alle
 * noch nicht geposteten Bilder als Album in die Elterngruppe, mit einer
 * kurzen Caption, die auf /idee und /einladen hinweist.
 */

const PHOTO_WINDOW_DAYS = 3
const ALBUM_MAX = 10

/**
 * VORLÄUFIG (Stand 2026-09-10): /senden postet in die Sandbox-Gruppe statt in
 * die Elterngruppe, weil der Bot dort noch nicht drin ist. Sobald der Bot in
 * der Elterngruppe ist: auf false setzen. Siehe CLAUDE.md „Offene Punkte“.
 */
export const PHOTOS_GO_TO_SANDBOX = true

/** Ziel-Chat für /senden: Sandbox solange PHOTOS_GO_TO_SANDBOX, sonst Elterngruppe. */
export function photoTargetChat(): { chatId: string | undefined; label: string; sandbox: boolean } {
  if (PHOTOS_GO_TO_SANDBOX) {
    return { chatId: process.env.TELEGRAM_TEST_CHAT_ID, label: 'die Sandbox-Gruppe (vorläufig statt Elternchat)', sandbox: true }
  }
  return { chatId: process.env.TELEGRAM_ELTERN_CHAT_ID, label: 'den Elternchat', sandbox: false }
}

export interface PhotoEvent {
  id: string
  event_date: string
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function shortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]
  return `${wd} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
}

/** Termin, dem ein jetzt gesendetes Foto zugeordnet wird: heute oder bis 3 Tage zurück. */
export async function eventForNewPhoto(): Promise<PhotoEvent | null> {
  const { date } = berlinNow()
  const { data } = await getSupabase()
    .from('events')
    .select('id, event_date')
    .lte('event_date', date)
    .gte('event_date', addDays(date, -PHOTO_WINDOW_DAYS))
    .order('event_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as PhotoEvent) ?? null
}

/** Termin für /bilder und /senden: jüngster Termin mit ungeposteten Fotos, sonst letzter Termin. */
export async function eventForPosting(): Promise<PhotoEvent | null> {
  const db = getSupabase()
  const { data: pending } = await db
    .from('event_photos')
    .select('event:events(id, event_date)')
    .is('posted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const ev = (pending as any)?.event
  if (ev?.id) return { id: ev.id, event_date: ev.event_date }

  const { date } = berlinNow()
  const { data } = await db
    .from('events')
    .select('id, event_date')
    .lte('event_date', date)
    .order('event_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as PhotoEvent) ?? null
}

export async function savePhoto(
  event: PhotoEvent,
  photo: { fileId: string; uniqueId: string },
  by: { telegramUserId: number; name: string },
): Promise<'saved' | 'duplicate'> {
  const { error } = await getSupabase().from('event_photos').insert({
    event_id: event.id,
    file_id: photo.fileId,
    file_unique_id: photo.uniqueId,
    sent_by_telegram_id: by.telegramUserId,
    sent_by_name: by.name,
  } as any)
  if (error) {
    if (String(error.code) === '23505') return 'duplicate'
    throw error
  }
  return 'saved'
}

export async function photoCounts(eventId: string): Promise<{ total: number; pending: number }> {
  const { data } = await getSupabase().from('event_photos').select('posted_at').eq('event_id', eventId)
  const rows = (data ?? []) as { posted_at: string | null }[]
  return { total: rows.length, pending: rows.filter(r => !r.posted_at).length }
}

async function sendMediaGroup(chatId: string, fileIds: string[], caption?: string): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const media = fileIds.map((id, i) => ({
    type: 'photo',
    media: id,
    ...(i === 0 && caption ? { caption, parse_mode: 'HTML' } : {}),
  }))
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMediaGroup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, media }),
  })
  return res.json()
}

/**
 * Caption für die Elterngruppe: kurz, nett, mit den beiden Befehlen als
 * Direktlinks in den privaten Chat (t.me/<bot>?start=…), damit niemand in
 * der Gruppe tippen muss.
 */
export async function photoCaption(eventDate: string): Promise<string> {
  const { date } = berlinNow()
  const when = eventDate === date
    ? 'heute'
    : `am ${new Date(eventDate + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long' })}`
  const username = await botUsername()
  const link = (payload: string, label: string) =>
    username ? `<a href="https://t.me/${username}?start=${payload}">${label}</a>` : label
  return (
    `Coole Jungschar wieder ${when}! Hier ein paar Einblicke. 📸\n\n` +
    `💡 Ideen für nächstes Mal? ${link('idee', '/idee')}\n` +
    `🏠 Ihr wollt uns zu euch einladen? ${link('einladen', '/einladen')}`
  )
}

let cachedBotUsername: string | null = null
async function botUsername(): Promise<string | null> {
  if (cachedBotUsername) return cachedBotUsername
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    const json = await res.json()
    cachedBotUsername = json?.result?.username ?? null
  } catch {
    cachedBotUsername = null
  }
  return cachedBotUsername
}

/** /bilder: Vorschau der ungeposteten Fotos an den Admin, ohne Markierung. */
export async function previewPhotos(chatId: string, event: PhotoEvent): Promise<number> {
  const { data } = await getSupabase()
    .from('event_photos')
    .select('file_id')
    .eq('event_id', event.id)
    .is('posted_at', null)
    .order('created_at', { ascending: true })
    .limit(ALBUM_MAX)
  const ids = ((data ?? []) as { file_id: string }[]).map(r => r.file_id)
  if (ids.length === 0) return 0
  await sendMediaGroup(chatId, ids)
  return ids.length
}

/**
 * /senden: alle ungeposteten Fotos als Album(s) posten. Mit mark=true
 * (Elterngruppe) werden sie als gepostet markiert; mark=false (Sandbox-Test)
 * lässt sie offen, damit der echte Post später noch geht.
 */
export async function postPhotos(chatId: string, event: PhotoEvent, mark = true): Promise<{ posted: number; albums: number }> {
  const db = getSupabase()
  const { data } = await db
    .from('event_photos')
    .select('id, file_id')
    .eq('event_id', event.id)
    .is('posted_at', null)
    .order('created_at', { ascending: true })
  const rows = (data ?? []) as { id: string; file_id: string }[]
  if (rows.length === 0) return { posted: 0, albums: 0 }

  let albums = 0
  const postedIds: string[] = []
  const caption = await photoCaption(event.event_date)
  for (let i = 0; i < rows.length; i += ALBUM_MAX) {
    const batch = rows.slice(i, i + ALBUM_MAX)
    const res = batch.length === 1
      ? await sendSinglePhoto(chatId, batch[0].file_id, i === 0 ? caption : undefined)
      : await sendMediaGroup(chatId, batch.map(r => r.file_id), i === 0 ? caption : undefined)
    if (!res?.ok) throw new Error(res?.description ?? 'Senden fehlgeschlagen')
    albums++
    postedIds.push(...batch.map(r => r.id))
  }

  if (mark) {
    await db.from('event_photos').update({ posted_at: new Date().toISOString() } as any).in('id', postedIds)
  }
  return { posted: postedIds.length, albums }
}

async function sendSinglePhoto(chatId: string, fileId: string, caption?: string): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: fileId, ...(caption ? { caption, parse_mode: 'HTML' } : {}) }),
  })
  return res.json()
}

/**
 * Abend-Erinnerung an die eingeteilten Helfer des Tages: Fotos schicken.
 * Einmal pro Termin (reminder_log, Typ photo_nudge).
 */
export async function sendPhotoNudges(eventId: string): Promise<number[]> {
  const db = getSupabase()
  const { data: already } = await db
    .from('reminder_log')
    .select('id')
    .eq('event_id', eventId)
    .eq('reminder_type', 'photo_nudge')
    .limit(1)
  if ((already?.length ?? 0) > 0) return []

  const { data: assigns } = await db
    .from('assignments')
    .select('helper:helpers(name, telegram_user_id)')
    .eq('event_id', eventId)
  const sent: number[] = []
  for (const a of (assigns ?? []) as any[]) {
    const uid = a.helper?.telegram_user_id ? Number(a.helper.telegram_user_id) : null
    if (!uid || ADMIN_TELEGRAM_USER_IDS.has(uid)) continue
    const res = await sendTelegramMessage(
      String(uid),
      `Hallo ${a.helper.name}, wie war die Jungschar heute? Wenn du Fotos gemacht hast, schick sie mir einfach hier rein. Ich sammle sie für die Eltern.`,
    )
    if (res?.ok) sent.push(uid)
  }
  await db.from('reminder_log').upsert(
    { event_id: eventId, reminder_type: 'photo_nudge', sent_at: new Date().toISOString() } as any,
    { onConflict: 'event_id,reminder_type' },
  )
  return sent
}
