import { Bot } from 'grammy'
import { formatDate } from '@/utils/format'
import { getHelperByTelegramId, registerHelper, getHelperAssignments } from './helpers'
import { getNextEvent, getUpcomingEvents, getEventById, getHelperNames } from './events'
import { getSupabase } from './database'
import { generateIdeaForEvent, sendIdeaToUser } from './ai-ideas'
import { recordVote } from './attendance'

// Track pending registrations (in-memory, resets on cold start)
const pendingRegistrations = new Set<number>()

/**
 * Escapes HTML special characters
 */
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

// Aktivitäts-Ideen für /idee Command
const ACTIVITY_IDEAS = [
  '🎨 **Kreativ-Werkstatt**: Malt gemeinsam ein großes Bild zum Thema "Gottes Schöpfung"',
  '🏃 **Schnitzeljagd**: Versteckt Hinweise im Gemeindehaus mit Bibelversen',
  '🎭 **Theaterspiel**: Spielt eine Geschichte aus der Bibel nach (z.B. David & Goliath)',
  '🧩 **Escape Room**: Löst Rätsel um eine "Schatztruhe" zu öffnen',
  '🍪 **Back-Aktion**: Backt gemeinsam Kekse für Senioren in der Gemeinde',
  '🎵 **Musik-Session**: Lernt ein neues Lied mit Bewegungen',
  '⚽ **Sport-Olympiade**: Verschiedene Stationen mit kleinen Wettkämpfen',
  '🔬 **Experimente**: Einfache Experimente die Gottes Wunder zeigen',
  '📖 **Bibelquiz**: Teams treten gegeneinander an',
  '🌳 **Natur-Rallye**: Erkundet die Natur und sammelt Schätze',
  '🎲 **Spieleabend**: Brettspiele und Gemeinschaft',
  '✉️ **Briefaktion**: Schreibt ermutigende Briefe an Gemeindemitglieder',
]

/**
 * Richtet alle Bot Commands ein
 */
