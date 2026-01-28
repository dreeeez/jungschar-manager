import { formatDate, getDaysUntil, getDayOfWeek } from '@/utils/format'
import { getUpcomingEvents, getHelperNames, getHelperMentions } from './events'

interface ReminderMessage {
  message: string
  replyMarkup?: any
}

/**
 * Sendet eine Nachricht an Telegram
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  replyMarkup?: any
): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN

  const body: any = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  }

  if (replyMarkup) {
    body.reply_markup = JSON.stringify(replyMarkup)
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  return response.json()
}

/**
 * Generiert die Erinnerungsnachricht für ein Event basierend auf dem Wochentag
 */
export function generateReminderMessage(
  event: any,
  daysUntil: number,
  dayOfWeek: number
): ReminderMessage | null {
  const helperNames = getHelperNames(event)
  const mentions = getHelperMentions(event)

  // Sonntag: 1 Woche vorher (6-8 Tage)
  if (dayOfWeek === 0 && daysUntil >= 6 && daysUntil <= 8) {
    return {
      message: `📅 <b>Nächste Woche ist Jungschar!</b>

📆 ${formatDate(event.event_date)}
👥 Team: ${helperNames}
${mentions ? `\n${mentions} - ihr seid dran!` : ''}

Fangt schon mal an zu planen!`
    }
  }

  // Mittwoch: Zwischenerinnerung (3-4 Tage vorher)
  if (dayOfWeek === 3 && daysUntil >= 3 && daysUntil <= 4) {
    return {
      message: `🤔 <b>Habt ihr an alles gedacht?</b>

📆 ${formatDate(event.event_date)} (in ${daysUntil} Tagen)
👥 Team: ${helperNames}

Checkliste:
• Material vorbereitet?
• Programm geplant?
• Snacks organisiert?`,
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '✅ Alles klar!', callback_data: `confirm_${event.id}` },
            { text: '🆘 Brauche Hilfe', callback_data: `help_${event.id}` }
          ]
        ]
      }
    }
  }

  // Freitag: Final Check (1-2 Tage vorher)
  if (dayOfWeek === 5 && daysUntil >= 1 && daysUntil <= 2) {
    return {
      message: `🔔 <b>Final Check!</b>

📆 ${formatDate(event.event_date)} (${daysUntil === 1 ? 'morgen' : 'übermorgen'})
👥 Team: ${helperNames}
${mentions ? `\n${mentions}` : ''}

Seid ihr ready?`,
      replyMarkup: {
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
  }

  // Tag des Events
  if (daysUntil === 0) {
    return {
      message: `🎉 <b>Heute ist Jungschar!</b>

📆 ${formatDate(event.event_date)}
👥 Team: ${helperNames}
${mentions ? `\n${mentions}` : ''}

Viel Spaß und Gottes Segen!`
    }
  }

  return null
}

/**
 * Prüft alle Events und sendet fällige Erinnerungen
 */
export async function processReminders(chatId: string) {
  const dayOfWeek = getDayOfWeek()
  const events = await getUpcomingEvents(5)

  if (!events || events.length === 0) {
    return { message: 'No upcoming events', reminders: [] }
  }

  const results: any[] = []

  for (const event of events) {
    const eventDate = new Date(event.event_date)
    const daysUntil = getDaysUntil(eventDate)

    const reminder = generateReminderMessage(event, daysUntil, dayOfWeek)

    if (reminder) {
      const result = await sendTelegramMessage(chatId, reminder.message, reminder.replyMarkup)
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
    return {
      message: 'No reminders needed today',
      dayOfWeek,
      nextEvents: events.map((e: any) => ({
        date: e.event_date,
        daysUntil: getDaysUntil(new Date(e.event_date))
      }))
    }
  }

  return {
    success: true,
    message: `${results.length} reminder(s) sent`,
    results
  }
}
