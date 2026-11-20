import { NextRequest, NextResponse } from 'next/server'
import { processReviewPings } from '@/services/review-ping'
import { ADMIN_TELEGRAM_USER_IDS } from '@/services/admins'
import { sendThanksToHelpers, type ThanksResult } from '@/services/photos'
import { getSupabase } from '@/services/database'
import { berlinNow } from '@/services/review-ping'
import { fetchJungscharEndTime } from '@/services/ical-sync'

export const dynamic = 'force-dynamic'

/** So viel vor dem Kalender-Ende darf es losgehen (Crons kommen ungenau). */
const SEND_BEFORE_END_MS = 15 * 60 * 1000

/**
 * Abend-Bewertung: DM an die Admins am Tag der Jungschar (20:00 Ortszeit).
 * Im selben Lauf geht die Danke-Nachricht mit dem Button „Momente
 * festgehalten?“ in die Helfer-Gruppe (im Test: Sandbox-Gruppe, ohne Log).
 *
 * Läuft abends stündlich (16–20 Uhr UTC, siehe vercel.json; Hobby-Crons
 * feuern irgendwann innerhalb der Stunde). Gesendet wird, sobald das Ende der
 * Jungschar laut Kalender (DTEND) minus 15 Minuten erreicht ist; ohne Uhrzeit
 * oder ohne erreichbaren Feed gilt 20:00 Ortszeit. Jede Nachricht nur einmal
 * pro Termin, spätere Läufe holen nach, was gefehlt hat.
 *
 * Bewertung und Danke laufen unabhängig: ein Fehler beim einen blockiert das
 * andere nicht. Live-Läufe an Jungschar-Tagen oder mit Fehler landen in
 * settings.review_ping_runs (die letzten 20), weil die Vercel-Logs im Hobby-Tarif schnell weg sind.
 *
 * Test:  ?test=1[&user=<telegram_id>][&date=YYYY-MM-DD]
 *        → nur an diese ID (Default: erste ID der Zugangsliste), als Test
 *          markiert, Uhrzeit-Prüfung aus.
 * Force: ?force=1 → Uhrzeit-Prüfung aus, sonst wie Cron.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const p = req.nextUrl.searchParams
    const isTest = p.get('test') === '1'
    const date = p.get('date') ?? undefined
    const force = p.get('force') === '1'

    let testUserId: number | undefined
    if (isTest) {
      const raw = p.get('user')
      testUserId = raw ? Number(raw) : [...ADMIN_TELEGRAM_USER_IDS][0]
      if (!Number.isFinite(testUserId)) {
        return NextResponse.json({ error: 'user must be a Telegram ID' }, { status: 400 })
      }
    }

    // Fällig? Ende laut Kalender minus 15 Minuten (Fallback 20:00 Ortszeit).
    // Danach rufen wir beide Teile mit force auf (deren eigene 20-Uhr-Prüfung entfällt).
    if (!isTest && !force) {
      const today = date ?? berlinNow().date
      const { data: ev } = await getSupabase().from('events').select('id').eq('event_date', today).maybeSingle()
      if (!ev) return NextResponse.json({ skipped: 'kein Termin heute' })
      const end = await fetchJungscharEndTime(today)
      const dueAt = end ? end.getTime() - SEND_BEFORE_END_MS : null
      const due = dueAt != null ? Date.now() >= dueAt : berlinNow().hour >= 20
      if (!due) {
        return NextResponse.json({ skipped: `noch nicht fällig (Ende ${end ? end.toISOString() : 'unbekannt, Fallback 20:00'})` })
      }
    }
    const sendNow = force || !isTest

    // Zuerst Danke + Foto-Button in die Helfer-Gruppe (einmal pro Termin): die
    // Nachricht an alle ist wichtiger als die DMs und soll auf jeden Fall raus.
    let thanks: ThanksResult
    const thanksChat = isTest ? process.env.TELEGRAM_TEST_CHAT_ID : process.env.TELEGRAM_CHAT_ID
    if (!thanksChat) {
      thanks = { sent: false, error: `${isTest ? 'TELEGRAM_TEST_CHAT_ID' : 'TELEGRAM_CHAT_ID'} not configured` }
    } else {
      try {
        thanks = await sendThanksToHelpers({ chatId: thanksChat, date, force: sendNow, isTest })
      } catch (e: any) {
        console.error('thanks message failed:', e)
        thanks = { sent: false, error: e.message ?? 'unbekannt' }
      }
    }
    // Danach die Bewertungs-DMs an die Admins, unabhängig vom Danke.
    let result: any
    try {
      result = await processReviewPings({ force: sendNow, date, testUserId })
    } catch (e: any) {
      console.error('review pings failed:', e)
      result = { error: e.message ?? 'unbekannt' }
    }

    // Nur Läufe an Jungschar-Tagen oder mit Fehler festhalten, sonst wären es 3 pro Tag.
    const relevant = result?.eventId || result?.error || thanks.eventId || thanks.error
    if (!isTest && relevant) await logRun({ review: result, thanks })
    return NextResponse.json({ ...result, thanks })
  } catch (error) {
    console.error('Error in review-ping cron:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Lauf festhalten (die letzten 20), damit man später nachsehen kann, was passiert ist. */
async function logRun(entry: Record<string, unknown>) {
  try {
    const db = getSupabase()
    const key = 'review_ping_runs'
    const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle()
    let runs: unknown[] = []
    try { runs = JSON.parse((data as any)?.value ?? '[]') } catch {}
    runs = [{ at: new Date().toISOString(), ...entry }, ...runs].slice(0, 20)
    await db.from('settings').upsert({ key, value: JSON.stringify(runs) } as any, { onConflict: 'key' })
  } catch (e) {
    console.error('review ping run log failed:', e)
  }
}
