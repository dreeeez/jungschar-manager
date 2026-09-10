import { getSupabase } from './database'
import { ADMIN_TELEGRAM_USER_IDS } from './admins'
import { sendTelegramMessage } from './reminders'
import { getHelperNames } from './events'
import { getLocationFromSettings, getWeatherForecast } from './weather'
import { formatDate } from '@/utils/format'

/**
 * Abend-Bewertung per DM.
 *
 * Am Tag der Jungschar um 20:00 Ortszeit bekommt jeder auf der Zugangsliste
 * eine private Nachricht mit Sterne-Buttons. Danach fragt der Bot nach
 * Drinnen/Draußen und zum Schluss nach einem kurzen Freitext. Das Ergebnis
 * landet als Eintrag im Archiv (ideas, was_used = true, source = 'bot'),
 * inklusive Wetter des Tages.
 *
 * Sobald einer bewertet hat, werden die DMs der anderen bearbeitet: Buttons
 * weg, stattdessen "X hat bereits bewertet". So bewertet niemand doppelt.
 *
 * Cron: Vercel-Hobby erlaubt nur einmal täglich pro Cron und läuft in UTC.
 * Deshalb zwei Crons (18:00 und 19:00 UTC); gesendet wird nur, wenn es in
 * Europe/Berlin schon 20 Uhr ist, und nur einmal pro Termin und Empfänger.
 */

const TZ = 'Europe/Berlin'
export const REVIEW_HOUR_LOCAL = 20

type PingState = 'stars' | 'place' | 'text' | 'done' | 'closed'

interface ReviewPing {
  id: string
  event_id: string
  telegram_user_id: number
  chat_id: number
  message_id: number | null
  state: PingState
  stars: number | null
  place: string | null
  is_test: boolean
}

/** Datum und Stunde in Europe/Berlin. */
export function berlinNow(d = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) }
}

function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function loadEvent(eventId: string) {
  const { data } = await getSupabase()
    .from('events')
    .select('id, event_date, assignments(helper:helpers(name))')
    .eq('id', eventId)
    .maybeSingle()
  return data as any
}

function header(event: any): string {
  const helpers = getHelperNames(event)
  return `<b>Wie war die Jungschar heute?</b>\n${formatDate(event.event_date)}${helpers ? ` · ${esc(helpers)}` : ''}`
}

async function hasLog(eventId: string): Promise<boolean> {
  const { data } = await getSupabase()
    .from('ideas')
    .select('id')
    .eq('event_id', eventId)
    .eq('was_used', true)
    .limit(1)
  return (data?.length ?? 0) > 0
}

async function editMessage(chatId: number, messageId: number, text: string, replyMarkup?: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup ?? { inline_keyboard: [] },
    }),
  }).catch((e) => console.error('editMessageText failed:', e))
}

function starsKeyboard(eventId: string) {
  return {
    inline_keyboard: [[1, 2, 3, 4, 5].map((n) => ({ text: `${n} ★`, callback_data: `rvs_${eventId}_${n}` }))],
  }
}

function placeKeyboard(eventId: string) {
  return {
    inline_keyboard: [[
      { text: 'Drinnen', callback_data: `rvp_${eventId}_in` },
      { text: 'Draußen', callback_data: `rvp_${eventId}_out` },
    ]],
  }
}

export interface ReviewPingResult {
  date: string
  eventId: string | null
  skipped?: string
  sent: number[]
  failed: { userId: number; error: string }[]
}

/**
 * Cron-Einstieg. Sendet die Bewertungs-DMs für den heutigen Termin.
 * @param opts.force       Uhrzeit-Prüfung überspringen (Tests)
 * @param opts.date        anderes Datum als heute (Tests)
 * @param opts.testUserId  nur an diese ID senden, als Test markiert
 */
