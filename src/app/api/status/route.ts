import { NextResponse } from 'next/server'
import { getBotStatus } from '@/services/status'

export const dynamic = 'force-dynamic'

/**
 * Read-only Status-Snapshot für die Mini-App. Sendet/schreibt nichts.
 * Ohne Auth (wie die übrigen Mini-App-Routes) — liefert nur Termin-/Feed-/
 * Reminder-Übersicht, die in der App ohnehin sichtbar ist.
 */
export async function GET() {
  try {
    const status = await getBotStatus()
    return NextResponse.json(status)
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'internal error' }, { status: 500 })
  }
}
