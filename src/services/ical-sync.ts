import { getSupabase } from './database'

const TIMEZONE = 'Europe/Berlin'
const JUNGSCHAR_SUMMARY = 'Jungschar'

export interface IcsEvent {
  uid: string
  summary: string
  dtstart: Date
  description: string | null
}

export interface SyncResult {
  fetched: number
  jungscharFound: number
  inserted: number
  skipped: number
  errors: string[]
}

/**
 * Faltet ICS-Zeilen wieder zusammen: Zeilen die mit Space oder Tab beginnen
 * sind Continuation der vorherigen Zeile (RFC 5545).
 */
function unfoldLines(text: string): string[] {
  const raw = text.split(/\r?\n/)
  const out: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

/**
 * Parst ein DTSTART-Datum im Format YYYYMMDDTHHMMSSZ (UTC) oder YYYYMMDD (all-day).
 */
function parseIcsDate(value: string): Date | null {
  const utc = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  if (utc) {
    return new Date(Date.UTC(
      +utc[1], +utc[2] - 1, +utc[3], +utc[4], +utc[5], +utc[6],
    ))
  }
  const dateOnly = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly) {
    return new Date(Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3], 12, 0, 0))
  }
  return null
}

/**
 * Datum als YYYY-MM-DD in lokaler (Berlin-)Zeit.
 */
function localDateString(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * Parst einen ICS-Feed in eine Liste von VEVENTs (nur DTSTART/SUMMARY/UID/DESCRIPTION).
 */
export function parseIcs(text: string): IcsEvent[] {
  const lines = unfoldLines(text)
  const events: IcsEvent[] = []
  let current: Partial<IcsEvent> | null = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {}
      continue
    }
    if (line === 'END:VEVENT') {
      if (current?.uid && current.summary && current.dtstart) {
        events.push({
          uid: current.uid,
          summary: current.summary,
          dtstart: current.dtstart,
          description: current.description ?? null,
        })
      }
      current = null
      continue
    }
    if (!current) continue

    const colon = line.indexOf(':')
    if (colon === -1) continue
    const keyPart = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const key = keyPart.split(';')[0]

    switch (key) {
      case 'UID':
        current.uid = value
        break
      case 'SUMMARY':
        current.summary = unescapeIcsText(value)
        break
      case 'DTSTART':
        current.dtstart = parseIcsDate(value) ?? undefined
        break
      case 'DESCRIPTION':
        current.description = unescapeIcsText(value)
        break
    }
  }

  return events
}

function unescapeIcsText(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

/**
 * Holt iCal-URL aus settings, fetcht Feed, filtert auf "Jungschar"-Events
 * und upserted neue Events in die events-Tabelle (existierende werden nicht
 * überschrieben — manuelle Edits bleiben erhalten).
 */
export async function syncJungscharEvents(): Promise<SyncResult> {
  const result: SyncResult = {
    fetched: 0,
    jungscharFound: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
  }

  const db = getSupabase()

  const { data: setting, error: settingError } = await db
    .from('settings')
    .select('value')
    .eq('key', 'ical_url')
    .single()

  if (settingError || !setting?.value) {
    result.errors.push('ical_url nicht in settings konfiguriert')
    return result
  }

  const url = setting.value

  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store' })
  } catch (e: any) {
    result.errors.push(`fetch failed: ${e.message}`)
    return result
  }

  if (!response.ok) {
    result.errors.push(`fetch returned ${response.status}`)
    return result
  }

  const ics = await response.text()
  const events = parseIcs(ics)
  result.fetched = events.length

  const jungschar = events.filter(
    e => e.summary.trim().toLowerCase() === JUNGSCHAR_SUMMARY.toLowerCase(),
  )
  result.jungscharFound = jungschar.length

  if (jungschar.length === 0) return result

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: existing } = await db
    .from('events')
    .select('event_date')
  const existingDates = new Set((existing ?? []).map((e: any) => e.event_date))

  const rowsToInsert = jungschar
    .filter(e => e.dtstart >= today)
    .map(e => ({
      event_date: localDateString(e.dtstart),
      title: e.summary,
      description: null,
    }))
    .filter(row => !existingDates.has(row.event_date))

  result.skipped = jungschar.length - rowsToInsert.length

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await db
      .from('events')
      .insert(rowsToInsert as any)

    if (insertError) {
      result.errors.push(`insert failed: ${insertError.message}`)
      return result
    }
    result.inserted = rowsToInsert.length
  }

  await db
    .from('settings')
    .upsert(
      { key: 'last_ical_sync', value: JSON.stringify({ at: new Date().toISOString(), result }) } as any,
      { onConflict: 'key' },
    )

  return result
}
