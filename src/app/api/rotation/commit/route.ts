import { NextRequest, NextResponse } from 'next/server'
import {
  generateRotation,
  commitRotation,
  formatRotationMessage,
} from '@/services/rotation'
import { sendTelegramMessage } from '@/services/reminders'

export const dynamic = 'force-dynamic'

/**
 * Generiert die Rotation, postet die Einteilungs-Nachricht in den Chat und
 * (sofern nicht test-Mode) schreibt die Assignments in die DB.
 *
 * Query-Params:
 *   ?test=1   → posted in TELEGRAM_TEST_CHAT_ID, KEINE DB-Writes
 *   (default) → posted in TELEGRAM_CHAT_ID, schreibt assignments
 */
export async function POST(req: NextRequest) {
  try {
    const isTest = req.nextUrl.searchParams.get('test') === '1'

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
        message: 'Nichts zu posten — keine offenen Slots im 12-Wochen-Fenster.',
      })
    }

    const text = formatRotationMessage(rotation.proposals)
    const sendResult = await sendTelegramMessage(chatId, text)

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
      telegram: sendResult,
    })
  } catch (e: any) {
    console.error('rotation commit failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
