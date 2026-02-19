import { GoogleGenerativeAI } from '@google/generative-ai'
import { WeatherForecast, getWeatherForecast, getLocationFromSettings } from './weather'

// Fallback-Ideen falls AI nicht verfügbar
const FALLBACK_IDEAS = [
  '🎨 <b>Kreativ-Werkstatt</b>: Malt gemeinsam ein großes Bild zum Thema "Gottes Schöpfung"',
  '🏃 <b>Schnitzeljagd</b>: Versteckt Hinweise im Gemeindehaus mit Bibelversen',
  '🎭 <b>Theaterspiel</b>: Spielt eine Geschichte aus der Bibel nach (z.B. David & Goliath)',
  '🧩 <b>Escape Room</b>: Löst Rätsel um eine "Schatztruhe" zu öffnen',
  '🍪 <b>Back-Aktion</b>: Backt gemeinsam Kekse für Senioren in der Gemeinde',
  '🎵 <b>Musik-Session</b>: Lernt ein neues Lied mit Bewegungen',
  '⚽ <b>Sport-Olympiade</b>: Verschiedene Stationen mit kleinen Wettkämpfen',
  '🔬 <b>Experimente</b>: Einfache Experimente die Gottes Wunder zeigen',
  '📖 <b>Bibelquiz</b>: Teams treten gegeneinander an',
  '🌳 <b>Natur-Rallye</b>: Erkundet die Natur und sammelt Schätze',
  '🎲 <b>Spieleabend</b>: Brettspiele und Gemeinschaft',
  '✉️ <b>Briefaktion</b>: Schreibt ermutigende Briefe an Gemeindemitglieder',
]

interface IdeaContext {
  eventDate: string
  weather: WeatherForecast | null
  ageGroup: string
}

/**
 * Generiert eine Programmidee mit Google Gemini AI
 */
export async function generateActivityIdea(context: IdeaContext): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    console.warn('GEMINI_API_KEY not set, using fallback idea')
    return getRandomFallbackIdea()
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

    let weatherInfo = 'Keine Wetterdaten verfügbar.'
    if (context.weather) {
      weatherInfo = `Wetter: ${context.weather.weather_description}, ${context.weather.temperature_min}–${context.weather.temperature_max}°C, Regenwahrscheinlichkeit: ${context.weather.precipitation_probability}%`
    }

    const prompt = `Du bist ein kreativer Jugendgruppenleiter. Generiere eine konkrete Programmidee für eine Jungschar (Kindergruppe, ca. 8-13 Jahre).

Datum: ${context.eventDate}
${weatherInfo}

Die Idee sollte enthalten:
- Einen kreativen Titel
- Kurze Beschreibung (2-3 Sätze)
- Benötigtes Material
- Ungefähre Dauer
- Optional: Bibelvers oder geistlicher Bezug

Berücksichtige das Wetter bei der Planung (drinnen bei schlechtem Wetter, draußen bei gutem).
Antworte auf Deutsch, kurz und praktisch. Formatiere mit HTML-Tags (<b> für fett).`

    const result = await model.generateContent(prompt)
    const text = result.response.text()

    if (!text || text.length < 10) {
      return getRandomFallbackIdea()
    }

    return text
  } catch (error) {
    console.error('Gemini API error:', error)
    return getRandomFallbackIdea()
  }
}

/**
 * Generiert eine Idee mit Wetter-Kontext für ein bestimmtes Event-Datum
 */
export async function generateIdeaForEvent(eventDate: string): Promise<string> {
  const location = await getLocationFromSettings()
  let weather: WeatherForecast | null = null

  if (location) {
    weather = await getWeatherForecast(location.latitude, location.longitude, eventDate)
  }

  return generateActivityIdea({
    eventDate,
    weather,
    ageGroup: 'Jungschar (ca. 8-13 Jahre)',
  })
}

/**
 * Sendet eine Nachricht als PN an einen User
 * Gibt false zurück wenn der User den Bot nicht gestartet hat
 */
export async function sendIdeaToUser(
  userId: number,
  idea: string
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: userId,
        text: idea,
        parse_mode: 'HTML',
      }),
    })

    const result = await response.json()

    if (!result.ok && result.error_code === 403) {
      return false
    }

    return result.ok
  } catch (error) {
    console.error('Error sending DM:', error)
    return false
  }
}

function getRandomFallbackIdea(): string {
  return FALLBACK_IDEAS[Math.floor(Math.random() * FALLBACK_IDEAS.length)]
}
