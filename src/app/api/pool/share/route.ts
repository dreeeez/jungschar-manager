import { NextRequest, NextResponse } from 'next/server'
import { getSession, hasCronSecret } from '@/services/api-guard'
import { isAdmin } from '@/services/admins'
import { shareIdeas } from '@/services/pool-share'

export const dynamic = 'force-dynamic'

/**
 * Ideen aus dem Pool in die Helfer-Gruppe posten. Nur Admins.
 * Body: { ids: string[], test?: boolean }  — test=true → Sandbox-Gruppe.
 */
export async function POST(req: NextRequest) {
  const session = getSession(req)
  const allowed = hasCronSecret(req) || (session && isAdmin(session.uid))
  if (!allowed) {
    return NextResponse.json({ error: 'Nur für Admins' }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : []
    const test = body?.test === true
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids required' }, { status: 400 })
    }

    const chatId = test ? process.env.TELEGRAM_TEST_CHAT_ID : process.env.TELEGRAM_CHAT_ID
    if (!chatId) {
      return NextResponse.json({ error: `${test ? 'TELEGRAM_TEST_CHAT_ID' : 'TELEGRAM_CHAT_ID'} not configured` }, { status: 500 })
    }

    const result = await shareIdeas({ ids, chatId })
    return NextResponse.json({ mode: test ? 'sandbox' : 'live', ...result })
  } catch (e: any) {
    console.error('pool share failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}
