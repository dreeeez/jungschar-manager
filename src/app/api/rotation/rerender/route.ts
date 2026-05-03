import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/services/database'
import { rerenderRotationMessage } from '@/services/rotation'

export const dynamic = 'force-dynamic'

/**
 * Wird vom Mini-App nach jedem Helfer-Tausch gefeuert. Nimmt event_id
 * entgegen, schaut die zugehörige Telegram-Rotation-Nachricht nach und
 * editiert sie (HTML-Re-Render der aktuellen Verteilung).
 *
 * Idempotent — wenn das Event keine rotation_message_id hat (z.B. Test-Posts
 * oder noch keine Rotation gepostet), passiert nichts.
 */
export async function POST(req: NextRequest) {
  try {
    const eventId = req.nextUrl.searchParams.get('event_id')
    if (!eventId) {
      return NextResponse.json({ error: 'event_id required' }, { status: 400 })
    }

    const db = getSupabase()
    const { data: event } = await db
      .from('events')
      .select('rotation_message_id')
      .eq('id', eventId)
      .maybeSingle()

    const messageId = (event as any)?.rotation_message_id
    if (!messageId) {
      return NextResponse.json({ ok: true, skipped: 'no rotation message' })
    }

    const result = await rerenderRotationMessage(messageId)
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message ?? 'unknown' }, { status: 500 })
  }
}
