import { NextRequest, NextResponse } from 'next/server'
import { Bot, webhookCallback } from 'grammy'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// Initialize Bot
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)

// Helper functions
async function getHelperByTelegramId(telegramUserId: number) {
  const { data } = await supabase
    .from('helpers')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .single()
  return data
}

async function registerHelper(name: string, telegramUserId: number, username?: string) {
  // First try to find existing helper by name
  const { data: existing } = await supabase
    .from('helpers')
    .select('*')
    .ilike('name', name)
    .single()

  if (existing) {
    // Update existing helper with Telegram info
    const { data, error } = await supabase
      .from('helpers')
      .update({
        telegram_user_id: telegramUserId,
        telegram_username: username,
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw error
    return data
  }

  // Create new helper
  const { data, error } = await supabase
    .from('helpers')
    .insert({
      name,
      telegram_user_id: telegramUserId,
      telegram_username: username,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

async function getNextEvent() {
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('events')
    .select('*, assignments(*, helper:helpers(*))')
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .limit(1)
    .single()
  return data
}

async function getUpcomingEvents(limit = 5) {
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase
    .from('events')
    .select('*, assignments(*, helper:helpers(*))')
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .limit(limit)
  return data || []
}

// Track pending registrations (in-memory, resets on cold start)
const pendingRegistrations = new Set<number>()

// Format date helper
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }
  return date.toLocaleDateString('de-DE', options)
}

// Bot commands
bot.command('start', async (ctx) => {
  const welcomeMessage = `
Willkommen beim Jungschar Bot!

Ich helfe eurer Helfer-Gruppe bei der Organisation:
- Wöchentliche Erinnerungen wer dran ist
- Nächste Termine anzeigen
- Vertretungsanfragen

Registriere dich mit /register um loszulegen!
  `.trim()

  await ctx.reply(welcomeMessage)
})

bot.command('register', async (ctx) => {
  const telegramUserId = ctx.from?.id
  const telegramUsername = ctx.from?.username

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

bot.command('next', async (ctx) => {
  const events = await getUpcomingEvents(5)

  if (events.length === 0) {
    await ctx.reply('Keine anstehenden Termine gefunden.')
    return
  }

  const lines = events.map((event: any) => {
    const helpers = event.assignments?.map((a: any) => a.helper?.name).filter(Boolean).join(' & ') || '?'
    return `📅 ${formatDate(event.event_date)}: ${helpers}`
  })

  await ctx.reply(`Nächste Jungschar-Termine:\n\n${lines.join('\n')}`)
})

bot.command('status', async (ctx) => {
  const event = await getNextEvent()

  if (!event) {
    await ctx.reply('Keine anstehende Jungschar gefunden.')
    return
  }

  const helpers = event.assignments?.map((a: any) => a.helper?.name).filter(Boolean).join(' & ') || 'Niemand eingetragen'

  const message = `
📅 Nächste Jungschar: ${formatDate(event.event_date)}

👥 Team: ${helpers}
  `.trim()

  await ctx.reply(message)
})

bot.command('help', async (ctx) => {
  const helpMessage = `
Jungschar Bot Hilfe

Befehle:
/start - Bot starten
/register - Als Helfer registrieren
/status - Status für nächste Jungschar
/next - Nächste Termine anzeigen
/help - Diese Hilfe anzeigen

Fragen? Sprich einen Admin an!
  `.trim()

  await ctx.reply(helpMessage)
})

// Handle text messages (for registration)
bot.on('message:text', async (ctx) => {
  const telegramUserId = ctx.from?.id
  const text = ctx.message.text

  if (text.startsWith('/')) return

  if (telegramUserId && pendingRegistrations.has(telegramUserId)) {
    pendingRegistrations.delete(telegramUserId)

    try {
      const helper = await registerHelper(
        text.trim(),
        telegramUserId,
        ctx.from?.username
      )
      await ctx.reply(`✅ Super! Du bist jetzt als "${helper.name}" registriert!`)
    } catch (error) {
      await ctx.reply('Fehler bei der Registrierung. Bitte versuche es erneut mit /register')
    }
  }
})

// Webhook handler
const handleUpdate = webhookCallback(bot, 'std/http')

export async function POST(req: NextRequest) {
  try {
    return await handleUpdate(req)
  } catch (error) {
    console.error('Error handling Telegram update:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Telegram webhook is active' })
}
