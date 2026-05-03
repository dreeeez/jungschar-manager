import { NextResponse } from 'next/server'
import { syncJungscharEvents } from '@/services/ical-sync'

export const dynamic = 'force-dynamic'

export async function POST() {
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

export async function GET() {
  return POST()
}
