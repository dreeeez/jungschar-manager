import { Bot } from 'grammy';
import { updateEventStatus } from '../services/supabase.js';
import { generateIdea } from '../services/ai-ideas.js';

export function setupCallbacks(bot: Bot) {
  // Status update callbacks
  bot.callbackQuery(/^status_idea_(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    await updateEventStatus(eventId, { idea_ready: true });
    await ctx.answerCallbackQuery('✅ Idee als fertig markiert!');
    await ctx.editMessageText(ctx.callbackQuery.message?.text + '\n\n✅ Idee wurde als fertig markiert!');
  });

  bot.callbackQuery(/^status_food_(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    await updateEventStatus(eventId, { food_communicated: true });
    await ctx.answerCallbackQuery('✅ Essen als kommuniziert markiert!');
    await ctx.editMessageText(ctx.callbackQuery.message?.text + '\n\n✅ Essen wurde als kommuniziert markiert!');
  });

  bot.callbackQuery(/^status_ready_(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    await updateEventStatus(eventId, { all_ready: true });
    await ctx.answerCallbackQuery('✅ Alles als ready markiert!');
    await ctx.editMessageText(ctx.callbackQuery.message?.text + '\n\n✅ Alles wurde als ready markiert!');
  });

  bot.callbackQuery(/^status_help_(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    await updateEventStatus(eventId, { needs_help: true });
    await ctx.answerCallbackQuery('🆘 Hilfe-Anfrage gesendet!');

    // In production, this would also notify the group
    await ctx.editMessageText(
      ctx.callbackQuery.message?.text + '\n\n🆘 Hilfe wurde angefragt! Die Gruppe wird benachrichtigt.'
    );
  });

  // New idea callback
  bot.callbackQuery('new_idea', async (ctx) => {
    await ctx.answerCallbackQuery('💭 Generiere neue Idee...');

    try {
      const idea = await generateIdea();
      await ctx.editMessageText(idea, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Andere Idee', callback_data: 'new_idea' },
              { text: '✅ Diese nehmen wir!', callback_data: 'accept_idea' },
            ],
          ],
        },
      });
    } catch (error) {
      await ctx.editMessageText('Fehler beim Generieren der Idee. Bitte versuche es erneut.');
    }
  });

  // Accept idea callback
  bot.callbackQuery('accept_idea', async (ctx) => {
    await ctx.answerCallbackQuery('✅ Idee gespeichert!');
    await ctx.editMessageText(
      ctx.callbackQuery.message?.text + '\n\n✅ Diese Idee wurde übernommen!'
    );
    // TODO: Save idea to database
  });

  // Substitute callback
  bot.callbackQuery(/^substitute_(.+)_(.+)$/, async (ctx) => {
    const eventId = ctx.match[1];
    const originalHelperId = ctx.match[2];
    const substituteUserId = ctx.from.id;
    const substituteName = ctx.from.first_name;

    await ctx.answerCallbackQuery(`🙋 Du springst ein!`);

    // TODO: Update assignment in database

    await ctx.editMessageText(
      ctx.callbackQuery.message?.text +
        `\n\n✅ Super! ${substituteName} springt ein!`
    );
  });
}
