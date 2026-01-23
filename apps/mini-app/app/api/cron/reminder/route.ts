import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

// Get days until event
function getDaysUntil(eventDate: Date): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const event = new Date(eventDate)
  event.setHours(0, 0, 0, 0)
  const diffTime = event.getTime() - today.getTime()
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
}

// Get day of week (0 = Sunday, 1 = Monday, etc.)
function getDayOfWeek(): number {
  return new Date().getDay()
}

export async function GET(req: NextRequest) {
  // Get env vars at runtime
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

  // Verify cron secret to prevent unauthorized access
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!TELEGRAM_CHAT_ID || !TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: 'Telegram config missing' }, { status: 500 })
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: 'Supabase config missing' }, { status: 500 })
  }

  // Initialize at runtime
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  async function sendTelegramMessage(chatId: string, text: string, replyMarkup?: any) {
    const body: any = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }
    if (replyMarkup) {
      body.reply_markup = JSON.stringify(replyMarkup)
    }
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return response.json()
  }

  try {
    const dayOfWeek = getDayOfWeek()
    const today = new Date().toISOString().split('T')[0]

    // Get upcoming events with assignments
    const { data: events } = await supabase
      .from('events')
      .select('*, assignments(*, helper:helpers(*))')
      .gte('event_date', today)
      .order('event_date', { ascending: true })
      .limit(5)

    if (!events || events.length === 0) {
      return NextResponse.json({ message: 'No upcoming events' })
    }

    const results: any[] = []

    for (const event of events) {
      const eventDate = new Date(event.event_date)
      const daysUntil = getDaysUntil(eventDate)

      // Get helper info with usernames for @mentions
      const helpers = event.assignments?.map((a: any) => a.helper).filter(Boolean) || []
      const helperNames = helpers.map((h: any) => h.name).join(' & ') || 'Niemand eingetragen'

      // Create @mentions for helpers with telegram usernames
      const mentions = helpers
        .filter((h: any) => h.telegram_username)
        .map((h: any) => `@${h.telegram_username}`)
        .join(' ')

      let message = ''
      let shouldSend = false
      let replyMarkup = null

      // Sunday: 1 week reminder (6-8 days before, on Sunday)
      if (dayOfWeek === 0 && daysUntil >= 6 && daysUntil <= 8) {
        shouldSend = true
        message = `📅 <b>Nächste Woche ist Jungschar!</b>

📆 ${formatDate(event.event_date)}
👥 Team: ${helperNames}
${mentions ? `\n${mentions} - ihr seid dran!` : ''}

Fangt schon mal an zu planen!`
      }

      // Wednesday: Mid-week reminder (3-4 days before, on Wednesday)
      else if (dayOfWeek === 3 && daysUntil >= 3 && daysUntil <= 4) {
        shouldSend = true
        message = `🤔 <b>Habt ihr an alles gedacht?</b>

📆 ${formatDate(event.event_date)} (in ${daysUntil} Tagen)
👥 Team: ${helperNames}

Checkliste:
• Material vorbereitet?
• Programm geplant?
• Snacks organisiert?`

        replyMarkup = {
          inline_keyboard: [
            [
              { text: '✅ Alles klar!', callback_data: `confirm_${event.id}` },
              { text: '🆘 Brauche Hilfe', callback_data: `help_${event.id}` }
            ]
          ]
        }
      }

      // Friday: Final check (1-2 days before, on Friday)
      else if (dayOfWeek === 5 && daysUntil >= 1 && daysUntil <= 2) {
        shouldSend = true
        message = `🔔 <b>Final Check!</b>

📆 ${formatDate(event.event_date)} (${daysUntil === 1 ? 'morgen' : 'übermorgen'})
👥 Team: ${helperNames}
${mentions ? `\n${mentions}` : ''}

Seid ihr ready?`

        replyMarkup = {
          inline_keyboard: [
            [
              { text: '✅ Bin dabei!', callback_data: `ready_${event.id}` },
              { text: '❌ Kann nicht', callback_data: `cancel_${event.id}` }
            ],
            [
              { text: '🆘 Brauche Hilfe/Vertretung', callback_data: `help_${event.id}` }
            ]
          ]
        }
      }

      // Day of event
      else if (daysUntil === 0) {
        shouldSend = true
        message = `🎉 <b>Heute ist Jungschar!</b>

📆 ${formatDate(event.event_date)}
👥 Team: ${helperNames}
${mentions ? `\n${mentions}` : ''}

Viel Spaß und Gottes Segen!`
      }

      if (shouldSend) {
        const result = await sendTelegramMessage(TELEGRAM_CHAT_ID, message, replyMarkup)
        results.push({
          event_id: event.id,
          event_date: event.event_date,
          daysUntil,
          dayOfWeek,
          result
        })
      }
    }

    if (results.length === 0) {
      return NextResponse.json({
        message: 'No reminders needed today',
        dayOfWeek,
        nextEvents: events.map((e: any) => ({
          date: e.event_date,
          daysUntil: getDaysUntil(new Date(e.event_date))
        }))
      })
    }

    return NextResponse.json({
      success: true,
      message: `${results.length} reminder(s) sent`,
      results
    })

  } catch (error) {
    console.error('Error in reminder cron:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
