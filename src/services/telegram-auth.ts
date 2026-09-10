import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Telegram-initData-Prüfung + Session-Cookie.
 *
 * Telegram hängt an die Mini-App-URL ein signiertes `initData` an. Die
 * Signatur wird aus dem Bot-Token gebildet — nur Telegram kann sie
 * erzeugen. Wer sie nachrechnen kann, weiß sicher, wer die App geöffnet
 * hat und wann.
 *
 * Da `initData` nicht bei jedem Request mitgeschickt werden kann (und
 * mit der Zeit veraltet), tauschen wir es einmalig gegen ein signiertes
 * Session-Cookie: /api/auth/me prüft initData, danach reicht das Cookie.
 */

export const SESSION_COOKIE = 'app_session'

/** initData älter als das → abgelehnt. Telegram empfiehlt max. 24h. */
const MAX_INITDATA_AGE_SECONDS = 24 * 60 * 60

/** Laufzeit des Session-Cookies. */
export const SESSION_TTL_SECONDS = 24 * 60 * 60

export interface TelegramAuthUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
}

export interface SessionPayload {
  /** Telegram-User-ID */
  uid: number
  /** Unix-Sekunden, ab wann das Cookie ungültig ist */
  exp: number
}

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not configured')
  return token
}

/**
 * Eigener Schlüssel fürs Session-Signieren, abgeleitet aus dem Bot-Token.
 * Vermeidet eine zusätzliche Env-Var und trennt trotzdem sauber vom
 * initData-Schlüssel (anderer Kontext-String).
 */
function sessionKey(): Buffer {
  return createHmac('sha256', botToken()).update('jungschar-session-v1').digest()
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/**
 * Prüft die Telegram-Signatur über dem initData-String.
 *
 * Verfahren laut Telegram-Doku:
 *   secret     = HMAC_SHA256(key: "WebAppData", msg: bot_token)
 *   check_hash = HMAC_SHA256(key: secret, msg: data_check_string)
 * wobei data_check_string alle Felder außer `hash`, alphabetisch nach
 * Key sortiert, als `key=value` mit \n verbunden sind.
 *
 * @returns den Telegram-User bei gültiger, frischer Signatur — sonst null.
 */
export function verifyInitData(initData: string): TelegramAuthUser | null {
  if (!initData) return null

  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return null
  }

  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData').update(botToken()).digest()
  const computed = createHmac('sha256', secret).update(dataCheckString).digest('hex')

  if (!safeEqualHex(computed, hash)) return null

  // Alter prüfen — eine abgefangene, gültig signierte URL soll nicht ewig gelten.
  const authDate = Number(params.get('auth_date'))
  if (!Number.isFinite(authDate)) return null
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate
  if (ageSeconds > MAX_INITDATA_AGE_SECONDS || ageSeconds < -60) return null

  const rawUser = params.get('user')
  if (!rawUser) return null
  try {
    const user = JSON.parse(rawUser)
    if (typeof user?.id !== 'number') return null
    return user as TelegramAuthUser
  } catch {
    return null
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Baut ein signiertes Session-Token: <payload>.<signature> */
export function createSessionToken(telegramUserId: number): string {
  const payload: SessionPayload = {
    uid: telegramUserId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const sig = b64url(createHmac('sha256', sessionKey()).update(body).digest())
  return `${body}.${sig}`
}

/** Prüft Signatur + Ablauf eines Session-Tokens. */
export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null

  const expected = b64url(createHmac('sha256', sessionKey()).update(body).digest())
  if (expected.length !== sig.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null
  } catch {
    return null
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as SessionPayload
    if (typeof payload?.uid !== 'number' || typeof payload?.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

/**
 * Cookie-Attribute. Die Mini-App läuft im Telegram-Webview bzw. auf dem
 * Desktop in einem iframe — dort ist ein Cookie nur mit `SameSite=None;
 * Secure` sichtbar. Lokal (http) ist das nicht erlaubt, deshalb dort Lax.
 */
export function sessionCookieOptions(maxAge: number = SESSION_TTL_SECONDS) {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
    maxAge,
  }
}
