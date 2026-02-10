import { formatDate, getDaysUntil, getDayOfWeek } from '@/utils/format'
import { getUpcomingEvents, getHelperNames, getHelperMentions } from './events'
import { getParentDutyName } from './parents'
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
 * Loggt eine gesendete Erinnerung
 */
async function logReminder(eventId: string, reminderType: string): Promise<void> {
  await getSupabase()
    .from('reminder_log')
    .insert({ event_id: eventId, reminder_type: reminderType } as any)
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
 * Formatiert eine Wetter-Zeile für die Nachricht
 */
function formatWeatherLine(weather: WeatherForecast | null): string {
  if (!weather) return ''
  return `🌤️ Wetter: ${weather.weather_description}, ${Math.round(weather.temperature_min)}–${Math.round(weather.temperature_max)}°C` +
    (weather.precipitation_probability > 30 ? ` (☔ ${weather.precipitation_probability}%)` : '') +
    '\n'
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
function generateStage1Message(event: any, weather: WeatherForecast | null, birthdays: string[]): ReminderMessage {
  const helperNames = getHelperNames(event)
  const mentions = getHelperMentions(event)
  const parentName = getParentDutyName(event)

  return {
    message: `📅 <b>Nächste Woche ist Jungschar!</b>\n\n` +
      `📆 ${formatDate(event.event_date)}\n` +
      `${formatWeatherLine(weather)}` +
      `👥 Team: ${helperNames}\n` +
      `${mentions ? `${mentions} - ihr seid dran!\n` : ''}` +
      `🍽️ Essen: ${parentName}\n` +
      `${formatBirthdayLine(birthdays)}` +
      `\nFangt an zu planen!`,
  }
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
  const helperNames = getHelperNames(event)
  const mentions = getHelperMentions(event)

  return {
    message: `🤔 <b>Wie ist der Status?</b>\n\n` +
      `Noch <b>${daysUntil} Tage</b> bis zur Jungschar!\n` +
      `📆 ${formatDate(event.event_date)}\n` +
      `${formatWeatherLine(weather)}` +
      `👥 Team: ${helperNames}\n` +
      `${mentions ? `${mentions}\n` : ''}` +
      `${formatBirthdayLine(birthdays)}` +
      `\n━━━━━━━━━━━━━━━\n\n` +
      `📋 <b>Checkliste:</b>\n` +
      `⚠️ Eltern wegen Essen kontaktiert? — <b>Frist HEUTE!</b>\n` +
      `• Steht das Programm?\n` +
      `• Material vorbereitet?\n` +
      `• Kinderstunde vorbereitet?\n` +
      `• Programm in Elternchat kommuniziert?\n` +
      `\n━━━━━━━━━━━━━━━\n\n` +
      `📊 <b>Wer ist dabei?</b>\n\n` +
      `✅ Dabei: —\n` +
      `❌ Absagen: —`,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: '✅ Bin dabei!', callback_data: `votey_${event.id}` },
          { text: '❌ Kann nicht', callback_data: `voten_${event.id}` },
        ],
        [
          { text: '💡 Wir brauchen eine Idee!', callback_data: `idea_${event.id}` },
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
  const helperNames = getHelperNames(event)
  const mentions = getHelperMentions(event)
  const dayWord = daysUntil === 1 ? 'morgen' : 'übermorgen'

  return {
    message: `🔔 <b>Jungschar ist ${dayWord}!</b>\n\n` +
      `📆 ${formatDate(event.event_date)}\n` +
      `👥 Team: ${helperNames}\n` +
      `${mentions ? `${mentions}\n` : ''}\n` +
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
    if (testStage === 1 || (dayOfWeek === 0 && daysUntil >= 6 && daysUntil <= 8)) {
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
    if (testStage === 2 || (dayOfWeek === 3 && daysUntil >= 3 && daysUntil <= 4)) {
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
    if (testStage === 3 || (dayOfWeek === 5 && daysUntil >= 1 && daysUntil <= 2)) {
      reminderType = STAGE_FRIDAY
      if (isTest || !(await wasReminderSent(event.id, reminderType))) {
        reminder = generateStage3Message(event, daysUntil)
      }
    }

    if (reminder && reminderType) {
      const result = await sendTelegramMessage(chatId, reminder.message, reminder.replyMarkup)
      if (!isTest) {
        await logReminder(event.id, reminderType)
      }
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