export async function processReviewPings(opts: {
  force?: boolean
  date?: string
  testUserId?: number
} = {}): Promise<ReviewPingResult> {
  const db = getSupabase()
  const now = berlinNow()
  const date = opts.date ?? now.date
  const result: ReviewPingResult = { date, eventId: null, sent: [], failed: [] }

  if (!opts.force && !opts.testUserId && now.hour < REVIEW_HOUR_LOCAL) {
    result.skipped = `vor ${REVIEW_HOUR_LOCAL}:00 Ortszeit`
    return result
  }

  const { data: event } = await db
    .from('events')
    .select('id, event_date, assignments(helper:helpers(name))')
    .eq('event_date', date)
    .maybeSingle()
  if (!event) {
    result.skipped = 'kein Termin an diesem Tag'
    return result
  }
  result.eventId = (event as any).id

  if (await hasLog((event as any).id)) {
    result.skipped = 'Termin ist schon bewertet'
    return result
  }

  const recipients = opts.testUserId ? [opts.testUserId] : [...ADMIN_TELEGRAM_USER_IDS]
  const isTest = !!opts.testUserId

  const { data: existing } = await db
    .from('review_pings')
    .select('telegram_user_id, is_test')
    .eq('event_id', (event as any).id)
  const alreadyPinged = new Set(
    ((existing ?? []) as any[]).filter((r) => !r.is_test || isTest).map((r) => Number(r.telegram_user_id)),
  )

  for (const uid of recipients) {
    if (alreadyPinged.has(uid) && !isTest) continue

    const text = `${header(event)}\n\nBewerte mit Sternen:\n\n<i>Fotos von heute? Schick sie mir einfach hier rein, /senden postet sie später in den Elternchat.</i>`
    const res = await sendTelegramMessage(String(uid), text, starsKeyboard((event as any).id))
    if (!res?.ok) {
      result.failed.push({ userId: uid, error: res?.description ?? 'unbekannt' })
      continue
    }

    await db.from('review_pings').upsert(
      {
        event_id: (event as any).id,
        telegram_user_id: uid,
        chat_id: uid,
        message_id: res.result.message_id,
        state: 'stars',
        stars: null,
        place: null,
        is_test: isTest,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'event_id,telegram_user_id' },
    )
    result.sent.push(uid)
  }

  return result
}

async function loadPing(eventId: string, userId: number): Promise<ReviewPing | null> {
  const { data } = await getSupabase()
    .from('review_pings')
    .select('*')
    .eq('event_id', eventId)
    .eq('telegram_user_id', userId)
    .maybeSingle()
  return (data as ReviewPing) ?? null
}