export function setupBotCommands(bot: Bot) {
  // /start
  bot.command('start', async (ctx) => {
    await ctx.reply(`
Willkommen beim Jungschar Bot!

Ich helfe eurer Helfer-Gruppe bei der Organisation:
- Wöchentliche Erinnerungen wer dran ist
- Nächste Termine anzeigen
- Vertretungsanfragen

Registriere dich mit /register um loszulegen!
    `.trim())
  })

  // /register
  bot.command('register', async (ctx) => {
    const telegramUserId = ctx.from?.id
    if (!telegramUserId) {
      await ctx.reply('Fehler: Konnte deine Telegram-ID nicht ermitteln.')
      return
    }

    const existingHelper = await getHelperByTelegramId(telegramUserId)
    if (existingHelper) {
      await ctx.reply(`Du bist bereits als "${existingHelper.name}" registriert!`)
      return
    }

    await ctx.reply(
      'Wie heißt du? Bitte antworte mit deinem Namen.\n\n' +
      '(Tipp: Dein Name sollte so sein wie er in der Helfer-Liste steht)'
    )
    pendingRegistrations.add(telegramUserId)
  })

  // /next - Nächste Termine
  bot.command('next', async (ctx) => {
    const events = await getUpcomingEvents(5)

    if (events.length === 0) {
      await ctx.reply('Keine anstehenden Termine gefunden.')
      return
    }

    const lines = events.map((event: any) => {
      const helpers = getHelperNames(event)
      return `📅 ${formatDate(event.event_date)}: ${helpers}`
    })

    await ctx.reply(`Nächste Jungschar-Termine:\n\n${lines.join('\n')}`)
  })

  // /status - Status für nächstes Event
  bot.command('status', async (ctx) => {
    const event = await getNextEvent()

    if (!event) {
      await ctx.reply('Keine anstehende Jungschar gefunden.')
      return
    }

    await ctx.reply(`
📅 Nächste Jungschar: ${formatDate(event.event_date)}

👥 Team: ${getHelperNames(event)}
    `.trim())
  })

  // /idee - Aktivitäts-Idee
  bot.command('idee', async (ctx) => {
    const randomIdea = ACTIVITY_IDEAS[Math.floor(Math.random() * ACTIVITY_IDEAS.length)]
    await ctx.reply(
      `💡 **Idee für heute:**\n\n${randomIdea}\n\n_Nochmal /idee für eine neue Idee!_`,
      { parse_mode: 'Markdown' }
    )
  })

  // /mystatus - Meine Einsätze
  bot.command('mystatus', async (ctx) => {
    const telegramUserId = ctx.from?.id
    if (!telegramUserId) {
      await ctx.reply('Fehler: Konnte deine Telegram-ID nicht ermitteln.')
      return
    }

    const helper = await getHelperByTelegramId(telegramUserId)
    if (!helper) {
      await ctx.reply('Du bist noch nicht registriert. Nutze /register')
      return
    }

    const assignments = await getHelperAssignments(helper.id)

    if (assignments.length === 0) {
      await ctx.reply(`Hallo ${helper.name}! Du hast aktuell keine Einsätze geplant.`)
      return
    }

    const lines = assignments
      .filter((a: any) => a.event)
      .map((a: any) => `📅 ${formatDate(a.event.event_date)}`)

    await ctx.reply(`👋 Hallo ${helper.name}!\n\nDeine nächsten Einsätze:\n${lines.join('\n')}`)
  })

  // /kannnicht - Vertretung anfragen
  bot.command('kannnicht', async (ctx) => {
    const telegramUserId = ctx.from?.id
    if (!telegramUserId) {
      await ctx.reply('Fehler: Konnte deine Telegram-ID nicht ermitteln.')
      return
    }

    const helper = await getHelperByTelegramId(telegramUserId)
    if (!helper) {
      await ctx.reply('Du bist noch nicht registriert. Nutze /register')
      return
    }

    const event = await getNextEvent()
    if (!event) {
      await ctx.reply('Kein anstehender Termin gefunden.')
      return
    }

    const isAssigned = event.assignments?.some((a: any) => a.helper_id === helper.id)
    if (!isAssigned) {
      await ctx.reply(`Du bist für ${formatDate(event.event_date)} nicht eingetragen.`)
      return
    }

    await ctx.reply(
      `⚠️ <b>Vertretung gesucht!</b>\n\n` +
      `${helper.name} kann am ${formatDate(event.event_date)} leider nicht.\n\n` +
      `Kann jemand einspringen? Bitte melden!`,
      { parse_mode: 'HTML' }
    )
  })

  // /chatid - zeigt die aktuelle Chat-ID (für Setup)
  bot.command('chatid', async (ctx) => {
    await ctx.reply(`Chat-ID: \`${ctx.chat.id}\``, { parse_mode: 'Markdown' })
  })

  // /help
  bot.command('help', async (ctx) => {
    await ctx.reply(`
Jungschar Bot Hilfe

Befehle:
/start - Bot starten
/register - Als Helfer registrieren
/status - Status für nächste Jungschar
/next - Nächste Termine anzeigen
/mystatus - Meine Einsätze
/idee - Aktivitäts-Idee
/kannnicht - Vertretung anfragen
/help - Diese Hilfe anzeigen

Fragen? Sprich einen Admin an!
    `.trim())
  })

  // Text Messages (für Elterngruppe, Registrierung)
  bot.on('message:text', async (ctx) => {
    const telegramUserId = ctx.from?.id
    const text = ctx.message.text
    const chatId = String(ctx.chat?.id)
    const elternChatId = process.env.TELEGRAM_ELTERN_CHAT_ID

    // Elterngruppe activity tracking is disabled for now
    if (elternChatId && chatId === elternChatId) return

    if (text.startsWith('/')) return

    if (telegramUserId && pendingRegistrations.has(telegramUserId)) {
      pendingRegistrations.delete(telegramUserId)

      try {
        const helper = await registerHelper(text.trim(), telegramUserId, ctx.from?.username)
        await ctx.reply(`✅ Super! Du bist jetzt als "${helper.name}" registriert!`)
      } catch (error) {
        await ctx.reply('Fehler bei der Registrierung. Bitte versuche es erneut mit /register')
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
      const [action, eventId] = callbackData.split('_')
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

        case 'idea': {
          // AI-Idee generieren und als PN senden
          await ctx.answerCallbackQuery({ text: '💡 Idee wird generiert...' })

          try {
            const idea = await generateIdeaForEvent(event?.event_date || '')
            const sent = await sendIdeaToUser(
              telegramUserId,
              `💡 <b>Idee für ${eventInfo}:</b>\n\n${idea}`
            )

            if (!sent) {
              await ctx.reply(
                `⚠️ ${userName}, ich kann dir keine Privatnachricht senden. ` +
                `Bitte starte zuerst eine Unterhaltung mit mir (klicke auf meinen Namen und drücke /start).`
              )
            }
          } catch (error) {
            console.error('Error generating idea:', error)
            await ctx.reply('Fehler beim Generieren der Idee. Versuche /idee im Chat.')
          }
          break
        }

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
