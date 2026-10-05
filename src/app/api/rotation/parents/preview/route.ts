import { NextRequest, NextResponse } from 'next/server'
import { generateParentRotation } from '@/services/parent-rotation'
import { requireOperator } from '@/services/api-guard'

export const dynamic = 'force-dynamic'

/**
 * Vorschau der Eltern-Einteilung (Essen) für die Samstage des Halbjahres.
 * Schreibt nichts, sendet nichts.
 */
export async function POST(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  try {
    return NextResponse.json(await generateParentRotation())
  } catch (e: any) {
    console.error('parent rotation preview failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}
