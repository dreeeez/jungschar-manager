import { NextRequest, NextResponse } from 'next/server'
import { previewRotationMessage } from '@/services/rotation'
import { requireOperator } from '@/services/api-guard'

export const dynamic = 'force-dynamic'

/**
 * Vorschau der Telegram-Nachricht für eine (angepasste) Einteilung.
 * Body { proposals: [{ eventId, helperIds }] }. Schreibt nichts, sendet nichts.
 */
export async function POST(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  try {
    const body = await req.json().catch(() => null)
    const proposals = Array.isArray(body?.proposals) ? body.proposals : []
    const result = await previewRotationMessage(proposals)
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('rotation message preview failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}
