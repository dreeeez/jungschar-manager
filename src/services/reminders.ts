import { formatDate, getDaysUntil, getDayOfWeek } from '@/utils/format'
import { getUpcomingEvents, getHelperTags } from './events'
import { getParentDutyDisplay } from './parents'
import { getSupabase } from './database'
import { getWeatherForecast, getLocationFromSettings, WeatherForecast } from './weather'

interface ReminderMessage {
  message: string
  replyMarkup?: any
}

// Reminder-Typen für Duplikat-Schutz
const STAGE_SUNDAY = 'stage1_sunday'
const STAGE_WEDNESDAY = 'stage2_wednesday'
const STAGE_FRIDAY = 'stage3_friday'

/**
 * Sendet eine Nachricht an Telegram
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  replyMarkup?: any
): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN

  const body: any = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  }

  if (replyMarkup) {
    body.reply_markup = JSON.stringify(replyMarkup)
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  return response.json()
}

/**
 * Sendet einen nativen Telegram Poll
 */
export async function sendTelegramPoll(
  chatId: string,
  question: string,
  options: string[]
): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN

  const response = await fetch(`https://api.telegram.org/bot${token}/sendPoll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      question,
      options: JSON.stringify(options),
      is_anonymous: false,
      allows_multiple_answers: false,
    }),
  })

  return response.json()
}

/**
 * Prüft ob eine Erinnerung bereits gesendet wurde
 */
async function wasReminderSent(eventId: string, reminderType: string): Promise<boolean> {
  const { data } = await getSupabase()
    .from('reminder_log')
    .select('id')
    .eq('event_id', eventId)
    .eq('reminder_type', reminderType)
    .limit(1)
  return (data?.length ?? 0) > 0
}

/**
 * Loggt eine gesendete Erinnerung. Upsert auf (event_id, reminder_type),
 * damit Test-Reruns die message_id überschreiben statt zu crashen.
 */
async function logReminder(
  eventId: string,
  reminderType: string,
  messageId?: number
): Promise<void> {
  await getSupabase()
    .from('reminder_log')
    .upsert(
      {
        event_id: eventId,
        reminder_type: reminderType,
        message_id: messageId ?? null,
      } as any,
      { onConflict: 'event_id,reminder_type' }
    )
}

/**
 * Findet Kinder mit Geburtstag in der Woche des Events (Mo-So)
 */
async function getBirthdaysAroundEvent(eventDate: string): Promise<string[]> {
  try {
    const event = new Date(eventDate)
    // Woche um das Event: 3 Tage vorher bis 3 Tage nachher
    const from = new Date(event)
    from.setDate(from.getDate() - 3)
    const to = new Date(event)
    to.setDate(to.getDate() + 3)

    const { data } = await getSupabase()
      .from('children')
      .select('name, birthday')
      .eq('active', true)
      .not('birthday', 'is', null)

    if (!data) return []

    return data
      .filter((child: any) => {
        const bday = new Date(child.birthday)
        // Geburtstag im selben Zeitraum prüfen (Monat + Tag)
        const bdayThisYear = new Date(event.getFullYear(), bday.getMonth(), bday.getDate())
        return bdayThisYear >= from && bdayThisYear <= to
      })
      .map((child: any) => {
        const bday = new Date(child.birthday)
        const age = event.getFullYear() - bday.getFullYear()
        return `${child.name} (wird ${age})`
      })
  } catch {
    return []
  }
}

/**
 * Formatiert die Geburtstags-Zeile
 */
function formatBirthdayLine(birthdays: string[]): string {
  if (birthdays.length === 0) return ''
  return `🎂 Geburtstag diese Woche: ${birthdays.join(', ')}\n`
}

/**
 * Wählt ein passendes Emoji für die Wetterlage. Open-Meteo liefert
 * WMO-Codes, die wir hier in einzelne Emojis übersetzen. Bei <=2°C
 * gewinnt das Frost-Emoji (sonst sieht eine sonnige Eiseskälte falsch aus).
 */
function weatherEmoji(weather: WeatherForecast | null): string {
  if (!weather) return '🌤️'
  if (weather.temperature_max <= 2) return '🥶'
  const code = weather.weather_code
  if (code === 0) return '☀️'
  if (code === 1) return '🌤️'
  if (code === 2) return '⛅'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if ([51, 53, 55].includes(code)) return '🌦️'
  if ([61, 63, 65, 80, 81, 82].includes(code)) return '🌧️'
  if ([71, 73, 75, 85, 86].includes(code)) return '🌨️'
  if ([95, 96, 99].includes(code)) return '⛈️'
  return '🌤️'
}

function weatherTempStr(weather: WeatherForecast): string {
  const min = Math.round(weather.temperature_min)
  const max = Math.round(weather.temperature_max)
  return min === max ? `${max}°C` : `${min}–${max}°C`
}

/**
 * Standalone-Wetterzeile für Stage 2: "⛅ Teilweise bewölkt, 25°C [(Regen 60%)]".
 */
function formatWeatherStandalone(weather: WeatherForecast | null): string {
  if (!weather) return ''
  return `${weatherEmoji(weather)} ${weather.weather_description}, ${weatherTempStr(weather)}` +
    (weather.precipitation_probability > 30 ? ` (Regen ${weather.precipitation_probability}%)` : '')
}

/**
 * Holt die Wettervorhersage für ein Event-Datum
 */
async function fetchWeatherForEvent(eventDate: string): Promise<WeatherForecast | null> {
  try {
    const location = await getLocationFromSettings()
    if (!location) return null
    return await getWeatherForecast(location.latitude, location.longitude, eventDate)
  } catch {
    return null
  }
}

/**
 * STUFE 1 — Sonntag (6-8 Tage vorher)
 * Event-Ankündigung mit Team und Elterndienst
 */
type Stage1Ctx = {
  date: string
  emoji: string
  desc: string
  temp: string
  team: string
  parent: string
  birthdayLine: string
}

// Pool an themed Stage-1-Templates. Eines pro Send wird zufällig gezogen.
// Jedes muss klar Datum, Wetter, Team, Eltern-Essen kommunizieren — nur
// die "Verkleidung" wechselt.
const STAGE1_TEMPLATES: Array<(c: Stage1Ctx) => string> = [
  // 1. Spy / Mission Impossible
  (c) =>
    `🗺️ <b>Eure Mission, falls ihr sie annehmt:</b>\n\n` +
    `${c.date} · ${c.emoji} ${c.temp}\n` +
    `👥 Agenten: ${c.team}\n` +
    `🍽️ Verpflegung: ${c.parent}\n` +
    `${c.birthdayLine}` +
    `\nDiese Nachricht zerstört sich nicht selbst — fangt schon mal an zu planen 🙌`,

  // 2. Wahrsager / Glaskugel
  (c) =>
    `🔮 <b>Die Glaskugel hat gesprochen:</b>\n\n` +
    `${c.date} · ${c.emoji} ${c.temp}\n` +
    `👥 Auserwählte: ${c.team}\n` +
    `🍽️ Am Herd: ${c.parent}\n` +
    `${c.birthdayLine}` +
    `\nSchicksal akzeptiert — fangt an zu planen 🚀`,

  // 3. Wettervorhersage parodiert
  (c) =>
    `📡 <b>Vorhersage für ${c.date}:</b>\n\n` +
    `${c.emoji} ${c.desc}, ${c.temp}\n` +
    `👥 mit hoher Wahrscheinlichkeit ${c.team}\n` +
    `🍽️ und einer kräftigen Brise ${c.parent}\n` +
    `${c.birthdayLine}` +
    `\nAussichten: ihr seid dran. Planen anfangen 🌦️`,

  // 4. Spotify Wrapped
  (c) =>
    `🎵 <b>Jungschar Wrapped — eure nächste Schicht:</b>\n\n` +
    `${c.date} · ${c.emoji} ${c.temp}\n` +
    `👥 Top-Acts: ${c.team}\n` +
    `🍽️ Featured: ${c.parent}\n` +
    `${c.birthdayLine}` +
    `\nPress play in einer Woche ▶️`,

  // 5. Stadion-Ansage
  (c) =>
    `📣 <b>Achtung Achtung — die nächste Aufstellung:</b>\n\n` +
    `${c.date} · ${c.emoji} ${c.temp}\n` +
    `👥 Mannschaft: ${c.team}\n` +
    `🍽️ Catering: ${c.parent}\n` +
    `${c.birthdayLine}` +
    `\nAufwärmen darf beginnen 🏃`,

  // 6. Festival-Plakat
  (c) =>
    `🎤 <b>Festival-Lineup für ${c.date}:</b>\n\n` +
    `${c.emoji} Wetterprognose: ${c.temp}, ${c.desc}\n` +
    `👥 Headliner: ${c.team}\n` +
    `🍽️ Foodtruck: ${c.parent}\n` +
    `${c.birthdayLine}` +
    `\nSoundcheck in einer Woche 🎸`,

  // 7. Mission Control / Space
  (c) =>
    `🚀 <b>Mission Briefing — T-minus 7 Tage:</b>\n\n` +
    `${c.date} · ${c.emoji} ${c.temp}\n` +
    `👥 Astronauten: ${c.team}\n` +
    `🍽️ Bord-Verpflegung: ${c.parent}\n` +
    `${c.birthdayLine}` +
    `\nAlle Systeme bereit machen 🛰️`,
]

function pickStage1Template(): (c: Stage1Ctx) => string {
  return STAGE1_TEMPLATES[Math.floor(Math.random() * STAGE1_TEMPLATES.length)]
}

function generateStage1Message(event: any, weather: WeatherForecast | null, birthdays: string[]): ReminderMessage {
  const ctx: Stage1Ctx = {
    date: formatDate(event.event_date),
    emoji: weatherEmoji(weather),
    desc: weather?.weather_description ?? 'Wetter unbekannt',
    temp: weather ? weatherTempStr(weather) : '?°C',
    team: getHelperTags(event),
    parent: getParentDutyDisplay(event),
    birthdayLine: formatBirthdayLine(birthdays),
  }
  return { message: pickStage1Template()(ctx) }
}

/**
 * STUFE 2 — Mittwoch (3-4 Tage vorher)
 * Status-Check mit Checkliste, Poll und Idee-Button
 */
function generateStage2Message(
  event: any,
  daysUntil: number,
  weather: WeatherForecast | null,
  birthdays: string[]
): ReminderMessage {
  const teamTags = getHelperTags(event)
  const dayWord = daysUntil === 1 ? 'Tag' : 'Tage'

  return {
    message: `+++ 🔥 <b>Countdown: ${daysUntil} ${dayWord}</b> 🔥 +++\n` +
      `${formatWeatherStandalone(weather)}\n` +
      `Team: ${teamTags}\n` +
      `${formatBirthdayLine(birthdays)}` +
      `\n📋 <b>Checkliste</b> — Eltern (Essen) heute!\n` +
      `☐ Programm\n` +
      `☐ Material\n` +
      `☐ Kinderstunde\n` +
      `☐ Eltern-Chat\n` +
      `\n📊 <b>Wer ist dabei?</b>\n` +
      `✅ Dabei: —\n` +
      `❌ Absagen: —`,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: '✅ Bin dabei!', callback_data: `votey_${event.id}` },
          { text: '❌ Kann nicht', callback_data: `voten_${event.id}` },
        ],
      ],
    },
  }
}

/**
 * STUFE 3 — Freitag (1-2 Tage vorher)
 * Final Reminder, kurz und ermutigend
 */
function generateStage3Message(event: any, daysUntil: number): ReminderMessage {
  const teamTags = getHelperTags(event)
  const dayWord = daysUntil === 1 ? 'morgen' : 'übermorgen'

  return {
    message: `🔔 <b>Jungschar ist ${dayWord}!</b>\n\n` +
      `📆 ${formatDate(event.event_date)}\n` +
      `👥 Team: ${teamTags}\n\n` +
      `Ihr schafft das! Viel Spaß und Gottes Segen! 🙏`,
  }
}

/**
 * Prüft alle Events und sendet fällige Erinnerungen
 * testStage: 1/2/3 = forciert Stufe unabhängig von Wochentag/Tagen (nur zum Testen)
 */
export async function processReminders(chatId: string, testStage?: number) {
  const dayOfWeek = getDayOfWeek()
  const events = await getUpcomingEvents(5)

  if (!events || events.length === 0) {
    return { message: 'No upcoming events', reminders: [] }
  }

  const results: any[] = []
  const isTest = testStage !== undefined

  for (const event of events) {
    const eventDate = new Date(event.event_date)
    const daysUntil = getDaysUntil(eventDate)
    let reminder: ReminderMessage | null = null
    let reminderType: string | null = null

    // Stufe 1: Sonntag, 6-8 Tage vorher
    if (testStage === 1 || (!isTest && dayOfWeek === 0 && daysUntil >= 6 && daysUntil <= 8)) {
      reminderType = STAGE_SUNDAY
      if (isTest || !(await wasReminderSent(event.id, reminderType))) {
        const [weather, birthdays] = await Promise.all([
          fetchWeatherForEvent(event.event_date),
          getBirthdaysAroundEvent(event.event_date),
        ])
        reminder = generateStage1Message(event, weather, birthdays)
      }
    }

    // Stufe 2: Mittwoch, 3-4 Tage vorher
    if (testStage === 2 || (!isTest && dayOfWeek === 3 && daysUntil >= 3 && daysUntil <= 4)) {
      reminderType = STAGE_WEDNESDAY
      if (isTest || !(await wasReminderSent(event.id, reminderType))) {
        const [weather, birthdays] = await Promise.all([
          fetchWeatherForEvent(event.event_date),
          getBirthdaysAroundEvent(event.event_date),
        ])
        reminder = generateStage2Message(event, daysUntil, weather, birthdays)
      }
    }

    // Stufe 3: Freitag, 1-2 Tage vorher
    if (testStage === 3 || (!isTest && dayOfWeek === 5 && daysUntil >= 1 && daysUntil <= 2)) {
      reminderType = STAGE_FRIDAY
      if (isTest || !(await wasReminderSent(event.id, reminderType))) {
        reminder = generateStage3Message(event, daysUntil)
      }
    }

    if (reminder && reminderType) {
      const result = await sendTelegramMessage(chatId, reminder.message, reminder.replyMarkup)
      const messageId: number | undefined = result?.result?.message_id
      // Auch im Testmodus loggen, damit der Donnerstags-Reply-Test
      // die message_id auflesen kann (Upsert vermeidet UNIQUE-Konflikte).
      await logReminder(event.id, reminderType, messageId)
      results.push({
        event_id: event.id,
        event_date: event.event_date,
        daysUntil,
        dayOfWeek,
        reminderType,
        test: isTest,
        result,
      })

      // Im Testmodus nur 1 Event senden
      if (isTest) break
    }
  }

  if (results.length === 0) {
    return {
      message: isTest ? 'No upcoming events to test with' : 'No reminders needed today',
      dayOfWeek,
      nextEvents: events.map((e: any) => ({
        date: e.event_date,
        daysUntil: getDaysUntil(new Date(e.event_date)),
      })),
    }
  }

  return {
    success: true,
    message: `${results.length} reminder(s) sent${isTest ? ' (TEST)' : ''}`,
    results,
  }
}
