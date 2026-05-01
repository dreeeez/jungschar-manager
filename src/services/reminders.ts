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
const STAGE_SATURDAY = 'stage3_saturday'

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

type Birthday = { name: string; dayMonth: string; age: number }

/**
 * Findet Kinder mit Geburtstag im Zeitraum ±3 Tage um das Event und
 * gibt strukturierte Daten zurück (Name, Tag/Monat, Alter).
 */
async function getBirthdaysAroundEvent(eventDate: string): Promise<Birthday[]> {
  try {
    const event = new Date(eventDate)
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
        const bdayThisYear = new Date(event.getFullYear(), bday.getMonth(), bday.getDate())
        return bdayThisYear >= from && bdayThisYear <= to
      })
      .map((child: any) => {
        const bday = new Date(child.birthday)
        const age = event.getFullYear() - bday.getFullYear()
        const bdayThisYear = new Date(event.getFullYear(), bday.getMonth(), bday.getDate())
        return {
          name: child.name,
          dayMonth: bdayThisYear.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' }),
          age,
        }
      })
  } catch {
    return []
  }
}

/**
 * Geburtstags-Block: ein Header + eine Zeile pro Kind mit
 * Kind-Emoji, Name, Datum und Alter.
 */
function formatBirthdayLine(birthdays: Birthday[]): string {
  if (birthdays.length === 0) return ''
  const lines = birthdays.map((b) => `🧒 ${b.name} — ${b.dayMonth} (wird ${b.age})`).join('\n')
  return `🎂 <b>Geburtstag diese Woche:</b>\n${lines}\n`
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

// Top-Header für Stage 1 — rotiert unabhängig vom Theme.
// Bewusst etwas länger gehalten, sonst wirken kurze Titel im "+++ X +++"
// Wrap visuell unausgewogen.
const STAGE1_TOP_HEADERS = [
  'JUNGSCHAR NEWS',
  'JUNGSCHAR INTEL',
  'HEADS-UP — NÄCHSTE WOCHE',
  'NÄCHSTE WOCHE JUNGSCHAR',
  '📣 ANKÜNDIGUNG',
]

function pickStage1TopHeader(): string {
  return STAGE1_TOP_HEADERS[Math.floor(Math.random() * STAGE1_TOP_HEADERS.length)]
}

function generateStage1Message(event: any, weather: WeatherForecast | null, birthdays: Birthday[]): ReminderMessage {
  const ctx: Stage1Ctx = {
    date: formatDate(event.event_date),
    emoji: weatherEmoji(weather),
    desc: weather?.weather_description ?? 'Wetter unbekannt',
    temp: weather ? weatherTempStr(weather) : '?°C',
    team: getHelperTags(event),
    parent: getParentDutyDisplay(event),
    birthdayLine: formatBirthdayLine(birthdays),
  }
  return {
    message: `+++ ${pickStage1TopHeader()} +++\n\n${pickStage1Template()(ctx)}`,
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
  birthdays: Birthday[]
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

// Bibelvers-Pool für Stage 3 (Samstag morgen). Mix aus Helfer-Kontext
// (Kinder, Dienst, Weisheit) und allgemein motivierenden Versen.
// Schlachter/Luther-nah übersetzt.
const BIBLE_VERSES: Array<{ ref: string; text: string }> = [
  { ref: 'Josua 1,9', text: 'Sei stark und mutig! Hab keine Angst und verzage nicht; denn der HERR, dein Gott, ist mit dir überall, wo du hingehst.' },
  { ref: 'Philipper 4,13', text: 'Ich vermag alles durch den, der mich kräftig macht, Christus.' },
  { ref: 'Kolosser 3,23', text: 'Alles, was ihr tut, das tut von Herzen als dem Herrn und nicht den Menschen.' },
  { ref: 'Matthäus 19,14', text: 'Lasst die Kinder zu mir kommen und hindert sie nicht; denn solchen wie ihnen gehört das Reich Gottes.' },
  { ref: '2. Timotheus 1,7', text: 'Gott hat uns nicht gegeben den Geist der Furcht, sondern der Kraft und der Liebe und der Besonnenheit.' },
  { ref: '1. Korinther 16,14', text: 'Alles, was ihr tut, das tut in Liebe!' },
  { ref: 'Sprüche 3,5–6', text: 'Verlass dich auf den HERRN von ganzem Herzen … so wird er deine Pfade ebnen.' },
  { ref: 'Matthäus 5,16', text: 'Lasst euer Licht leuchten vor den Leuten, damit sie eure guten Werke sehen und euren Vater im Himmel preisen.' },
  { ref: 'Jesaja 41,10', text: 'Fürchte dich nicht, ich bin mit dir … Ich stärke dich, ich helfe dir auch.' },
  { ref: 'Jakobus 1,5', text: 'Wenn aber jemandem unter euch Weisheit mangelt, so bitte er Gott, der allen gern und ohne Vorwurf gibt.' },
  { ref: 'Galater 6,9', text: 'Lasst uns aber Gutes tun und nicht müde werden; denn zu seiner Zeit werden wir ernten, wenn wir nicht nachlassen.' },
  { ref: 'Sprüche 16,3', text: 'Befiehl dem HERRN deine Werke, so wird er deine Pläne festigen.' },
  { ref: 'Psalm 16,11', text: 'Vor dir ist Freude die Fülle und Wonne zu deiner Rechten ewiglich.' },
  { ref: 'Epheser 4,32', text: 'Seid aber untereinander freundlich und herzlich und vergebt einander.' },
  { ref: '5. Mose 31,6', text: 'Seid stark und mutig! … denn der HERR, dein Gott, geht selbst mit dir.' },
  { ref: 'Hebräer 12,1', text: 'Lasst uns mit Geduld laufen in dem Kampf, der uns bestimmt ist.' },
  { ref: 'Römer 12,11', text: 'Seid nicht träge in dem, was ihr tun sollt. Seid brennend im Geist. Dient dem Herrn.' },
  { ref: 'Psalm 118,24', text: 'Dies ist der Tag, den der HERR gemacht hat; lasst uns freuen und fröhlich an ihm sein.' },
]

function pickBibleVerse() {
  return BIBLE_VERSES[Math.floor(Math.random() * BIBLE_VERSES.length)]
}

type Stage3Ctx = {
  verse: string
  reference: string
}

// 6 themed Stage-3-Greetings für Samstag morgen (Tag des Events).
// Kompakt — kein Team, keine Sekundär-Greeting-Zeile, nur Theme +
// Bibelvers + Closing.
const STAGE3_TEMPLATES: Array<(c: Stage3Ctx) => string> = [
  // 1. Klassisch
  (c) =>
    `🌅 <b>Heute ist es soweit — Jungschar!</b>\n\n` +
    `📖 „${c.verse}"\n— ${c.reference}\n\n` +
    `Ihr schafft das! Viel Spaß und Gottes Segen 🙏`,

  // 2. Coffee Mode
  (c) =>
    `☕ <b>Espresso doppelt — Jungschar-Modus on!</b>\n\n` +
    `📖 „${c.verse}"\n— ${c.reference}\n\n` +
    `Ihr schafft das! Viel Spaß und Gottes Segen 🙏`,

  // 3. Showtime
  (c) =>
    `🎬 <b>Showtime!</b>\n\n` +
    `📖 „${c.verse}"\n— ${c.reference}\n\n` +
    `Ihr schafft das! Viel Spaß und Gottes Segen 🙏`,

  // 4. Aufwachen-Crew
  (c) =>
    `🌅 <b>Aufstehen, Helfer-Crew!</b>\n\n` +
    `📖 „${c.verse}"\n— ${c.reference}\n\n` +
    `Ihr schafft das! Viel Spaß und Gottes Segen 🙏`,

  // 5. Mission Control
  (c) =>
    `🚀 <b>Mission Control: Heute ist der Tag!</b>\n\n` +
    `📖 „${c.verse}"\n— ${c.reference}\n\n` +
    `Ihr schafft das! Viel Spaß und Gottes Segen 🙏`,

  // 6. Powerwecker
  (c) =>
    `⏰ <b>Powerwecker — 3, 2, 1, JUNGSCHAR!</b>\n\n` +
    `📖 „${c.verse}"\n— ${c.reference}\n\n` +
    `Ihr schafft das! Viel Spaß und Gottes Segen 🙏`,
]

function pickStage3Template(): (c: Stage3Ctx) => string {
  return STAGE3_TEMPLATES[Math.floor(Math.random() * STAGE3_TEMPLATES.length)]
}

/**
 * STUFE 3 — Samstag morgen (Tag des Events)
 * Aufwacher-Gruß mit themed Greeting + rotierendem Bibelvers.
 */
function generateStage3Message(_event: any): ReminderMessage {
  const verse = pickBibleVerse()
  const ctx: Stage3Ctx = {
    verse: verse.text,
    reference: verse.ref,
  }
  return { message: pickStage3Template()(ctx) }
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

    // Stufe 3: Tag des Events (Samstag morgen)
    if (testStage === 3 || (!isTest && daysUntil === 0)) {
      reminderType = STAGE_SATURDAY
      if (isTest || !(await wasReminderSent(event.id, reminderType))) {
        reminder = generateStage3Message(event)
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
