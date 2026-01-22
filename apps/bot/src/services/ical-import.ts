import ICAL from 'ical.js'
import { createHash } from 'crypto'
import { supabase } from './supabase.js'

// Convert any string to a valid UUID v5-like format
function stringToUUID(str: string): string {
  const hash = createHash('sha256').update(str).digest('hex')
  // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`
}

export async function importEventsFromICS(icsUrl: string) {
  try {
    console.log('Fetching iCal feed from:', icsUrl)

    // Fetch the ICS file
    const response = await fetch(icsUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch ICS: ${response.statusText}`)
    }

    const icsData = await response.text()

    // Parse iCal data
    const jcalData = ICAL.parse(icsData)
    const comp = new ICAL.Component(jcalData)
    const vevents = comp.getAllSubcomponents('vevent')

    console.log(`Found ${vevents.length} events in iCal feed`)

    const events = vevents.map((vevent) => {
      const event = new ICAL.Event(vevent)
      return {
        id: stringToUUID(event.uid),
        event_date: event.startDate.toJSDate().toISOString(),
        title: event.summary || 'Jungschar',
        description: event.description || null,
        imported_at: new Date().toISOString(),
      }
    })

    // Upsert events to database
    const { data, error } = await supabase
      .from('events')
      .upsert(events, { onConflict: 'id' })

    if (error) {
      console.error('Error upserting events:', error)
      throw error
    }

    console.log(`Successfully imported ${events.length} events`)
    return { success: true, count: events.length }
  } catch (error) {
    console.error('Error importing events:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function getICSUrl(): Promise<string | null> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'ical_url')
    .single()

  if (error || !data) {
    return null
  }

  return data.value
}

export async function importEventsFromSettings() {
  const icsUrl = await getICSUrl()

  if (!icsUrl) {
    console.log('No iCal URL configured in settings')
    return { success: false, error: 'No iCal URL configured' }
  }

  return importEventsFromICS(icsUrl)
}
