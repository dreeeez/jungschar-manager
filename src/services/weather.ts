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

/**
 * Holt die Wettervorhersage von Open-Meteo (kostenlos, kein API-Key)
 */
export async function getWeatherForecast(
  latitude: number,
  longitude: number,
  targetDate: string
): Promise<WeatherForecast | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=Europe/Berlin&start_date=${targetDate}&end_date=${targetDate}`

    const response = await fetch(url)
    if (!response.ok) return null

    const data = await response.json()
    const daily = data.daily

    if (!daily || !daily.time || daily.time.length === 0) return null

    const weatherCode = daily.weather_code[0]

    return {
      date: daily.time[0],
      temperature_max: daily.temperature_2m_max[0],
      temperature_min: daily.temperature_2m_min[0],
      precipitation_probability: daily.precipitation_probability_max[0],
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
