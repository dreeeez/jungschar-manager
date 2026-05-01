import { NextRequest, NextResponse } from 'next/server'
import { processPollReminder } from '@/services/poll-reminder'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const isTest = req.nextUrl.searchParams.get('test') === '1'
    const forceLive = req.nextUrl.searchParams.get('live') === '1'

    const useTestChat = isTest && !forceLive
    const chatId = useTestChat
      ? process.env.TELEGRAM_TEST_CHAT_ID
      : process.env.TELEGRAM_CHAT_ID

    if (!chatId) {
      const missing = useTestChat ? 'TELEGRAM_TEST_CHAT_ID' : 'TELEGRAM_CHAT_ID'
      return NextResponse.json({ error: `${missing} not configured` }, { status: 500 })
    }

    const result = await processPollReminder(chatId, isTest)
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error in poll-reminder cron:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
