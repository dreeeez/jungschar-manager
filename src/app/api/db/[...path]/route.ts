import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/services/api-guard'

export const dynamic = 'force-dynamic'

/**
 * Datenbank-Proxy für die Mini-App.
 *
 * Der Browser kennt keinen Datenbank-Schlüssel mehr. Er schickt seine
 * PostgREST-Anfragen an /api/db/rest/v1/… , hier wird die Session geprüft
 * und die Anfrage mit dem SUPABASE_SERVICE_KEY weitergereicht.
 *
 * Der Pfad ist absichtlich deckungsgleich mit dem echten Supabase-REST-
 * Pfad — so kann der Client weiterhin supabase-js benutzen, nur mit
 * `/api/db` als Basis-URL.
 */

/** Nur diese Tabellen sind über den Proxy erreichbar. */
const ALLOWED_TABLES = new Set([
  'helpers',
  'events',
  'assignments',
  'event_status',
  'ideas',
  'children',
  'settings',
  'parents',
  'parent_duties',
  'attendance_votes',
  'reminder_log',
  'invitations',
])

/** Header, die der Client setzen darf (PostgREST-Steuerung). */
const FORWARD_REQUEST_HEADERS = [
  'accept',
  'accept-profile',
  'content-profile',
  'content-type',
  'prefer',
  'range',
  'range-unit',
]

/** Header, die aus der Supabase-Antwort zurückgereicht werden. */
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-range',
  'range-unit',
  'preference-applied',
]

function supabaseBase(): string {
  const url = process.env.SUPABASE_URL
  if (!url) throw new Error('SUPABASE_URL not configured')
  return url.replace(/\/+$/, '')
}

function serviceKey(): string {
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not configured')
  return key
}

async function proxy(req: NextRequest, path: string[]) {
  if (!getSession(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Erwartet rest/v1/<tabelle>[/...]
  if (path[0] !== 'rest' || path[1] !== 'v1' || path.length < 3) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const table = path[2]
  if (!ALLOWED_TABLES.has(table)) {
    return NextResponse.json({ error: `Table '${table}' not exposed` }, { status: 403 })
  }

  const target = `${supabaseBase()}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`

  const headers = new Headers()
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }
  // Der Client-seitige Schlüssel wird verworfen und hier ersetzt.
  headers.set('apikey', serviceKey())
  headers.set('authorization', `Bearer ${serviceKey()}`)

  const hasBody = !['GET', 'HEAD'].includes(req.method)
  const body = hasBody ? await req.text() : undefined

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: body && body.length > 0 ? body : undefined,
    cache: 'no-store',
  })

  const responseHeaders = new Headers()
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
}

type Ctx = { params: { path: string[] } }

export async function GET(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}
export async function PUT(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}
export async function HEAD(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}
