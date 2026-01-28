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
