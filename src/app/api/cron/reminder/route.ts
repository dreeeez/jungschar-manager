import { NextRequest, NextResponse } from 'next/server'
import { processReminders } from '@/services/reminders'

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const testStage = req.nextUrl.searchParams.get('test')
    const isTest = !!testStage

    const chatId = isTest
      ? process.env.TELEGRAM_TEST_CHAT_ID
      : process.env.TELEGRAM_CHAT_ID

    if (!chatId) {
      const missing = isTest ? 'TELEGRAM_TEST_CHAT_ID' : 'TELEGRAM_CHAT_ID'
      return NextResponse.json({ error: `${missing} not configured` }, { status: 500 })
    }

    const result = await processReminders(chatId, isTest ? parseInt(testStage!) : undefined)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error in reminder cron:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
