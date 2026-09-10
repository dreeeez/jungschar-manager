import { NextRequest, NextResponse } from 'next/server'
import { Bot, webhookCallback } from 'grammy'
import { setupBotCommands } from '@/services/bot-commands'

// Lazy initialization - nur bei erstem Request erstellt
let bot: Bot | null = null

function getBot() {
  if (!bot) {
    bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)
    setupBotCommands(bot)
  }
  return bot
}

export async function POST(req: NextRequest) {
  // Telegram schickt den beim setWebhook hinterlegten secret_token in
  // diesem Header mit. Wird nur geprüft, wenn die Env-Var gesetzt ist —
  // so bleibt ein bestehender Webhook ohne Secret weiter funktionsfähig,
  // bis er neu registriert wird.
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (expectedSecret) {
    if (req.headers.get('x-telegram-bot-api-secret-token') !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const handleUpdate = webhookCallback(getBot(), 'std/http')
    return await handleUpdate(req)
  } catch (error) {
    console.error('Error handling Telegram update:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Telegram webhook is active' })
}
