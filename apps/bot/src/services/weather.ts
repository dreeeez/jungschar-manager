const OPENWEATHERMAP_API_KEY = process.env.OPENWEATHERMAP_API_KEY;
const DEFAULT_LOCATION = process.env.WEATHER_LOCATION || 'Berlin,DE';

interface WeatherData {
  temp: number;
  description: string;
  icon: string;
  rain: boolean;
}

export async function getWeatherForecast(dateStr: string): Promise<string> {
  if (!OPENWEATHERMAP_API_KEY) {
    return 'Wetter-API nicht konfiguriert. Bitte OPENWEATHERMAP_API_KEY setzen.';
  }

  try {
    const targetDate = new Date(dateStr);
    const today = new Date();
    const daysAhead = Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // OpenWeatherMap free tier only provides 5-day forecast
    if (daysAhead > 5) {
      return `Wetter-Vorhersage ist nur für die nächsten 5 Tage verfügbar.\n(Termin ist in ${daysAhead} Tagen)`;
    }

    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(DEFAULT_LOCATION)}&appid=${OPENWEATHERMAP_API_KEY}&units=metric&lang=de`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();

    // Find forecast for the target date (around noon)
    const targetTimestamp = new Date(dateStr + 'T12:00:00').getTime() / 1000;
    const forecast = data.list.reduce((closest: any, item: any) => {
      if (!closest) return item;
      const closestDiff = Math.abs(closest.dt - targetTimestamp);
      const itemDiff = Math.abs(item.dt - targetTimestamp);
      return itemDiff < closestDiff ? item : closest;
    }, null);

    if (!forecast) {
      return 'Keine Wetterdaten für diesen Tag verfügbar.';
    }

    const temp = Math.round(forecast.main.temp);
    const feelsLike = Math.round(forecast.main.feels_like);
    const description = forecast.weather[0].description;
    const icon = getWeatherEmoji(forecast.weather[0].icon);
    const rain = forecast.rain?.['3h'] || 0;
    const windSpeed = Math.round(forecast.wind.speed * 3.6); // Convert m/s to km/h

    let recommendation = '';
    if (rain > 0) {
      recommendation = '☔ Regenschirm einpacken!';
    } else if (temp < 5) {
      recommendation = '🧥 Warm anziehen!';
    } else if (temp > 25) {
      recommendation = '☀️ Sonnencreme nicht vergessen!';
    } else {
      recommendation = '👍 Gutes Wetter für Aktivitäten!';
    }

    return `${icon} ${temp}°C (gefühlt ${feelsLike}°C)
${capitalize(description)}
💨 Wind: ${windSpeed} km/h
${rain > 0 ? `🌧️ Niederschlag: ${rain}mm\n` : ''}
${recommendation}`;
  } catch (error) {
    console.error('Weather API error:', error);
    return 'Fehler beim Abrufen der Wetterdaten.';
  }
}

function getWeatherEmoji(iconCode: string): string {
  const iconMap: Record<string, string> = {
    '01d': '☀️',
    '01n': '🌙',
    '02d': '⛅',
    '02n': '☁️',
    '03d': '☁️',
    '03n': '☁️',
    '04d': '☁️',
    '04n': '☁️',
    '09d': '🌧️',
    '09n': '🌧️',
    '10d': '🌦️',
    '10n': '🌧️',
    '11d': '⛈️',
    '11n': '⛈️',
    '13d': '❄️',
    '13n': '❄️',
    '50d': '🌫️',
    '50n': '🌫️',
  };
  return iconMap[iconCode] || '🌤️';
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
