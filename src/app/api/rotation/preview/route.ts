import { NextResponse } from 'next/server'
import { generateRotation } from '@/services/rotation'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const result = await generateRotation()
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('rotation preview failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}

export async function GET() {
  return POST()
}
