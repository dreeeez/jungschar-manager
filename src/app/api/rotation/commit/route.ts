import { NextRequest, NextResponse } from 'next/server'
import { executeRotation } from '@/services/rotation'

export const dynamic = 'force-dynamic'

/**
 * Generiert die Rotation, postet die Einteilungs-Nachricht(en) in den Chat
 * und (sofern nicht test-Mode) schreibt die Assignments in die DB + persistiert
 * message_id auf events + pinnt.
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

    const result = await executeRotation({ chatId, isTest, splitAt })

    return NextResponse.json({
      mode: isTest ? 'test' : 'live',
      ...result,
    })
  } catch (e: any) {
    console.error('rotation commit failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
