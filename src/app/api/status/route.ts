import { NextRequest, NextResponse } from 'next/server'
import { getBotStatus } from '@/services/status'
import { requireOperator } from '@/services/api-guard'

export const dynamic = 'force-dynamic'

/**
 * Read-only Status-Snapshot für die Mini-App. Sendet/schreibt nichts.
 * Erreichbar für angemeldete Helfer (Session-Cookie) oder per CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  try {
    const status = await getBotStatus()
    return NextResponse.json(status)
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'internal error' }, { status: 500 })
  }
}
