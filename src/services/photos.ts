import { getSupabase } from './database'
import { sendTelegramMessage } from './reminders'
import { berlinNow, REVIEW_HOUR_LOCAL } from './review-ping'
import { fetchJungscharDatesFromIcs } from './ical-sync'
import { hasFoodDuty } from '@/utils/format'
import { botUsername } from './bot-info'

/**
 * Fotos und Videos zur Jungschar.
 *
 * Abends nach der Jungschar bedankt sich der Bot in der Helfer-Gruppe und
 * hängt einen Button an, der in den privaten Chat mit dem Bot führt. Dort
 * schicken Helfer (inkl. Admins) ihre Fotos und Videos rein; Eltern sind
 * hier bewusst raus und werden vom Bot nie aktiv angeschrieben. Der Bot
 * speichert nur die Telegram-file_id und ordnet sie dem Termin des Tages zu
 * (bis drei Tage danach).
 *
 * Admins prüfen mit /review (einzelne Medien rauswerfen) und posten mit
 * /send alles Übrige als Album in die Elterngruppe. Die Bildunterschrift
 * trägt den kurzen Text und die Hinweise auf /idee und /invite.
 */

const PHOTO_WINDOW_DAYS = 3
const ALBUM_MAX = 10
/** reminder_log-Typ der Danke-Nachricht in der Helfer-Gruppe. */
const THANKS_LOG_TYPE = 'thanks_photos'

/**
 * VORLÄUFIG (Stand 2026-09-10): /send postet in die Sandbox-Gruppe statt in
 * die Elterngruppe, weil der Bot dort noch nicht drin ist. Sobald der Bot in
 * der Elterngruppe ist: auf false setzen. Siehe CLAUDE.md „Offene Punkte“.
 */
export const PHOTOS_GO_TO_SANDBOX = true

/** Ziel-Chat für /send: Sandbox solange PHOTOS_GO_TO_SANDBOX, sonst Elterngruppe. */
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

export type MediaType = 'photo' | 'video'

