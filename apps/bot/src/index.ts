import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(process.cwd(), '../../.env') });
import { Bot, webhookCallback } from 'grammy';
import { setupCommands } from './bot/commands.js';
import { setupCallbacks } from './bot/callbacks.js';

// Validate environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set');
}

// Create bot instance
export const bot = new Bot(token);

// Setup commands and callbacks
setupCommands(bot);
setupCallbacks(bot);

// Error handling
bot.catch((err) => {
  console.error('Bot error:', err);
});

// Start bot
async function start() {
  console.log('Starting Jungschar Bot...');

  // Set bot commands for Telegram menu
  await bot.api.setMyCommands([
    { command: 'start', description: 'Bot starten' },
    { command: 'register', description: 'Als Helfer registrieren' },
    { command: 'status', description: 'Status für nächste Jungschar' },
    { command: 'next', description: 'Nächste Termine anzeigen' },
    { command: 'mystatus', description: 'Meine Einsätze anzeigen' },
    { command: 'idee', description: 'KI-Idee für Aktivität' },
    { command: 'kannnicht', description: 'Absage & Vertretung' },
    { command: 'wetter', description: 'Wetter-Vorschau' },
    { command: 'help', description: 'Hilfe anzeigen' },
  ]);

  // Start long polling (for development)
  // In production with Supabase Edge Functions, use webhookCallback instead
  if (process.env.NODE_ENV === 'development') {
    console.log('Bot started in development mode (long polling)');
    bot.start();
  }
}

start();

// Export webhook handler for Supabase Edge Functions (only used in production)
export function createWebhookHandler() {
  return webhookCallback(bot, 'std/http');
}
