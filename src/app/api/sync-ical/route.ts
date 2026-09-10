import { NextRequest, NextResponse } from 'next/server'
import { syncJungscharEvents } from '@/services/ical-sync'
import { requireOperator } from '@/services/api-guard'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  try {
    const result = await syncJungscharEvents()
    const status = result.errors.length > 0 ? 500 : 200
    return NextResponse.json(result, { status })
  } catch (e: any) {
    console.error('ical-sync failed:', e)
    return NextResponse.json(
      { errors: [e.message || 'unknown error'] },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
