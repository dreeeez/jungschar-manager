import { formatDate } from '@/utils/format'
import { getSupabase, getTodayISO } from './database'

const STAGE_WEDNESDAY = 'stage2_wednesday'

/**
 * Findet den letzten Mittwochs-Reminder-Log-Eintrag für ein noch
 * bevorstehendes Event. Wir brauchen die message_id, um Donnerstag
 * darauf antworten zu können, und das Event, um Nicht-Voter zu finden.
 */
async function getLatestWednesdayReminder() {
  const { data } = await getSupabase()
    .from('reminder_log')
    .select('event_id, message_id, sent_at, event:events(id, event_date)')
    .eq('reminder_type', STAGE_WEDNESDAY)
    .gte('events.event_date', getTodayISO())
    .order('sent_at', { ascending: false })
    .limit(1)

  const row = data?.[0] as any
  if (!row || !row.event) return null
  return {
    eventId: row.event_id as string,
    messageId: row.message_id as number | null,
    eventDate: row.event.event_date as string,
  }
}

/**
 * Gibt alle registrierten Helfer zurück (mit Telegram-Verknüpfung),
 * die für das Event noch nicht abgestimmt haben.
 */
async function getNonVoters(eventId: string) {
  const db = getSupabase()

  const [helpersRes, votesRes] = await Promise.all([
    db
      .from('helpers')
      .select('id, name, telegram_user_id, telegram_username')
      .not('telegram_user_id', 'is', null),
    db
      .from('attendance_votes')
      .select('helper_id')
      .eq('event_id', eventId),
  ])

  const votedIds = new Set((votesRes.data ?? []).map((v: any) => v.helper_id))
  return (helpersRes.data ?? []).filter((h: any) => !votedIds.has(h.id))
}

/**
 * Baut die @-Mention für einen Helfer. Bevorzugt @username, weil das
 * eine echte Push-Benachrichtigung auslöst. Fällt auf HTML-Mention
 * mit telegram_user_id zurück, wenn kein Username gesetzt ist.
 */
function mentionFor(helper: any): string {
  if (helper.telegram_username) return `@${helper.telegram_username}`
  if (helper.telegram_user_id) {
    return `<a href="tg://user?id=${helper.telegram_user_id}">${escapeHtml(helper.name)}</a>`
  }
  return escapeHtml(helper.name)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Sendet die Donnerstags-Erinnerung an alle Helfer, die noch
 * nicht im Mittwochs-Poll abgestimmt haben.
 */
export async function processPollReminder(chatId: string, isTest = false) {
  const wednesday = await getLatestWednesdayReminder()
  if (!wednesday) {
    return { message: 'Kein offener Mittwochs-Reminder gefunden.' }
  }

  const nonVoters = await getNonVoters(wednesday.eventId)
  if (nonVoters.length === 0) {
    return {
      message: 'Alle haben abgestimmt — keine Erinnerung nötig.',
      eventId: wednesday.eventId,
    }
  }

  const mentions = nonVoters.map(mentionFor).join(' ')
  const text =
    `👋 <b>Kurze Erinnerung!</b>\n\n` +
    `${mentions}\n\n` +
    `Du hast noch nicht abgestimmt, ob du am ` +
    `<b>${formatDate(wednesday.eventDate)}</b> bei der Jungschar dabei bist.\n` +
    `Bitte klick oben kurz auf ✅ oder ❌ — danke! 🙏`

  const token = process.env.TELEGRAM_BOT_TOKEN
  const body: any = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  }
  if (wednesday.messageId) {
    body.reply_to_message_id = wednesday.messageId
    // Falls die Original-Nachricht gelöscht wurde, trotzdem senden:
    body.allow_sending_without_reply = true
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json()

  return {
    success: true,
    message: `Erinnerung an ${nonVoters.length} Helfer gesendet${isTest ? ' (TEST)' : ''}`,
    eventId: wednesday.eventId,
    nonVoters: nonVoters.map((h: any) => h.name),
    replyToMessageId: wednesday.messageId,
    result,
  }
}
