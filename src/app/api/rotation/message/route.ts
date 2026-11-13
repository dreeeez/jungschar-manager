import { NextRequest, NextResponse } from 'next/server'
import { blockMessagePreview, proposalsFromOverride } from '@/services/rotation'
import { requireOperator } from '@/services/api-guard'

export const dynamic = 'force-dynamic'

/**
 * Vorschau der Telegram-Nachricht für einen neuen Block (inkl. der noch
 * offenen Termine der jetzigen Einteilung, die oben mit reinkommen).
 * Body { proposals: [{ eventId, helperIds }] }. Schreibt nichts, sendet nichts.
 */
export async function POST(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  try {
    const body = await req.json().catch(() => null)
    const proposals = Array.isArray(body?.proposals) ? body.proposals : []
    const full = await proposalsFromOverride(proposals)
    return NextResponse.json({ text: await blockMessagePreview(full) })
  } catch (e: any) {
    console.error('rotation message preview failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}