interface MediaRow {
  id: string
  file_id: string
  media_type: MediaType
  sent_by_name: string | null
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

/** "3 Fotos und 1 Video", "1 Foto", "2 Videos". */
export function mediaLabel(counts: { photos: number; videos: number }): string {
  const parts: string[] = []
  if (counts.photos > 0) parts.push(`${counts.photos} ${counts.photos === 1 ? 'Foto' : 'Fotos'}`)
  if (counts.videos > 0) parts.push(`${counts.videos} ${counts.videos === 1 ? 'Video' : 'Videos'}`)
  return parts.join(' und ') || '0 Fotos'
}

async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
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

/** Termin für /review und /send: jüngster Termin mit ungeposteten Medien, sonst letzter Termin. */
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

export async function saveMedia(
  event: PhotoEvent,
  media: { fileId: string; uniqueId: string; type: MediaType; mediaGroupId?: string },
  by: { telegramUserId: number; name: string },
): Promise<{ result: 'saved' | 'duplicate'; id: string | null }> {
  const { data, error } = await getSupabase().from('event_photos').insert({
    event_id: event.id,
    file_id: media.fileId,
    file_unique_id: media.uniqueId,
    media_type: media.type,
    media_group_id: media.mediaGroupId ?? null,
    sent_by_telegram_id: by.telegramUserId,
    sent_by_name: by.name,
  } as any).select('id').single()
  if (error) {
    if (String(error.code) === '23505') return { result: 'duplicate', id: null }
    throw error
  }
  return { result: 'saved', id: (data as any)?.id ?? null }
}

export async function mediaCounts(
  eventId: string,
): Promise<{ total: number; pending: number; photos: number; videos: number }> {
  const { data } = await getSupabase().from('event_photos').select('posted_at, media_type').eq('event_id', eventId)
  const rows = (data ?? []) as { posted_at: string | null; media_type: MediaType }[]
  const open = rows.filter(r => !r.posted_at)
  const videos = open.filter(r => r.media_type === 'video').length
  return { total: rows.length, pending: open.length, photos: open.length - videos, videos }
}

async function pendingMedia(eventId: string, onlyFrom?: number): Promise<MediaRow[]> {
  let q = getSupabase()
    .from('event_photos')
    .select('id, file_id, media_type, sent_by_name')
    .eq('event_id', eventId)
    .is('posted_at', null)
  if (onlyFrom !== undefined) q = q.eq('sent_by_telegram_id', onlyFrom)
  const { data } = await q.order('created_at', { ascending: true })
  return (data ?? []) as MediaRow[]
}

function sendOne(chatId: string, m: MediaRow, extra: Record<string, unknown> = {}): Promise<any> {
  return m.media_type === 'video'
    ? tg('sendVideo', { chat_id: chatId, video: m.file_id, ...extra })
    : tg('sendPhoto', { chat_id: chatId, photo: m.file_id, ...extra })
}

function sendAlbum(chatId: string, rows: MediaRow[], caption?: string): Promise<any> {
  const media = rows.map((r, i) => ({
    type: r.media_type === 'video' ? 'video' : 'photo',
    media: r.file_id,
    ...(i === 0 && caption ? { caption, parse_mode: 'HTML' } : {}),
  }))
  return tg('sendMediaGroup', { chat_id: chatId, media })
}

/* ---------- /review ---------- */

/**
 * /review (Admin: alles) bzw. /bilder (Helfer: nur eigene, {onlyFrom}):
 * jedes noch nicht gepostete Medium einzeln, mit Button zum Rauswerfen
 * (phx_<id>). Markiert nichts.
 */
export async function sendReviewItems(chatId: string, event: PhotoEvent, onlyFrom?: number): Promise<number> {
  const rows = await pendingMedia(event.id, onlyFrom)
  // In kleinen Paketen, damit der Webhook auch bei vielen Bildern rechtzeitig fertig ist.
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(
      rows.slice(i, i + 5).map(r =>
        sendOne(chatId, r, {
          ...(r.sent_by_name ? { caption: `von ${esc(r.sent_by_name)}`, parse_mode: 'HTML' } : {}),
          reply_markup: { inline_keyboard: [[{ text: '🗑 Rauswerfen', callback_data: `phx_${r.id}` }]] },
        }),
      ),
    )
  }
  return rows.length
}

/**
 * Wirft ein noch nicht gepostetes Medium raus. Mit {onlyFrom} nur, wenn es
 * von dieser Person stammt (Helfer); Admins lassen das weg.
 * @returns verbleibende offene Medien des Termins
 */
export async function removeMedia(id: string, onlyFrom?: number): Promise<{ removed: boolean; remaining: number }> {
  const db = getSupabase()
  let q = db.from('event_photos').delete().eq('id', id).is('posted_at', null)
  if (onlyFrom !== undefined) q = q.eq('sent_by_telegram_id', onlyFrom)
  const { data } = await q.select('event_id')
  const eventId = ((data ?? []) as { event_id: string }[])[0]?.event_id
  if (!eventId) return { removed: false, remaining: 0 }
  const counts = await mediaCounts(eventId)
  return { removed: true, remaining: counts.pending }
}

/**
 * „Alle rauswerfen“ unter der Album-Bestätigung: entfernt alle noch nicht
 * geposteten Medien dieses Telegram-Albums, mit {onlyFrom} nur die eigenen.
 * @returns Anzahl der entfernten Medien
 */
export async function removeMediaGroup(mediaGroupId: string, onlyFrom?: number): Promise<number> {
  let q = getSupabase().from('event_photos').delete().eq('media_group_id', mediaGroupId).is('posted_at', null)
  if (onlyFrom !== undefined) q = q.eq('sent_by_telegram_id', onlyFrom)
  const { data } = await q.select('id')
  return (data ?? []).length
}

/* ---------- /send ---------- */

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

