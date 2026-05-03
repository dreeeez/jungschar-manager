import { NextRequest, NextResponse } from 'next/server'
import { processReminders } from '@/services/reminders'
import { syncJungscharEvents } from '@/services/ical-sync'

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const testStage = req.nextUrl.searchParams.get('test')
    const forceLive = req.nextUrl.searchParams.get('live') === '1'
    const isTest = !!testStage

    // Monatlicher Auto-Sync des iCal-Feeds: am 1. jedes Monats vor den Remindern.
    // Hängt am Daily-Cron statt eigenem Slot (Vercel Hobby = 2 Cron-Slots).
    let icalSync = null
    if (!isTest && new Date().getUTCDate() === 1) {
      try {
        icalSync = await syncJungscharEvents()
      } catch (e: any) {
        console.error('Monthly ical sync failed:', e)
        icalSync = { error: e.message }
      }
    }

    const useTestChat = isTest && !forceLive
    const chatId = useTestChat
      ? process.env.TELEGRAM_TEST_CHAT_ID
      : process.env.TELEGRAM_CHAT_ID

    if (!chatId) {
      const missing = useTestChat ? 'TELEGRAM_TEST_CHAT_ID' : 'TELEGRAM_CHAT_ID'
      return NextResponse.json({ error: `${missing} not configured` }, { status: 500 })
    }

    const result = await processReminders(chatId, isTest ? parseInt(testStage!) : undefined)
    return NextResponse.json({ ...result, icalSync })
  } catch (error) {
    console.error('Error in reminder cron:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
