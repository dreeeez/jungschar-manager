import { NextRequest, NextResponse } from 'next/server'
import { nextBlock, planNextBlock, helperBalances, currentBlockRemaining } from '@/services/rotation'
import { requireOperator } from '@/services/api-guard'
import { staleEventIds } from '@/services/ics-reconcile'

export const dynamic = 'force-dynamic'

/**
 * Nächster Block (4 Termine nach der gepinnten Einteilung).
 *   Body { saved: true } → gespeicherten Stand (Entwurf) liefern, dazu
 *     current = noch offene Termine der gepinnten Einteilung.
 *   Sonst → neu ziehen per Quote (schreibt nichts).
 * Immer dabei: balances (Bilanz je Helfer) für den Ersatz-Vorschlag.
 */
export async function POST(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  try {
    const body = await req.json().catch(() => null)
    if (body?.saved) {
      const next = await nextBlock()
      const first = next.events[0]?.eventDate
      const balances = first ? await helperBalances(first) : {}
      const current = await currentBlockRemaining()
      // Kommende Termine, die nicht mehr im ICS stehen (Badge in der App).
      const stale = await staleEventIds().catch(() => null)
      return NextResponse.json({ proposals: next.events, current, stale: stale ?? [], skipped: [], after: next.after, balances })
    }
    const result = await planNextBlock()
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('rotation preview failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}