// Texte für die Elterngruppe: sympathisch, kurz, jedes Mal ein bisschen
// anders. {w} = "von heute" bzw. "vom Samstag".
const CAPTION_TEMPLATES: Array<(w: string) => string> = [
  (w) => `📸 <b>Einblicke in die Jungschar ${w}</b>\nSchön war's, wir freuen uns aufs nächste Mal!`,
  (w) => `📸 <b>Jungschar ${w} in Bildern</b>\nAlle Kinder heil zurück, nur die Hosen haben gelitten 😄`,
  (w) => `📸 <b>Beweisfotos ${w}</b>\nFalls jemand fragt, was in der Jungschar so passiert: das hier 😎`,
  (w) => `📸 <b>Ein paar Momente ${w}</b>\nLaut, dreckig, glücklich. Genau so soll es sein!`,
  (w) => `📸 <b>Highlights ${w}</b>\nDanke fürs Ausleihen eurer Kinder, wir hatten richtig Spaß!`,
  (w) => `📸 <b>Frisch aus der Jungschar ${w}</b>\nDas Programm stand, das Wetter hat mitgespielt, die Kinder sowieso 🙌`,
]

const IDEA_LINES: Array<(cmd: string) => string> = [
  (c) => `💡 Ihr habt eine tolle Idee für die nächste Jungschar? Lasst es uns wissen: ${c}`,
  (c) => `💡 Euer Kind hat zu Hause von einer Idee geschwärmt? Her damit: ${c}`,
  (c) => `💡 Ausflug, Spiel, Bastelei, egal was: Ideen für die nächste Jungschar nehmen wir gerne: ${c}`,
  (c) => `💡 Was würde euer Kind am liebsten machen? Ein Stichwort reicht uns: ${c}`,
  (c) => `💡 Wir sammeln Ideen fürs nächste Mal. Jede zählt, auch die verrückten: ${c}`,
  (c) => `💡 Ihr wisst, worauf die Kinder Lust haben? Verratet es uns: ${c}`,
]

const INVITE_LINES: Array<(cmd: string) => string> = [
  (c) => `🏠 Ihr wollt uns das nächste Mal einladen und etwas zu essen machen? Oder einfach mal so? Sehr gerne, immer cool: ${c}`,
  (c) => `🏠 Nächstes Mal ist Samstag, da haben wir Hunger 😄 Wer uns einladen möchte: ${c}`,
  (c) => `🏠 Lust, die ganze Bande einmal bei euch zu haben? Mit Essen oder ohne, wir kommen gerne: ${c}`,
  (c) => `🏠 Am Samstag sind wir wieder unterwegs. Wer uns zu sich einladen will: ${c}`,
  (c) => `🏠 Ihr habt einen Garten, eine Feuerstelle oder einfach Lust auf Besuch? Ladet uns ein: ${c}`,
  (c) => `🏠 Samstag heißt bei uns: irgendwo zu Gast sein wäre großartig. Einladung geht hier: ${c}`,
  (c) => `🏠 Am Samstag zu ruhig im Wohnzimmer? Wir bringen gerne zwölf Kinder vorbei, dann ist Stimmung: ${c}`,
  (c) => `🏠 Euer Haus ist euch am Samstag zu ordentlich? Das kriegen wir hin. Einladen hier: ${c}`,
  (c) => `🏠 Wer am Samstag zu viel Kuchen und zu wenig Kinder zu Hause hat, meldet sich hier: ${c}`,
  (c) => `🏠 Garten zu leise, Rasen zu grün, Keks-Vorrat zu groß? Wir helfen am Samstag gerne aus: ${c}`,
  (c) => `🏠 Samstag auf der Couch wird langweilig? Jungschar nach Hause bestellen geht hier: ${c}`,
  (c) => `🏠 Ihr habt am Samstag Lust auf Lärm, Lachen und leere Teller? Dann ladet uns ein: ${c}`,
]

/** Kurzer Text über dem Album in der Elterngruppe, rotierend. */
export function albumCaption(eventDate: string): string {
  const { date } = berlinNow()
  const when = eventDate === date
    ? 'von heute'
    : `vom ${new Date(eventDate + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long' })}`
  return pick(CAPTION_TEMPLATES)(when)
}

/** Nächster Termin nach {afterDate}. */
async function nextEventAfter(afterDate: string): Promise<PhotoEvent | null> {
  const { data } = await getSupabase()
    .from('events')
    .select('id, event_date')
    .gt('event_date', afterDate)
    .order('event_date', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as PhotoEvent) ?? null
}

