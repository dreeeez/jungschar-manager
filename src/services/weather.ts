import { getSupabase } from './database'

export interface WeatherForecast {
  date: string
  temperature_max: number
  temperature_min: number
  precipitation_probability: number
  weather_description: string
}

// WMO Wettercodes → deutsche Beschreibungen
const WEATHER_CODES: Record<number, string> = {
  0: 'Klar',
  1: 'Überwiegend klar',
  2: 'Teilweise bewölkt',
  3: 'Bewölkt',
  45: 'Nebel',
  48: 'Nebel mit Reif',
  51: 'Leichter Nieselregen',
  53: 'Nieselregen',
  55: 'Starker Nieselregen',
  61: 'Leichter Regen',
  63: 'Regen',
  65: 'Starker Regen',
  71: 'Leichter Schneefall',
  73: 'Schneefall',
  75: 'Starker Schneefall',
  80: 'Leichte Regenschauer',
  81: 'Regenschauer',
  82: 'Starke Regenschauer',
  85: 'Leichte Schneeschauer',
  86: 'Starke Schneeschauer',
  95: 'Gewitter',
  96: 'Gewitter mit Hagel',
  99: 'Gewitter mit starkem Hagel',
}

// Jungschar-Zeit: 17–18 Uhr. Wir wollen Wetter für genau diesen Slot,
// nicht das 24h-Tagesminimum/-maximum (das wäre Nacht-Tiefstwert).
const JUNGSCHAR_HOURS = ['T17:00', 'T18:00']

/**
 * Holt die Wettervorhersage von Open-Meteo (kostenlos, kein API-Key).
 * Verwendet Stundenwerte aus dem Jungschar-Zeitraum (17–18 Uhr) statt
 * der irreführenden 24h-Tages-Min/Max-Spanne.
 */
export async function getWeatherForecast(
  latitude: number,
  longitude: number,
  targetDate: string
): Promise<WeatherForecast | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation_probability,weather_code&timezone=Europe/Berlin&start_date=${targetDate}&end_date=${targetDate}`

    const response = await fetch(url)
    if (!response.ok) return null

    const data = await response.json()
    const hourly = data.hourly
    if (!hourly?.time) return null

    const indices = JUNGSCHAR_HOURS
      .map((suffix) => (hourly.time as string[]).findIndex((t) => t.endsWith(suffix)))
      .filter((i) => i >= 0)

    if (indices.length === 0) return null

    const temps = indices
      .map((i) => hourly.temperature_2m[i])
      .filter((t: number | null) => t != null) as number[]
    const precs = indices
      .map((i) => hourly.precipitation_probability[i])
      .filter((p: number | null) => p != null) as number[]
    const weatherCode = hourly.weather_code[indices[0]]

    return {
      date: targetDate,
      temperature_max: Math.max(...temps),
      temperature_min: Math.min(...temps),
      precipitation_probability: precs.length ? Math.max(...precs) : 0,
      weather_description: WEATHER_CODES[weatherCode] || 'Unbekannt',
    }
  } catch (error) {
    console.error('Weather API error:', error)
    return null
  }
}

/**
 * Liest den Standort aus der Settings-Tabelle
 */
export async function getLocationFromSettings(): Promise<{
  latitude: number
  longitude: number
  city: string
} | null> {
  try {
    const { data } = await getSupabase()
      .from('settings')
      .select('value')
      .eq('key', 'weather_location')
      .single()

    if (!data?.value) return null
    return JSON.parse(data.value)
  } catch {
    return null
  }
}
