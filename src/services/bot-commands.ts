import { Bot, Context } from 'grammy'
import { formatDate } from '@/utils/format'
import { getHelperByTelegramId, registerHelper, getHelperAssignments } from './helpers'
import { getNextEvent, getUpcomingEvents, getEventById, getHelperNames } from './events'
import { recordVote } from './attendance'
import { handleReviewCallback, handleReviewText } from './review-ping'
import { ADMIN_TELEGRAM_USER_IDS, APP_URL, isAdmin } from './admins'
import { sendTelegramMessage } from './reminders'
import {
  IDEA_PROMPT,
  checkRegisterCode,
  claimFood,
  essenKeyboard,
  findParentByTelegram,
  freeFoodEvents,
  saveParentIdea,
} from './parents-bot'

/**
 * Bot-Befehle.
 *
 * Rollen: Admin (Zugangsliste), Helfer (helpers-Tabelle), Elternteil
 * (parents-Tabelle, per Telegram-ID oder Benutzername). Jeder Befehl prüft
 * seine Rolle; /help zeigt nur, was die Person nutzen darf.
 *
 * /register verlangt den Registrierungs-Code aus den Einstellungen, damit
 * sich Eltern nicht versehentlich als Helfer eintragen.
 */

// Wartet auf den Namen nach erfolgreichem /register (in-memory, Cold-Start setzt zurück)
const pendingRegistrations = new Set<number>()
// Wartet auf den Freitext nach /idee — Fallback, falls jemand nicht "antwortet"
const pendingIdeas = new Set<number>()

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Reconstructs HTML from plain text + Telegram message entities
 */
function rebuildHtml(text: string, entities: any[]): string {
  if (!entities?.length) return escapeHtml(text)

  const sorted = [...entities].sort((a: any, b: any) => a.offset - b.offset)
  let result = ''
  let pos = 0

  for (const ent of sorted) {
    result += escapeHtml(text.slice(pos, ent.offset))
    const content = escapeHtml(text.slice(ent.offset, ent.offset + ent.length))

    switch (ent.type) {
      case 'bold':
        result += `<b>${content}</b>`
        break
      case 'italic':
        result += `<i>${content}</i>`
        break
      default:
        result += content
        break
    }

    pos = ent.offset + ent.length
  }

  result += escapeHtml(text.slice(pos))
  return result
}

type Role = { helper: any | null; parent: Awaited<ReturnType<typeof findParentByTelegram>>; admin: boolean }

async function roleOf(ctx: Context): Promise<Role> {
  const id = ctx.from?.id
  if (!id) return { helper: null, parent: null, admin: false }
  const [helper, parent] = await Promise.all([
    getHelperByTelegramId(id),
    findParentByTelegram(id, ctx.from?.username),
  ])
  return { helper, parent, admin: isAdmin(id) }
}

const NOT_HELPER = 'Dieser Befehl ist nur für Helfer. Eltern nutzen /idee, /essen und /termine.'
const UNKNOWN =
  'Ich kenne dich noch nicht.\n\n' +
  'Helfer: /register CODE (den Code bekommst du von Marco oder Jens).\n' +
  'Eltern: sag Marco oder Jens Bescheid, dann werdet ihr eingetragen.'

function helpFor(role: Role): string {
  const lines: string[] = []
  if (role.helper) {
    lines.push('<b>Helfer</b>', '/next – nächste Termine mit Team', '/status – nächste Jungschar', '/mystatus – meine Einsätze')
  }
  if (role.parent || role.helper) {
    lines.push('', '<b>Eltern</b>', '/termine – nächste Jungschar-Termine', '/idee – Programm-Idee vorschlagen', '/essen – Essen für einen Termin übernehmen')
  }
  if (role.admin) {
    lines.push('', '<b>Admin</b>', '/chatid – Chat-ID anzeigen', `Mini-App: ${APP_URL}`)
  }
  if (!role.helper && !role.parent) {
    lines.push('/register CODE – als Helfer registrieren')
  }
  lines.push('', '/help – diese Übersicht')
  return lines.join('\n').trim()
}

/**
 * Richtet alle Bot Commands ein
 */