/**
 * Hinweise unter dem Album: /idee, und /invite nur, wenn die nächste
 * Jungschar an einem Samstag ist (freitags versorgen wir uns selbst, da gibt
 * es keine Einladung). Die Befehle sind Direktlinks in den privaten Chat
 * (t.me/<bot>?start=…), damit niemand in der Gruppe tippen muss.
 */
export async function parentsFollowUp(eventDate: string): Promise<string> {
  const [username, next] = await Promise.all([botUsername(), nextEventAfter(eventDate)])
  const link = (payload: string, label: string) =>
    username ? `<a href="https://t.me/${username}?start=${payload}">${label}</a>` : label
  const lines = [pick(IDEA_LINES)(link('idee', '/idee'))]
  if (next && hasFoodDuty(next.event_date)) {
    lines.push(pick(INVITE_LINES)(link('invite', '/invite')))
  }
  return lines.join('\n\n')
}

/**
 * /send: alle ungeposteten Medien als Album(s) posten. Die Bildunterschrift
 * des ersten Albums trägt den kurzen Text plus die Hinweise auf /idee und
 * /invite (eine Nachricht, keine zweite Blase). Mit mark=true (Elterngruppe)
 * werden die Medien als gepostet markiert; mark=false (Sandbox-Test) lässt
 * sie offen, damit der echte Post später noch geht.
 */
export async function postMedia(
  chatId: string,
  event: PhotoEvent,
  mark = true,
): Promise<{ posted: number; albums: number }> {
  const db = getSupabase()
  const rows = await pendingMedia(event.id)
  if (rows.length === 0) return { posted: 0, albums: 0 }

  let albums = 0
  const postedIds: string[] = []
  // Telegram erlaubt 1024 Zeichen Caption; Text + Hinweise liegen weit darunter.
  const caption = `${albumCaption(event.event_date)}\n\n${await parentsFollowUp(event.event_date)}`
  for (let i = 0; i < rows.length; i += ALBUM_MAX) {
    const batch = rows.slice(i, i + ALBUM_MAX)
    const first = i === 0 ? caption : undefined
    const res = batch.length === 1
      ? await sendOne(chatId, batch[0], first ? { caption: first, parse_mode: 'HTML' } : {})
      : await sendAlbum(chatId, batch, first)
    if (!res?.ok) throw new Error(res?.description ?? 'Senden fehlgeschlagen')
    albums++
    postedIds.push(...batch.map(r => r.id))
  }

  if (mark) {
    await db.from('event_photos').update({ posted_at: new Date().toISOString() } as any).in('id', postedIds)
  }
  return { posted: postedIds.length, albums }
}

/* ---------- Danke-Nachricht in der Helfer-Gruppe ---------- */

// Pool an Danke-Nachrichten. Bewusst ohne Namen und ohne Tags: das Danke
// geht an die Runde, niemand bekommt deswegen einen Push.
const THANKS_TEMPLATES: string[] = [
  '+++ 🙌 <b>Geschafft!</b> +++\n\nDanke für die Jungschar heute. Top organisiert, kein Kind verloren gegangen, der Bot ist stolz 🥹',
  '+++ 🎬 <b>Abspann</b> +++\n\nDanke für die Jungschar heute, das war großes Kino 🍿',
  '+++ 🏆 <b>Feierabend!</b> +++\n\nKinder müde, Eltern glücklich, Programm top organisiert. Danke für die Jungschar heute, besser geht\'s nicht 😄',
  '+++ 🚀 <b>Mission erfüllt</b> +++\n\nSauber gelandet. Danke für die Jungschar heute, Houston ist begeistert 🛰️',
  '+++ ⭐ <b>5 von 5 Sternen</b> +++\n\nDanke für die Jungschar heute. Top organisiert, gerne wieder 👏',
  '+++ 🥳 <b>Abpfiff!</b> +++\n\nStarke Leistung! Danke für die Jungschar heute, ihr seid spitze 💪',
]

const THANKS_BUTTON = '📸 Momente festgehalten?'

