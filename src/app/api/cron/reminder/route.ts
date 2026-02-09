import { NextRequest, NextResponse } from 'next/server'
import { processReminders } from '@/services/reminders'

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!chatId) {
    return NextResponse.json({ error: 'TELEGRAM_CHAT_ID not configured' }, { status: 500 })
  }

  try {
    const testStage = req.nextUrl.searchParams.get('test')
    const result = await processReminders(chatId, testStage ? parseInt(testStage) : undefined)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error in reminder cron:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
