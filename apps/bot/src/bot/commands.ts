import { Bot, InlineKeyboard } from 'grammy';
import {
  getHelperByTelegramId,
  registerHelper,
  getNextEvent,
  getUpcomingEvents,
  getAssignmentsForHelper,
  getBirthdaysThisWeek,
} from '../services/supabase.js';
import { generateIdea } from '../services/ai-ideas.js';
import { getWeatherForecast } from '../services/weather.js';

// Track users waiting for registration (simple state)
const pendingRegistrations = new Set<number>();

export function setupCommands(bot: Bot) {
  // /start command
  bot.command('start', async (ctx) => {
    const welcomeMessage = `
Willkommen beim Jungschar Bot!

Ich helfe eurer Helfer-Gruppe bei der Organisation:
- Wöchentliche Erinnerungen wer dran ist
- Status-Updates (Idee, Essen, Ready)
- KI-generierte Ideen für Aktivitäten
- Wetter-Vorhersage
- Vertretungsanfragen

Registriere dich mit /register um loszulegen!
    `.trim();

    await ctx.reply(welcomeMessage);
  });

  // /register command
  bot.command('register', async (ctx) => {
    const telegramUserId = ctx.from?.id;
    const telegramUsername = ctx.from?.username;

    if (!telegramUserId) {
      await ctx.reply('Fehler: Konnte deine Telegram-ID nicht ermitteln.');
      return;
    }

    // Check if already registered
    const existingHelper = await getHelperByTelegramId(telegramUserId);
    if (existingHelper) {
      await ctx.reply(`Du bist bereits als "${existingHelper.name}" registriert!`);
      return;
    }

    // Ask for name
    await ctx.reply(
      'Wie heißt du? Bitte antworte mit deinem Namen.\n\n' +
      '(Tipp: Dein Name sollte so sein wie er in der Helfer-Liste steht)'
    );

    // Mark that we're waiting for registration
    pendingRegistrations.add(telegramUserId);
  });

  // Handle text messages (for registration)
  bot.on('message:text', async (ctx, next) => {
    const telegramUserId = ctx.from?.id;
    const text = ctx.message.text;

    // Skip if it's a command
    if (text.startsWith('/')) {
      return next();
    }

    // Check if we're waiting for this user's name
    if (telegramUserId && pendingRegistrations.has(telegramUserId)) {
      pendingRegistrations.delete(telegramUserId);

      try {
        const helper = await registerHelper(
          text.trim(),
          telegramUserId,
          ctx.from?.username
        );
        await ctx.reply(`✅ Super! Du bist jetzt als "${helper.name}" registriert!`);
      } catch (error) {
        await ctx.reply('Fehler bei der Registrierung. Bitte versuche es erneut mit /register');
      }
      return;
    }

    return next();
  });

  // /status command
  bot.command('status', async (ctx) => {
    const event = await getNextEvent();

    if (!event) {
      await ctx.reply('Keine anstehende Jungschar gefunden.');
      return;
    }

    const helpers = event.assignments?.map((a: any) => a.helper?.name).filter(Boolean).join(' & ') || 'Niemand eingetragen';
    const status = event.event_status;

    const statusEmoji = (val: boolean | undefined) => val ? '✅' : '❌';

    const message = `
📅 Nächste Jungschar: ${formatDate(event.event_date)}

👥 Team: ${helpers}

Status:
${statusEmoji(status?.idea_ready)} Idee steht
${statusEmoji(status?.food_communicated)} Essen kommuniziert
${statusEmoji(status?.all_ready)} Alles bereit
${status?.needs_help ? '🆘 Hilfe benötigt!' : ''}
    `.trim();

    const keyboard = new InlineKeyboard()
      .text('✅ Idee steht', `status_idea_${event.id}`)
      .text('✅ Essen', `status_food_${event.id}`)
      .row()
      .text('✅ Ready', `status_ready_${event.id}`)
      .text('🆘 Hilfe', `status_help_${event.id}`);

    await ctx.reply(message, { reply_markup: keyboard });
  });

  // /next command
  bot.command('next', async (ctx) => {
    const events = await getUpcomingEvents(5);

    if (events.length === 0) {
      await ctx.reply('Keine anstehenden Termine gefunden.');
      return;
    }

    const lines = events.map((event: any) => {
      const helpers = event.assignments?.map((a: any) => a.helper?.name).filter(Boolean).join(' & ') || '?';
      return `📅 ${formatDate(event.event_date)}: ${helpers}`;
    });

    await ctx.reply(`Nächste Jungschar-Termine:\n\n${lines.join('\n')}`);
  });

  // /mystatus command
  bot.command('mystatus', async (ctx) => {
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) {
      await ctx.reply('Fehler: Konnte deine Telegram-ID nicht ermitteln.');
      return;
    }

    const helper = await getHelperByTelegramId(telegramUserId);
    if (!helper) {
      await ctx.reply('Du bist noch nicht registriert. Nutze /register um dich anzumelden.');
      return;
    }

    const assignments = await getAssignmentsForHelper(helper.id);
    if (assignments.length === 0) {
      await ctx.reply('Du hast keine anstehenden Einsätze.');
      return;
    }

    const lines = assignments.map((a: any) => {
      return `📅 ${formatDate(a.event?.event_date)}`;
    });

    await ctx.reply(`Deine nächsten Einsätze:\n\n${lines.join('\n')}`);
  });

  // /idee command
  bot.command('idee', async (ctx) => {
    await ctx.reply('💭 Generiere Idee...');

    try {
      const idea = await generateIdea();

      const keyboard = new InlineKeyboard()
        .text('🔄 Andere Idee', 'new_idea')
        .text('✅ Diese nehmen wir!', 'accept_idea');

      await ctx.reply(idea, { reply_markup: keyboard });
    } catch (error) {
      await ctx.reply('Fehler beim Generieren der Idee. Bitte versuche es später erneut.');
    }
  });

  // /kannnicht command
  bot.command('kannnicht', async (ctx) => {
    const telegramUserId = ctx.from?.id;
    if (!telegramUserId) {
      await ctx.reply('Fehler: Konnte deine Telegram-ID nicht ermitteln.');
      return;
    }

    const helper = await getHelperByTelegramId(telegramUserId);
    if (!helper) {
      await ctx.reply('Du bist noch nicht registriert. Nutze /register um dich anzumelden.');
      return;
    }

    const event = await getNextEvent();
    if (!event) {
      await ctx.reply('Keine anstehende Jungschar gefunden.');
      return;
    }

    // Check if this helper is assigned
    const isAssigned = event.assignments?.some((a: any) => a.helper?.telegram_user_id === telegramUserId);
    if (!isAssigned) {
      await ctx.reply('Du bist für die nächste Jungschar nicht eingeteilt.');
      return;
    }

    const otherHelpers = event.assignments
      ?.filter((a: any) => a.helper?.telegram_user_id !== telegramUserId)
      .map((a: any) => a.helper?.name)
      .filter(Boolean)
      .join(' & ') || 'niemand';

    const keyboard = new InlineKeyboard()
      .text('🙋 Ich springe ein!', `substitute_${event.id}_${helper.id}`);

    // In a group chat, this would notify everyone
    const message = `
⚠️ ${helper.name} kann am ${formatDate(event.event_date)} leider nicht.
${otherHelpers} braucht einen Ersatz-Partner!

Wer kann einspringen?
    `.trim();

    await ctx.reply(message, { reply_markup: keyboard });
  });

  // /wetter command
  bot.command('wetter', async (ctx) => {
    const event = await getNextEvent();
    if (!event) {
      await ctx.reply('Keine anstehende Jungschar gefunden.');
      return;
    }

    try {
      const weather = await getWeatherForecast(event.event_date);
      await ctx.reply(`🌤️ Wetter für ${formatDate(event.event_date)}:\n\n${weather}`);
    } catch (error) {
      await ctx.reply('Fehler beim Abrufen der Wetterdaten.');
    }
  });

  // /help command
  bot.command('help', async (ctx) => {
    const helpMessage = `
Jungschar Bot Hilfe

Befehle:
/start - Bot starten
/register - Als Helfer registrieren
/status - Status für nächste Jungschar
/next - Nächste Termine anzeigen
/mystatus - Meine Einsätze anzeigen
/idee - KI-Idee für Aktivität generieren
/kannnicht - Absage & Vertretung anfragen
/wetter - Wetter-Vorschau
/help - Diese Hilfe anzeigen

Fragen? Sprich einen Admin an!
    `.trim();

    await ctx.reply(helpMessage);
  });
}

// Helper function to format dates
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  };
  return date.toLocaleDateString('de-DE', options);
}
