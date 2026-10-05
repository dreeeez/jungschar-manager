import { NextRequest, NextResponse } from 'next/server'
import { saveParentRotation } from '@/services/parent-rotation'
import { requireOperator } from '@/services/api-guard'

export const dynamic = 'force-dynamic'

/**
 * Eltern-Einteilung speichern. Body { proposals: [{ eventId, parentId }] }:
 * ersetzt den Elterndienst dieser Samstags-Termine. Postet nichts.
 */
export async function POST(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  try {
    const body = await req.json().catch(() => null)
    const proposals = Array.isArray(body?.proposals)
      ? body.proposals.filter((p: any) => typeof p?.eventId === 'string' && typeof p?.parentId === 'string')
      : []
    if (proposals.length === 0) {
      return NextResponse.json({ error: 'proposals required' }, { status: 400 })
    }
    return NextResponse.json(await saveParentRotation(proposals))
  } catch (e: any) {
    console.error('parent rotation commit failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}
