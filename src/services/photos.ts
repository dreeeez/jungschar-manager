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

/** Caption für die Elterngruppe: kurz, nett, mit den beiden Befehlen. */
export function photoCaption(eventDate: string): string {
  const { date } = berlinNow()
  const when = eventDate === date
    ? 'heute'
    : `am ${new Date(eventDate + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long' })}`
  return (
    `Coole Jungschar wieder ${when}! Hier ein paar Einblicke. 📸\n\n` +
    `💡 Ideen für nächstes Mal? Schick sie mir mit /idee\n` +
    `🏠 Ihr wollt uns zu euch einladen? Einfach /einladen`
  )
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

/** /senden: alle ungeposteten Fotos als Album(s) in die Elterngruppe, dann markieren. */
export async function postPhotos(chatId: string, event: PhotoEvent): Promise<{ posted: number; albums: number }> {
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
  for (let i = 0; i < rows.length; i += ALBUM_MAX) {
    const batch = rows.slice(i, i + ALBUM_MAX)
    const res = batch.length === 1
      ? await sendSinglePhoto(chatId, batch[0].file_id, i === 0 ? photoCaption(event.event_date) : undefined)
      : await sendMediaGroup(chatId, batch.map(r => r.file_id), i === 0 ? photoCaption(event.event_date) : undefined)
    if (!res?.ok) throw new Error(res?.description ?? 'Senden fehlgeschlagen')
    albums++
    postedIds.push(...batch.map(r => r.id))
  }

  await db.from('event_photos').update({ posted_at: new Date().toISOString() } as any).in('id', postedIds)
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

/** Admins kurz informieren, dass Bilder da sind. */
export async function notifyAdminsAboutPhotos(event: PhotoEvent, senderName: string, exceptUserId?: number): Promise<void> {
  const counts = await photoCounts(event.id)
  const text =
    `📸 <b>${senderName}</b> hat Bilder für ${shortDate(event.event_date)} geschickt. ` +
    `Jetzt ${counts.pending} ungepostet. /bilder zeigt sie, /senden postet sie in den Elternchat.`
  for (const id of ADMIN_TELEGRAM_USER_IDS) {
    if (id === exceptUserId) continue
    sendTelegramMessage(String(id), text).catch((e) => console.error('photo notice failed:', e))
  }
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
