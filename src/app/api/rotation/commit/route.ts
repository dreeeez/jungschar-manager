import { NextRequest, NextResponse } from 'next/server'
import {
  generateRotation,
  commitRotation,
  formatRotationMessage,
} from '@/services/rotation'
import { sendTelegramMessage } from '@/services/reminders'

export const dynamic = 'force-dynamic'

/**
 * Generiert die Rotation, postet die Einteilungs-Nachricht(en) in den Chat
 * und (sofern nicht test-Mode) schreibt die Assignments in die DB.
 *
 * Query-Params:
 *   ?test=1                  → TELEGRAM_TEST_CHAT_ID, KEINE DB-Writes
 *   ?splitAt=YYYY-MM-DD      → 2 Nachrichten: Termine vor splitAt + ab splitAt
 */
export async function POST(req: NextRequest) {
  try {
    const isTest = req.nextUrl.searchParams.get('test') === '1'
    const splitAt = req.nextUrl.searchParams.get('splitAt')

    const chatId = isTest
      ? process.env.TELEGRAM_TEST_CHAT_ID
      : process.env.TELEGRAM_CHAT_ID

    if (!chatId) {
      const missing = isTest ? 'TELEGRAM_TEST_CHAT_ID' : 'TELEGRAM_CHAT_ID'
      return NextResponse.json({ error: `${missing} not configured` }, { status: 500 })
    }

    const rotation = await generateRotation()

    if (rotation.proposals.length === 0) {
      return NextResponse.json({
        mode: isTest ? 'test' : 'live',
        proposals: [],
        skipped: rotation.skipped,
        message: 'Nichts zu posten — keine offenen Slots im Planungsfenster.',
      })
    }

    const batches = splitAt
      ? [
          rotation.proposals.filter(p => p.eventDate < splitAt),
          rotation.proposals.filter(p => p.eventDate >= splitAt),
        ].filter(b => b.length > 0)
      : [rotation.proposals]

    const sendResults: any[] = []
    for (const batch of batches) {
      const text = formatRotationMessage(batch)
      const result = await sendTelegramMessage(chatId, text)
      sendResults.push(result)
    }

    let inserted = 0
    if (!isTest) {
      const commit = await commitRotation(rotation.proposals)
      inserted = commit.inserted
    }

    return NextResponse.json({
      mode: isTest ? 'test' : 'live',
      proposals: rotation.proposals,
      skipped: rotation.skipped,
      inserted,
      telegram: sendResults,
    })
  } catch (e: any) {
    console.error('rotation commit failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
