import { NextRequest, NextResponse } from 'next/server'
import { executeHalfYearRotation } from '@/services/rotation'
import { requireOperator } from '@/services/api-guard'

export const dynamic = 'force-dynamic'

/**
 * Halbjahres-Einteilung posten und pinnen.
 *   ?test=1 → Sandbox-Gruppe (TELEGRAM_TEST_CHAT_ID), sonst Helfer-Gruppe.
 *   Body { proposals: [{ eventId, helperIds }] } → diese Einteilung speichern
 *   (ersetzt die Zuweisungen der Termine) und posten. Ohne Body → den
 *   gespeicherten Stand posten, keine Neuberechnung.
 */
export async function POST(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  try {
    const isTest = req.nextUrl.searchParams.get('test') === '1'
    const chatId = isTest ? process.env.TELEGRAM_TEST_CHAT_ID : process.env.TELEGRAM_CHAT_ID
    if (!chatId) {
      const missing = isTest ? 'TELEGRAM_TEST_CHAT_ID' : 'TELEGRAM_CHAT_ID'
      return NextResponse.json({ error: `${missing} not configured` }, { status: 500 })
    }
    const body = await req.json().catch(() => null)
    const override = Array.isArray(body?.proposals) ? body.proposals : undefined
    const result = await executeHalfYearRotation({ chatId, isTest, override })
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('rotation commit failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}
