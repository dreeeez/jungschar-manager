import { NextRequest, NextResponse } from 'next/server'
import { generateRotation } from '@/services/rotation'

import { requireOperator } from '@/services/api-guard'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  try {
    const result = await generateRotation()
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('rotation preview failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
