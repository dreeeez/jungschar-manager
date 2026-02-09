import { formatDate, getDaysUntil, getDayOfWeek } from '@/utils/format'
import { getUpcomingEvents, getHelperNames, getHelperMentions } from './events'
import { getParentDutyName } from './parents'
import { getAttendingHelperNames } from './attendance'
import { getSupabase } from './database'

interface ReminderMessage {
  message: string
  replyMarkup?: any
}

// Reminder-Typen für Duplikat-Schutz
const STAGE_SUNDAY = 'stage1_sunday'
const STAGE_WEDNESDAY = 'stage2_wednesday'
const STAGE_FRIDAY = 'stage3_friday'

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
 * Prüft ob eine Erinnerung bereits gesendet wurde
 */
async function wasReminderSent(eventId: string, reminderType: string): Promise<boolean> {
  const { data } = await getSupabase()
    .from('reminder_log')
    .select('id')
    .eq('event_id', eventId)
    .eq('reminder_type', reminderType)
    .limit(1)
  return (data?.length ?? 0) > 0
}

/**
 * Loggt eine gesendete Erinnerung
 */
async function logReminder(eventId: string, reminderType: string): Promise<void> {
  await getSupabase()
    .from('reminder_log')
    .insert({ event_id: eventId, reminder_type: reminderType } as any)
}

/**
 * STUFE 1 — Sonntag (6-8 Tage vorher)
 * Event-Ankündigung mit Team und Elterndienst
 */
function generateStage1Message(event: any): ReminderMessage {
  const helperNames = getHelperNames(event)
  const mentions = getHelperMentions(event)
  const parentName = getParentDutyName(event)

  return {
    message: `📅 <b>Nächste Woche ist Jungschar!</b>\n\n` +
      `📆 ${formatDate(event.event_date)}\n` +
      `👥 Team: ${helperNames}\n` +
      `${mentions ? `${mentions} - ihr seid dran!\n` : ''}` +
      `🍽️ Essen: ${parentName}\n\n` +
      `Fangt an zu planen!`,
  }
}

/**
 * STUFE 2 — Mittwoch (3-4 Tage vorher)
 * Status-Check mit Checkliste, Poll und Idee-Button
 */
function generateStage2Message(
  event: any,
  daysUntil: number,
  attendingNames: string[]
): ReminderMessage {
  const helperNames = getHelperNames(event)
  const mentions = getHelperMentions(event)

  const attendingLine = attendingNames.length > 0
    ? `\n\n👋 Sind auch dabei: ${attendingNames.join(', ')}`
    : ''

  return {
    message: `🤔 <b>Wie ist der Status?</b>\n\n` +
      `Noch <b>${daysUntil} Tage</b> bis zur Jungschar!\n` +
      `📆 ${formatDate(event.event_date)}\n` +
      `👥 Team: ${helperNames}\n` +
      `${mentions ? `${mentions}\n` : ''}` +
      `\n📋 <b>Checkliste:</b>\n` +
      `⚠️ Eltern wegen Essen kontaktiert? — <b>Frist HEUTE!</b>\n` +
      `• Steht das Programm?\n` +
      `• Material vorbereitet?\n` +
      `• Kinderstunde vorbereitet?\n` +
      `• Programm in Elternchat kommuniziert?` +
      attendingLine,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: '✅ Bin dabei!', callback_data: `join_${event.id}` },
          { text: '❌ Kann nicht', callback_data: `skip_${event.id}` },
        ],
        [
          { text: '💡 Wir brauchen eine Idee!', callback_data: `idea_${event.id}` },
        ],
      ],
    },
  }
}

/**
 * STUFE 3 — Freitag (1-2 Tage vorher)
 * Final Reminder, kurz und ermutigend
 */
function generateStage3Message(event: any, daysUntil: number): ReminderMessage {
  const helperNames = getHelperNames(event)
  const mentions = getHelperMentions(event)
  const dayWord = daysUntil === 1 ? 'morgen' : 'übermorgen'

  return {
    message: `🔔 <b>Jungschar ist ${dayWord}!</b>\n\n` +
      `📆 ${formatDate(event.event_date)}\n` +
      `👥 Team: ${helperNames}\n` +
      `${mentions ? `${mentions}\n` : ''}\n` +
      `Ihr schafft das! Viel Spaß und Gottes Segen! 🙏`,
  }
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
    let reminder: ReminderMessage | null = null
    let reminderType: string | null = null

    // Stufe 1: Sonntag, 6-8 Tage vorher
    if (dayOfWeek === 0 && daysUntil >= 6 && daysUntil <= 8) {
      reminderType = STAGE_SUNDAY
      if (!(await wasReminderSent(event.id, reminderType))) {
        reminder = generateStage1Message(event)
      }
    }

    // Stufe 2: Mittwoch, 3-4 Tage vorher
    if (dayOfWeek === 3 && daysUntil >= 3 && daysUntil <= 4) {
      reminderType = STAGE_WEDNESDAY
      if (!(await wasReminderSent(event.id, reminderType))) {
        const attendingNames = await getAttendingHelperNames(event.id)
        reminder = generateStage2Message(event, daysUntil, attendingNames)
      }
    }

    // Stufe 3: Freitag, 1-2 Tage vorher
    if (dayOfWeek === 5 && daysUntil >= 1 && daysUntil <= 2) {
      reminderType = STAGE_FRIDAY
      if (!(await wasReminderSent(event.id, reminderType))) {
        reminder = generateStage3Message(event, daysUntil)
      }
    }

    if (reminder && reminderType) {
      const result = await sendTelegramMessage(chatId, reminder.message, reminder.replyMarkup)
      await logReminder(event.id, reminderType)
      results.push({
        event_id: event.id,
        event_date: event.event_date,
        daysUntil,
        dayOfWeek,
        reminderType,
        result,
      })
    }
  }

  if (results.length === 0) {
    return {
      message: 'No reminders needed today',
      dayOfWeek,
      nextEvents: events.map((e: any) => ({
        date: e.event_date,
        daysUntil: getDaysUntil(new Date(e.event_date)),
      })),
    }
  }

  return {
    success: true,
    message: `${results.length} reminder(s) sent`,
    results,
  }
}
