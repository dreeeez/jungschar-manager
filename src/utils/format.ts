// Archiv startet ab diesem Datum — alles davor wird ausgeblendet (Frischstart).
export const ARCHIVE_START_DATE = '2026-05-02'

/**
 * Formatiert ein Datum in deutschem Format
 * Beispiel: "Samstag, 24. Januar"
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }
  return date.toLocaleDateString('de-DE', options)
}

/**
 * Formatiert ein Datum kurz
 * Beispiel: "Sa, 24. Jan"
 */
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr)
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }
  return date.toLocaleDateString('de-DE', options)
}

/**
 * Formatiert ein Datum lang mit Jahr
 * Beispiel: "Samstag, 24. Januar 2026"
 */
export function formatDateLong(dateStr: string): string {
  const date = new Date(dateStr)
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }
  return date.toLocaleDateString('de-DE', options)
}

/**
 * Gibt Tage bis zum Event zurück
 */
export function getDaysUntil(eventDate: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const event = new Date(eventDate)
  event.setHours(0, 0, 0, 0)
  const diffTime = event.getTime() - today.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

/**
 * Gibt den Wochentag als Zahl zurück (0 = Sonntag)
 */
export function getDayOfWeek(): number {
  return new Date().getDay()
}