async function updatePing(id: string, patch: Partial<ReviewPing>) {
  await getSupabase()
    .from('review_pings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
}

/**
 * Inline-Button-Klicks: rvs_<eventId>_<1-5> (Sterne), rvp_<eventId>_<in|out>.
 * @returns Text für answerCallbackQuery
 */
export async function handleReviewCallback(
  action: 'rvs' | 'rvp',
  eventId: string,
  value: string,
  userId: number,
): Promise<string> {
  const ping = await loadPing(eventId, userId)
  if (!ping || !ping.message_id) return 'Kein offener Bewertungs-Ping.'

  const event = await loadEvent(eventId)
  if (!event) return 'Termin nicht gefunden.'

  if (ping.state === 'closed' || ping.state === 'done') return 'Dieser Termin ist schon bewertet.'

  // Zwischenzeitlich anderswo bewertet (Mini-App oder anderer Admin)?
  if (await hasLog(eventId)) {
    await updatePing(ping.id, { state: 'closed' })
    await editMessage(ping.chat_id, ping.message_id, `${header(event)}\n\nIst schon bewertet, danke.`)
    return 'Schon bewertet.'
  }

  if (action === 'rvs') {
    const n = Math.min(5, Math.max(1, Number(value) || 0))
    await updatePing(ping.id, { stars: n, state: 'place' })
    await editMessage(
      ping.chat_id,
      ping.message_id,
      `${header(event)}\n\nBewertung: ${stars(n)}\n\nWart ihr drinnen oder draußen?`,
      placeKeyboard(eventId),
    )
    return `${n} Sterne`
  }

  const place = value === 'in' ? 'drinnen' : 'draußen'
  const n = ping.stars ?? 0
  await updatePing(ping.id, { place, state: 'text' })
  await editMessage(
    ping.chat_id,
    ping.message_id,
    `${header(event)}\n\nBewertung: ${stars(n)} · ${place}\n\nJetzt noch kurz: Was habt ihr gemacht? Schreib es einfach hier in den Chat.`,
  )
  return place === 'drinnen' ? 'Drinnen' : 'Draußen'
}

/**
 * Freitext im privaten Chat: schließt eine offene Bewertung ab.
 * @returns true, wenn die Nachricht als Bewertung verarbeitet wurde
 */
export async function handleReviewText(
  userId: number,
  text: string,
  reply: (html: string) => Promise<unknown>,
  displayName: string,
): Promise<boolean> {
  const db = getSupabase()
  const { data } = await db
    .from('review_pings')
    .select('*')
    .eq('telegram_user_id', userId)
    .eq('state', 'text')
    .order('updated_at', { ascending: false })
    .limit(1)
  const ping = (data?.[0] as ReviewPing) ?? null
  if (!ping) return false

  const clean = text.trim()
  if (!clean) return false

  const event = await loadEvent(ping.event_id)
  if (!event) return false

  // Wetter des Tages dazuholen — optional, darf fehlschlagen.
  let weather_description: string | null = null
  let temperature: number | null = null
  try {
    const loc = await getLocationFromSettings()
    if (loc) {
      const w = await getWeatherForecast(loc.latitude, loc.longitude, event.event_date)
      if (w) {
        weather_description = w.weather_description
        temperature = w.temperature_max
      }
    }
  } catch {}

  const { error } = await db.from('ideas').insert({
    event_id: ping.event_id,
    title: clean.slice(0, 200),
    description: clean,
    was_used: true,
    source: 'bot',
    rating: ping.stars,
    tags: ping.place ? [ping.place] : [],
    weather_description,
    temperature,
  })
  if (error) {
    await reply('Speichern hat nicht geklappt. Bitte später in der Mini-App eintragen.')
    console.error('review insert failed:', error)
    return true
  }

  await updatePing(ping.id, { state: 'done' })

  const summary = `${stars(ping.stars ?? 0)} · ${ping.place ?? '–'}`
  const weatherLine = weather_description
    ? `\nWetter: ${esc(weather_description)}${temperature != null ? `, ${temperature} °C` : ''}`
    : ''
  if (ping.message_id) {
    await editMessage(
      ping.chat_id,
      ping.message_id,
      `${header(event)}\n\nBewertung: ${summary}\n${esc(clean)}${weatherLine}\n\nGespeichert, danke.`,
    )
  }
  await reply(`Gespeichert: ${summary}${weatherLine}`)

  // Die anderen informieren und ihre Buttons abräumen.
  const { data: others } = await db
    .from('review_pings')
    .select('*')
    .eq('event_id', ping.event_id)
    .neq('telegram_user_id', userId)
    .not('state', 'in', '("done","closed")')
  for (const o of (others ?? []) as ReviewPing[]) {
    await updatePing(o.id, { state: 'closed' })
    if (o.message_id) {
      await editMessage(
        o.chat_id,
        o.message_id,
        `${header(event)}\n\n<b>${esc(displayName)} hat bereits bewertet:</b> ${summary}\n${esc(clean)}`,
      )
    }
  }

  return true
}

/** Vorschau der Bewertungs-DM für einen Termin (ohne Senden). */
export async function renderReviewPreview(eventDate: string): Promise<string | null> {
  const { data: event } = await getSupabase()
    .from('events')
    .select('id, event_date, assignments(helper:helpers(name))')
    .eq('event_date', eventDate)
    .maybeSingle()
  if (!event) return null
  return `${header(event)}\n\nBewerte mit Sternen:\n[ 1 ★ ] [ 2 ★ ] [ 3 ★ ] [ 4 ★ ] [ 5 ★ ]`
}