/** Text + Button der Danke-Nachricht (auch für die Vorschau in Bot Health). */
export async function buildThanksMessage(): Promise<{ text: string; replyMarkup?: any }> {
  const text = `${pick(THANKS_TEMPLATES)}\n\nFotos oder Videos gemacht? Button antippen und einfach reinschicken.`
  const username = await botUsername()
  return {
    text,
    // Ohne Bot-Username kein Deep-Link; dann bleibt es beim Text.
    replyMarkup: username
      ? { inline_keyboard: [[{ text: THANKS_BUTTON, url: `https://t.me/${username}?start=fotos` }]] }
      : undefined,
  }
}

async function loadEvent(date: string): Promise<PhotoEvent | null> {
  const { data } = await getSupabase()
    .from('events')
    .select('id, event_date')
    .eq('event_date', date)
    .maybeSingle()
  return (data as PhotoEvent) ?? null
}

export interface ThanksResult {
  sent: boolean
  eventId?: string
  skipped?: string
  error?: string
}

/**
 * Abends am Tag der Jungschar (20:00 Ortszeit, hängt am review-ping-Cron):
 * Danke in die Helfer-Gruppe mit Button „Momente festgehalten?“, der in den
 * privaten Chat mit dem Bot führt. Einmal pro Termin (reminder_log).
 * Im Test wird nichts geloggt und die Uhrzeit nicht geprüft.
 */
export async function sendThanksToHelpers(opts: {
  chatId: string
  date?: string
  force?: boolean
  isTest?: boolean
}): Promise<ThanksResult> {
  const db = getSupabase()
  const now = berlinNow()
  const date = opts.date ?? now.date

  if (!opts.force && !opts.isTest && now.hour < REVIEW_HOUR_LOCAL) {
    return { sent: false, skipped: `vor ${REVIEW_HOUR_LOCAL}:00 Ortszeit` }
  }

  const event = await loadEvent(date)
  if (!event) return { sent: false, skipped: 'kein Termin an diesem Tag' }

  if (!opts.isTest) {
    const { data: already } = await db
      .from('reminder_log')
      .select('id')
      .eq('event_id', event.id)
      .eq('reminder_type', THANKS_LOG_TYPE)
      .limit(1)
    if ((already?.length ?? 0) > 0) return { sent: false, eventId: event.id, skipped: 'schon gesendet' }

    // Steht der Termin nicht mehr im Kalender, ist die Jungschar ausgefallen.
    const calendarDates = await fetchJungscharDatesFromIcs()
    if (calendarDates && !calendarDates.has(event.event_date)) {
      return { sent: false, eventId: event.id, skipped: 'Termin nicht mehr im Kalender' }
    }
  }

  const { text, replyMarkup } = await buildThanksMessage()
  const res = await sendTelegramMessage(opts.chatId, text, replyMarkup)
  if (!res?.ok) return { sent: false, eventId: event.id, error: res?.description ?? 'unbekannt' }

  if (!opts.isTest) {
    await db.from('reminder_log').upsert(
      { event_id: event.id, reminder_type: THANKS_LOG_TYPE, message_id: res.result?.message_id ?? null } as any,
      { onConflict: 'event_id,reminder_type' },
    )
  }
  return { sent: true, eventId: event.id }
}

/** Vorschau der Danke-Nachricht für einen Termin (ohne Senden). */
export async function renderThanksPreview(eventDate: string): Promise<{ text: string; buttons: string[] } | null> {
  if (!(await loadEvent(eventDate))) return null
  const { text } = await buildThanksMessage()
  return { text, buttons: [THANKS_BUTTON] }
}

/** Antwort auf den Button „Momente festgehalten?“ (/start fotos im privaten Chat). */
export async function photoInvite(): Promise<string> {
  const event = await eventForNewPhoto()
  if (!event) {
    return 'In den letzten drei Tagen war keine Jungschar. Sobald wieder eine war, kannst du mir hier Fotos und Videos schicken.'
  }
  return (
    `Her mit den Momenten von ${shortDate(event.event_date)}! 📸\n\n` +
    'Unten auf die Büroklammer tippen, Fotos und Videos auswählen, senden. Gern mehrere auf einmal.'
  )
}
