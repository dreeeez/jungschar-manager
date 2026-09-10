import { NextRequest, NextResponse } from 'next/server'
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  verifyInitData,
  verifySessionToken,
} from '@/services/telegram-auth'
import { findAllowedHelper } from '@/services/admins'

export const dynamic = 'force-dynamic'

/**
 * Anmeldung der Mini-App.
 *
 * POST { initData }  → Signatur + Alter prüfen, Zugangsliste abfragen,
 *                      Session-Cookie setzen, Helfer zurückgeben.
 * GET                → bestehendes Cookie prüfen (Reload ohne neues initData).
 *
 * Ohne gültiges initData bzw. ohne Eintrag in `helpers`: 401.
 */

async function respondForTelegramUser(telegramUserId: number, setCookie: boolean) {
  const helper = await findAllowedHelper(telegramUserId)

  if (!helper) {
    return NextResponse.json(
      { error: 'not_registered', message: 'Kein Zugang: deine Telegram-ID steht nicht auf der Zugangsliste.' },
      { status: 403 },
    )
  }

  const res = NextResponse.json({
    user: {
      helperId: helper.helperId,
      telegramUserId: helper.telegramUserId,
      name: helper.name,
      isAdmin: helper.isAdmin,
    },
  })

  if (setCookie) {
    res.cookies.set(SESSION_COOKIE, createSessionToken(telegramUserId), sessionCookieOptions())
  }

  return res
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const initData: string | undefined = body?.initData

    if (initData) {
      const tgUser = verifyInitData(initData)
      if (!tgUser) {
        return NextResponse.json({ error: 'invalid_init_data' }, { status: 401 })
      }
      return await respondForTelegramUser(tgUser.id, true)
    }

    // Lokale Entwicklung: ohne Telegram gibt es kein initData. Greift nur
    // außerhalb von Production und nur für eine echte, registrierte
    // Helfer-ID — in Production ist der Zweig tot.
    if (process.env.NODE_ENV !== 'production' && process.env.DEV_TELEGRAM_USER_ID) {
      const devId = Number(process.env.DEV_TELEGRAM_USER_ID)
      if (Number.isFinite(devId)) {
        return await respondForTelegramUser(devId, true)
      }
    }

    return NextResponse.json({ error: 'missing_init_data' }, { status: 401 })
  } catch (e: any) {
    console.error('auth/me failed:', e)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)
    if (!session) {
      return NextResponse.json({ error: 'no_session' }, { status: 401 })
    }
    return await respondForTelegramUser(session.uid, false)
  } catch (e: any) {
    console.error('auth/me GET failed:', e)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0))
  return res
}
