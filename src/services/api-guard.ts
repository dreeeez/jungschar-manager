import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from './telegram-auth'

/**
 * Zugangsprüfung für die API-Routen.
 *
 * Zwei zulässige Aufrufer:
 *  - die Mini-App, per Session-Cookie (aus /api/auth/me)
 *  - Vercel-Cron bzw. manuelle Tests, per `Authorization: Bearer $CRON_SECRET`
 *
 * Alles andere bekommt 401.
 */

export function getSession(req: NextRequest): SessionPayload | null {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)
}

export function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/**
 * @returns null wenn der Aufrufer zugelassen ist, sonst die fertige
 *          401-Antwort zum direkten Zurückgeben.
 */
export function requireOperator(req: NextRequest): NextResponse | null {
  if (hasCronSecret(req)) return null
  if (getSession(req)) return null
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
