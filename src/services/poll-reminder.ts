import { formatDate } from '@/utils/format'
import { getSupabase, getTodayISO } from './database'

const STAGE_WEDNESDAY = 'stage2_wednesday'

type TemplateFn = (mentions: string, date: string) => string

// Pool sympathisch-witziger Erinnerungen. Einer wird pro Send zufällig gezogen.
// Jeder Eintrag bekommt {mentions} und {date} als HTML-fertigen String.
const POLL_REMINDER_TEMPLATES: TemplateFn[] = [
  (m, d) => `🕵️ <b>Vermisstenanzeige!</b>\n\n${m}\n\nEure Stimme für <b>${d}</b> wird seit Mittwoch gesucht. Sachdienliche Hinweise bitte oben mit ✅ oder ❌ 🔍`,
  (m, d) => `👻 <b>Profi-Ghosting entdeckt!</b>\n\n${m}\n\nMittwoch war der Vote, ihr seid noch unsichtbar. Ein Klick oben — ✅ oder ❌ für <b>${d}</b> — und ihr seid wieder unter den Lebenden 🙏`,
  (m, d) => `☕ <b>Schon wach?</b>\n\n${m}\n\nFalls ja: kurz oben ✅ oder ❌ klicken für <b>${d}</b> — dann gönnt euch noch eine Tasse 😄`,
  (m, d) => `🥁 <b>Trommelwirbel…</b>\n\n${m}\n\nWir warten noch auf euer ✅ oder ❌ für <b>${d}</b>. Spoiler: jeder Klick lässt einen Engel jubeln 🎺`,
  (m, d) => `🚨 <b>Achtung Vote-Kontrolle!</b>\n\n${m}\n\nEure Stimme für <b>${d}</b> fehlt noch. Bitte oben ✅ oder ❌ — wird strafbefreiend gewertet 😎`,
  (m, d) => `📡 <b>Aussichten für ${d}:</b>\n\nStark bewölkt mit fehlenden Voten von ${m}. Aufklärung erwartet — kurz oben ✅ oder ❌ ☀️`,
  (m, d) => `📬 <b>Hallo, Postbote!</b>\n\nFür ${m} liegt noch ein offener Brief: „Kommst du am <b>${d}</b>?". Bitte oben mit ✅ oder ❌ unterzeichnen ✉️`,
  (m, d) => `🎰 <b>Wer wird Helfer?</b>\n\n${m}\n\nLetzte Frage vor der Show am <b>${d}</b>: ✅ oder ❌? Publikumsjoker leider nicht verfügbar 🎤`,
  (m, d) => `🎬 <b>Cliffhanger!</b>\n\n${m}\n\nDie nächste Folge „Jungschar" läuft am <b>${d}</b>, aber eure Anmeldung steht noch aus. Oben kurz ✅ oder ❌ und Spannung gelöst 🍿`,
  (m, d) => `🧪 <b>Hypothese:</b> ${m} kommen am <b>${d}</b>.\n\nStatus: noch unbestätigt. Bitte experimentell oben mit ✅ oder ❌ verifizieren 📊`,
  (m, d) => `🥷 <b>Tarn-Modus erkannt</b>\n\n${m}\n\nIhr schleicht euch um den Mittwochs-Vote. Lüftet das Versteck mit ✅ oder ❌ für <b>${d}</b> 🗡️`,
  (m, d) => `🔮 <b>Sternenkonstellation:</b>\n\n${m}\n\nDie Sterne sagen: „Stimm jetzt ab für <b>${d}</b>!" — kurz oben ✅ oder ❌ und das Universum atmet auf 🌙`,
  (m, d) => `📊 <b>Statistik der Woche:</b>\n\n${m} — Vote-Quote: 0%. Wir glauben an euch! Kurz oben ✅ oder ❌ für <b>${d}</b> und die Kurve geht steil 📈`,
  (m, d) => `🏴‍☠️ <b>Ahoi!</b>\n\n${m}\n\nDie Crew sticht am <b>${d}</b> in See, aber euer Eintrag fehlt noch im Logbuch. Oben kurz ✅ oder ❌ — sonst Schiffsplanken-Putzdienst 🦜`,
  (m, d) => `🪄 <b>Abrakadabra…</b>\n\n${m}\n\nDie Vote-Wolke will sich nicht auflösen. Die Magie liegt bei euch: ✅ oder ❌ oben für <b>${d}</b> ✨`,
  (m, d) => `💌 <b>Liebes Helferteam,</b>\n\n${m}\n\nwir vermissen euer Vote. Schenkt uns ein ✅ oder ❌ für <b>${d}</b>. In Vorfreude, der Bot 💕`,
  (m, d) => `🧭 <b>Schnitzeljagd-Hinweis #1:</b>\n\n${m}\n\nEuer nächstes Ziel ist der Vote-Button für <b>${d}</b>. ✅ oder ❌ markieren das Schatzkästchen 💎`,
  (m, d) => `🏃 <b>Endspurt!</b>\n\n${m}\n\nNur noch ein Klick zur Ziellinie: ✅ oder ❌ für <b>${d}</b>. Wir feuern euch an! 🥇`,
  (m, d) => `⏰ <b>Sanftes Wecken</b>\n\n${m}\n\nMittwoch ist vorbei und euer Vote für <b>${d}</b> schläft noch. Tippt ihn wach mit ✅ oder ❌ ☀️`,
  (m, d) => `🦸 <b>Mission: Jungschar ${d}</b>\n\n${m}\n\nDie Welt — naja, zumindest die Gemeinde — braucht euch. Mission annehmen mit ✅, ablehnen mit ❌ oben 💪`,
]

function pickReminderTemplate(): TemplateFn {
  return POLL_REMINDER_TEMPLATES[Math.floor(Math.random() * POLL_REMINDER_TEMPLATES.length)]
}

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
  const template = pickReminderTemplate()
  const text = template(mentions, formatDate(wednesday.eventDate))

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
