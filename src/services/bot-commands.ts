import { Bot } from 'grammy'
import { formatDate } from '@/utils/format'
import { getHelperByTelegramId, registerHelper, getHelperAssignments } from './helpers'
import { getNextEvent, getUpcomingEvents, getEventById, getHelperNames } from './events'
import { getSupabase } from './database'

// Track pending registrations (in-memory, resets on cold start)
const pendingRegistrations = new Set<number>()

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

  // Text Messages (für Registrierung)
  bot.on('message:text', async (ctx) => {
    const telegramUserId = ctx.from?.id
    const text = ctx.message.text

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
    const userName = user.first_name || user.username || 'Jemand'

    try {
      const [action, eventId] = callbackData.split('_')
      const event = await getEventById(eventId)
      const eventInfo = event ? formatDate(event.event_date) : 'dem Termin'

      let responseMessage = ''

      switch (action) {
        case 'confirm':
          responseMessage = `✅ ${userName} hat bestätigt: Alles klar für ${eventInfo}!`
          break
        case 'ready':
          responseMessage = `✅ ${userName} ist dabei für ${eventInfo}!`
          break
        case 'cancel':
          responseMessage = `❌ ${userName} kann leider nicht bei ${eventInfo}.`
          await ctx.reply(
            `⚠️ <b>Vertretung gesucht!</b>\n\n${userName} kann am ${eventInfo} nicht.\nKann jemand einspringen?`,
            { parse_mode: 'HTML' }
          )
          break
        case 'help':
          responseMessage = `🆘 ${userName} braucht Hilfe für ${eventInfo}!`
          await ctx.reply(
            `🆘 <b>Hilfe benötigt!</b>\n\n${userName} braucht Unterstützung für ${eventInfo}.\nWer kann helfen?`,
            { parse_mode: 'HTML' }
          )
          break
        default:
          responseMessage = `Aktion: ${callbackData}`
      }

      await ctx.answerCallbackQuery({ text: responseMessage.substring(0, 200) })

      if (action !== 'cancel' && action !== 'help') {
        await ctx.reply(responseMessage)
      }
    } catch (error) {
      console.error('Error handling callback:', error)
      await ctx.answerCallbackQuery({ text: 'Fehler bei der Verarbeitung' })
    }
  })
}
