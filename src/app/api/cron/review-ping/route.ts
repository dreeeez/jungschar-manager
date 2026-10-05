import { NextRequest, NextResponse } from 'next/server'
import { processReviewPings } from '@/services/review-ping'
import { ADMIN_TELEGRAM_USER_IDS } from '@/services/admins'
import { sendThanksToHelpers, type ThanksResult } from '@/services/photos'

export const dynamic = 'force-dynamic'

/**
 * Abend-Bewertung: DM an die Admins am Tag der Jungschar (20:00 Ortszeit).
 * Im selben Lauf geht die Danke-Nachricht mit dem Button „Momente
 * festgehalten?“ in die Helfer-Gruppe (im Test: Sandbox-Gruppe, ohne Log).
 *
 * Läuft zweimal täglich (18:00 + 19:00 UTC, siehe vercel.json), sendet aber
 * nur, wenn es in Europe/Berlin schon 20 Uhr ist, und nur einmal pro Termin.
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

    const result = await processReviewPings({ force, date, testUserId })

    // Danke + Foto-Button in die Helfer-Gruppe (einmal pro Termin, unabhängig
    // davon, ob der Termin schon bewertet ist).
    let thanks: ThanksResult
    const thanksChat = isTest ? process.env.TELEGRAM_TEST_CHAT_ID : process.env.TELEGRAM_CHAT_ID
    if (!thanksChat) {
      thanks = { sent: false, error: `${isTest ? 'TELEGRAM_TEST_CHAT_ID' : 'TELEGRAM_CHAT_ID'} not configured` }
    } else {
      try {
        thanks = await sendThanksToHelpers({ chatId: thanksChat, date, force, isTest })
      } catch (e: any) {
        console.error('thanks message failed:', e)
        thanks = { sent: false, error: e.message ?? 'unbekannt' }
      }
    }
    return NextResponse.json({ ...result, thanks })
  } catch (error) {
    console.error('Error in review-ping cron:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