export function setupBotCommands(bot: Bot) {
  // /start – Begrüßung je Rolle. Admins bekommen den Menü-Button "Admin".
  bot.command('start', async (ctx) => {
    const role = await roleOf(ctx)

    if (ctx.chat.type === 'private' && role.admin) {
      await ctx.api
        .setChatMenuButton({
          chat_id: ctx.chat.id,
          menu_button: { type: 'web_app', text: 'Admin', web_app: { url: APP_URL } },
        })
        .catch((e) => console.error('setChatMenuButton failed:', e))
    }

    let intro: string
    if (role.helper) {
      intro = `Hallo ${escapeHtml(role.helper.name)}! Ich erinnere euch an eure Einsätze und halte die Einteilung aktuell.`
    } else if (role.parent) {
      intro =
        `Hallo ${escapeHtml(role.parent.name)}! Schön, dass du da bist.\n\n` +
        'Mit /idee kannst du uns eine Programm-Idee schicken, mit /essen das Essen für eine Jungschar übernehmen.'
    } else {
      intro = 'Willkommen beim Jungschar-Bot!\n\n' + UNKNOWN
    }
    await ctx.reply(`${intro}\n\n${helpFor(role)}`, { parse_mode: 'HTML' })
  })

  // /register CODE – nur privat, nur mit gültigem Code
  bot.command('register', async (ctx) => {
    const telegramUserId = ctx.from?.id
    if (!telegramUserId) return
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Bitte schreib mir dafür privat.')
      return
    }

    const existingHelper = await getHelperByTelegramId(telegramUserId)
    if (existingHelper) {
      await ctx.reply(`Du bist bereits als "${existingHelper.name}" registriert.`)
      return
    }

    const check = await checkRegisterCode(ctx.match)
    if (check === 'closed') {
      await ctx.reply('Die Registrierung ist gerade geschlossen. Sag Marco oder Jens Bescheid.')
      return
    }
    if (check === 'wrong') {
      await ctx.reply('Dafür brauchst du den Registrierungs-Code: /register CODE\nDen Code bekommst du von Marco oder Jens.')
      return
    }

    await ctx.reply('Wie heißt du? Bitte antworte mit deinem Namen, so wie er in der Helfer-Liste stehen soll.')
    pendingRegistrations.add(telegramUserId)
  })

  // /next – Nächste Termine mit Team (Helfer)
  bot.command('next', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper) {
      await ctx.reply(NOT_HELPER)
      return
    }
    const events = await getUpcomingEvents(5)
    if (events.length === 0) {
      await ctx.reply('Keine anstehenden Termine gefunden.')
      return
    }
    const lines = events.map((event: any) => `📅 ${formatDate(event.event_date)}: ${getHelperNames(event)}`)
    await ctx.reply(`Nächste Jungschar-Termine:\n\n${lines.join('\n')}`)
  })

  // /termine – Nächste Termine ohne Team (Eltern und Helfer)
  bot.command('termine', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper && !role.parent) {
      await ctx.reply(UNKNOWN)
      return
    }
    const events = await getUpcomingEvents(6)
    if (events.length === 0) {
      await ctx.reply('Keine anstehenden Termine gefunden.')
      return
    }
    const lines = events.map((event: any) => `📅 ${formatDate(event.event_date)}`)
    await ctx.reply(`Nächste Jungschar-Termine:\n\n${lines.join('\n')}`)
  })

  // /status – Nächste Jungschar mit Team (Helfer)
  bot.command('status', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper) {
      await ctx.reply(NOT_HELPER)
      return
    }
    const event = await getNextEvent()
    if (!event) {
      await ctx.reply('Keine anstehende Jungschar gefunden.')
      return
    }
    await ctx.reply(`📅 Nächste Jungschar: ${formatDate(event.event_date)}\n\n👥 Team: ${getHelperNames(event)}`)
  })

  // /mystatus – Meine Einsätze (Helfer)
  bot.command('mystatus', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper) {
      await ctx.reply(NOT_HELPER)
      return
    }
    const assignments = await getHelperAssignments(role.helper.id)
    if (assignments.length === 0) {
      await ctx.reply(`Hallo ${role.helper.name}! Du hast aktuell keine Einsätze geplant.`)
      return
    }
    const lines = assignments.filter((a: any) => a.event).map((a: any) => `📅 ${formatDate(a.event.event_date)}`)
    await ctx.reply(`👋 Hallo ${role.helper.name}!\n\nDeine nächsten Einsätze:\n${lines.join('\n')}`)
  })

  // /idee – Programm-Idee (Eltern und Helfer, privat)
  bot.command('idee', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.helper && !role.parent) {
      await ctx.reply(UNKNOWN)
      return
    }
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Schreib mir deine Idee gern privat, dann bleibt sie zwischen uns.')
      return
    }
    if (ctx.from) pendingIdeas.add(ctx.from.id)
    await ctx.reply(IDEA_PROMPT, {
      reply_markup: { force_reply: true, input_field_placeholder: 'Deine Idee' },
    })
  })

  // /essen – Elterndienst übernehmen (Eltern, privat)
  bot.command('essen', async (ctx) => {
    const role = await roleOf(ctx)
    if (!role.parent) {
      await ctx.reply(role.helper ? 'Das Essen tragen die Eltern ein. Als Helfer machst du das in der Mini-App.' : UNKNOWN)
      return
    }
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Schreib mir dafür privat, dann zeige ich dir die freien Termine.')
      return
    }
    const events = await freeFoodEvents()
    if (events.length === 0) {
      await ctx.reply('Alle kommenden Termine haben schon jemanden fürs Essen. Danke!')
      return
    }
    await ctx.reply('Für welchen Termin möchtet ihr das Essen übernehmen?', {
      reply_markup: essenKeyboard(events),
    })
  })

  // /chatid – nur Admins
  bot.command('chatid', async (ctx) => {
    if (!isAdmin(ctx.from?.id ?? 0)) return
    await ctx.reply(`Chat-ID: <code>${ctx.chat.id}</code>`, { parse_mode: 'HTML' })
  })

  // /help – je Rolle
  bot.command('help', async (ctx) => {
    const role = await roleOf(ctx)
    await ctx.reply(helpFor(role), { parse_mode: 'HTML' })
  })

  // Textnachrichten: Idee-Antwort, Bewertungs-Freitext, Registrierungs-Name
  bot.on('message:text', async (ctx) => {
    const telegramUserId = ctx.from?.id
    const text = ctx.message.text
    const chatId = String(ctx.chat?.id)
    const elternChatId = process.env.TELEGRAM_ELTERN_CHAT_ID

    // In der Elterngruppe hört der Bot nicht mit.
    if (elternChatId && chatId === elternChatId) return
    if (text.startsWith('/')) return
    if (!telegramUserId || ctx.chat?.type !== 'private') return

    // Antwort auf /idee (per "Antworten" oder direkt danach)
    const repliedTo = ctx.message.reply_to_message?.text
    if (repliedTo === IDEA_PROMPT || pendingIdeas.has(telegramUserId)) {
      pendingIdeas.delete(telegramUserId)
      const role = await roleOf(ctx)
      const name = role.parent?.name ?? role.helper?.name ?? ctx.from?.first_name ?? 'Unbekannt'
      try {
        await saveParentIdea(text, { name, telegramUserId })
        await ctx.reply('Danke, deine Idee ist notiert! Wir schauen sie uns an.')
      } catch (e) {
        console.error('saveParentIdea failed:', e)
        await ctx.reply('Speichern hat nicht geklappt. Magst du es später noch einmal versuchen?')
      }
      return
    }

    // Offene Abend-Bewertung? Dann ist der Text der Freitext.
    const handled = await handleReviewText(
      telegramUserId,
      text,
      (html) => ctx.reply(html, { parse_mode: 'HTML' }),
      ctx.from?.first_name || ctx.from?.username || 'Jemand',
    )
    if (handled) return

    if (pendingRegistrations.has(telegramUserId)) {
      pendingRegistrations.delete(telegramUserId)
      try {
        const helper = await registerHelper(text.trim(), telegramUserId, ctx.from?.username)
        await ctx.reply(`✅ Super! Du bist jetzt als "${helper.name}" registriert!`)
      } catch (error) {
        await ctx.reply('Fehler bei der Registrierung. Bitte versuche es erneut mit /register CODE')
      }
    }
  })

  // Callback Queries (Inline Buttons)
  bot.on('callback_query:data', async (ctx) => {
    const callbackData = ctx.callbackQuery.data
    const user = ctx.from
    const telegramUserId = user.id
    const userName = user.first_name || user.username || 'Jemand'

    try {
      const [action, eventId, value] = callbackData.split('_')

      // Abend-Bewertung (Sterne / Drinnen-Draußen)
      if (action === 'rvs' || action === 'rvp') {
        const toast = await handleReviewCallback(action, eventId, value ?? '', telegramUserId)
        await ctx.answerCallbackQuery({ text: toast })
        return
      }

      // /essen – Elterndienst übernehmen
      if (action === 'essen') {
        const parent = await findParentByTelegram(telegramUserId, user.username)
        if (!parent) {
          await ctx.answerCallbackQuery({ text: 'Ich kenne dich noch nicht.' })
          return
        }
        const result = await claimFood(eventId, parent)
        await ctx.answerCallbackQuery({ text: result.ok ? 'Eingetragen!' : 'Nicht möglich' })
        try {
          await ctx.editMessageText(result.text)
        } catch {}
        // Nur die Admins erfahren es per DM; in der Mini-App steht es im Kalender.
        if (result.ok && result.eventDate) {
          const note = `🍽️ <b>${escapeHtml(parent.name)}</b> übernimmt das Essen am ${formatDate(result.eventDate)}.`
          for (const adminId of ADMIN_TELEGRAM_USER_IDS) {
            sendTelegramMessage(String(adminId), note).catch((e) => console.error('admin food notice failed:', e))
          }
        }
        return
      }

      const event = await getEventById(eventId)
      const eventInfo = event ? formatDate(event.event_date) : 'dem Termin'

      switch (action) {
        case 'votey':
        case 'voten': {
          const isYes = action === 'votey'
          const msg = ctx.callbackQuery.message
          const text = msg?.text || ''
          const entities = (msg as any)?.entities || []

          // Persist vote in DB so the Thursday non-voter cron can find non-responders.
          // Failures here must not break the in-message rendering below.
          try {
            const helper = await getHelperByTelegramId(telegramUserId)
            if (helper && eventId) {
              await recordVote(eventId, helper.id, isYes)
            }
          } catch (e) {
            console.error('Failed to persist vote:', e)
          }

          // Parse current votes from plain text
          const dabeiMatch = text.match(/✅ Dabei(?:\s*\(\d+\))?: (.+)/)
          const absagenMatch = text.match(/❌ Absagen(?:\s*\(\d+\))?: (.+)/)

          let dabei = !dabeiMatch?.[1] || dabeiMatch[1] === '—' ? [] : dabeiMatch[1].split(', ')
          let absagen = !absagenMatch?.[1] || absagenMatch[1] === '—' ? [] : absagenMatch[1].split(', ')

          // Remove user from both lists (handles vote change)
          dabei = dabei.filter(n => n !== userName)
          absagen = absagen.filter(n => n !== userName)

          if (isYes) {
            dabei.push(userName)
          } else {
            absagen.push(userName)
          }

          // Build new vote lines (HTML-escaped)
          const esc = (s: string) => escapeHtml(s)
          const dabeiLine = dabei.length > 0
            ? `✅ Dabei (${dabei.length}): ${dabei.map(esc).join(', ')}`
            : '✅ Dabei: —'
          const absagenLine = absagen.length > 0
            ? `❌ Absagen (${absagen.length}): ${absagen.map(esc).join(', ')}`
            : '❌ Absagen: —'

          // Rebuild HTML and replace vote lines
          const html = rebuildHtml(text, entities)
            .replace(/✅ Dabei(?:\s*\(\d+\))?: .+/, dabeiLine)
            .replace(/❌ Absagen(?:\s*\(\d+\))?: .+/, absagenLine)

          try {
            await ctx.editMessageText(html, {
              parse_mode: 'HTML',
              reply_markup: (msg as any)?.reply_markup,
            })
          } catch {
            // Message not modified (same content) — ignore
          }

          // Big-Mode Reaction: Konfetti bei Zusage, traurig bei Absage.
          // Failures hier dürfen die Vote-Logik nicht abreißen.
          if (msg) {
            const token = process.env.TELEGRAM_BOT_TOKEN
            fetch(`https://api.telegram.org/bot${token}/setMessageReaction`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: msg.chat.id,
                message_id: msg.message_id,
                reaction: [{ type: 'emoji', emoji: isYes ? '🎉' : '😢' }],
                is_big: true,
              }),
            }).catch((e) => console.error('Failed to set reaction:', e))
          }

          await ctx.answerCallbackQuery({
            text: isYes ? '✅ Du bist dabei!' : '❌ Notiert!',
          })
          break
        }

        // Alte Idee-Buttons in archivierten Stage-2-Nachrichten:
        // Klick stumm absorbieren (kein Toast), damit der Spinner verschwindet.
        case 'idea':
          await ctx.answerCallbackQuery()
          break

        // Legacy-Callbacks für alte Nachrichten
        case 'confirm':
        case 'ready':
          await ctx.answerCallbackQuery({ text: `${userName} hat bestätigt!` })
          await ctx.reply(`✅ ${userName} hat bestätigt für ${eventInfo}!`)
          break
        case 'cancel':
          await ctx.answerCallbackQuery({ text: 'Notiert!' })
          await ctx.reply(
            `⚠️ <b>Vertretung gesucht!</b>\n\n${userName} kann am ${eventInfo} nicht.\nKann jemand einspringen?`,
            { parse_mode: 'HTML' }
          )
          break
        case 'help':
          await ctx.answerCallbackQuery({ text: 'Notiert!' })
          await ctx.reply(
            `🆘 <b>Hilfe benötigt!</b>\n\n${userName} braucht Unterstützung für ${eventInfo}.\nWer kann helfen?`,
            { parse_mode: 'HTML' }
          )
          break

        default:
          await ctx.answerCallbackQuery({ text: `Unbekannte Aktion: ${action}` })
      }
    } catch (error) {
      console.error('Error handling callback:', error)
      await ctx.answerCallbackQuery({ text: 'Fehler bei der Verarbeitung' })
    }
  })
}
