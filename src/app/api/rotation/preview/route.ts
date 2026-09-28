import { NextRequest, NextResponse } from 'next/server'
import { generateHalfYearRotation } from '@/services/rotation'
import { requireOperator } from '@/services/api-guard'

export const dynamic = 'force-dynamic'

/**
 * Vorschau der Halbjahres-Einteilung. Body { lastHelperIds }: wer zuletzt
 * Jungschar gemacht hat. Schreibt nichts, sendet nichts.
 */
export async function POST(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  try {
    const body = await req.json().catch(() => null)
    const lastHelperIds = Array.isArray(body?.lastHelperIds) ? body.lastHelperIds : []
    const result = await generateHalfYearRotation(lastHelperIds)
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('rotation preview failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
