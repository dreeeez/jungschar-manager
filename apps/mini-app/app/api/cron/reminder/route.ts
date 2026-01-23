import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID // Group chat ID where reminders are sent

// Send message to Telegram
async function sendTelegramMessage(chatId: string, text: string) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  })
  return response.json()
}

// Format date helper
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }
  return date.toLocaleDateString('de-DE', options)
}

// Check if two dates are the same day
function isSameDay(date1: Date, date2: Date): boolean {
  return date1.toISOString().split('T')[0] === date2.toISOString().split('T')[0]
}

// Check if date is tomorrow
function isTomorrow(date: Date): boolean {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return isSameDay(date, tomorrow)
}

// Check if date is today
function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!TELEGRAM_CHAT_ID) {
    return NextResponse.json({ error: 'TELEGRAM_CHAT_ID not configured' }, { status: 500 })
  }

  try {
    // Get upcoming events
    const today = new Date().toISOString().split('T')[0]
    const { data: events } = await supabase
      .from('events')
      .select('*, assignments(*, helper:helpers(*))')
      .gte('event_date', today)
      .order('event_date', { ascending: true })
      .limit(5)

    if (!events || events.length === 0) {
      return NextResponse.json({ message: 'No upcoming events' })
    }

    const nextEvent = events[0]
    const eventDate = new Date(nextEvent.event_date)
    const helpers = nextEvent.assignments?.map((a: any) => a.helper?.name).filter(Boolean).join(' & ') || 'Niemand eingetragen'

    let message = ''

    if (isToday(eventDate)) {
      // Today is Jungschar!
      message = `🔔 <b>Heute ist Jungschar!</b>

📅 ${formatDate(nextEvent.event_date)}
👥 Team: ${helpers}

Viel Spaß und Gottes Segen!`
    } else if (isTomorrow(eventDate)) {
      // Tomorrow is Jungschar
      message = `📅 <b>Morgen ist Jungschar!</b>

📅 ${formatDate(nextEvent.event_date)}
👥 Team: ${helpers}

Nicht vergessen vorzubereiten!`
    } else {
      // No reminder needed today
      return NextResponse.json({
        message: 'No reminder needed today',
        nextEvent: nextEvent.event_date
      })
    }

    // Send the reminder
    const result = await sendTelegramMessage(TELEGRAM_CHAT_ID, message)

    return NextResponse.json({
      success: true,
      message: 'Reminder sent',
      telegramResult: result
    })

  } catch (error) {
    console.error('Error in reminder cron:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
