import { NextRequest, NextResponse } from 'next/server'
import { currentBlock, postBlock, saveDraft } from '@/services/rotation'
import { requireOperator } from '@/services/api-guard'

export const dynamic = 'force-dynamic'

/**
 * Block speichern und/oder posten.
 *   Body { proposals, draftOnly: true } → nur als Entwurf speichern, nichts posten.
 *   Body { proposals } → speichern (ersetzt die Zuweisungen dieser Termine),
 *     als neue Nachricht posten und pinnen; die noch offenen Termine der
 *     jetzigen Einteilung kommen oben mit rein.
 *   Ohne Body → die aktuelle Einteilung (kommende Termine des gepinnten
 *     Blocks) noch einmal als neue Nachricht posten, landet ganz unten.
 *   ?test=1 → Sandbox-Gruppe, markiert nichts als gepostet.
 */
export async function POST(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  try {
    const body = await req.json().catch(() => null)
    const proposals = Array.isArray(body?.proposals) ? body.proposals : undefined

    if (proposals && body?.draftOnly) {
      const saved = await saveDraft(proposals)
      return NextResponse.json({ saved })
    }

    const isTest = req.nextUrl.searchParams.get('test') === '1'
    const chatId = isTest ? process.env.TELEGRAM_TEST_CHAT_ID : process.env.TELEGRAM_CHAT_ID
    if (!chatId) {
      const missing = isTest ? 'TELEGRAM_TEST_CHAT_ID' : 'TELEGRAM_CHAT_ID'
      return NextResponse.json({ error: `${missing} not configured` }, { status: 500 })
    }

    let eventIds: string[] = []
    if (!proposals) {
      const block = await currentBlock()
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())
      eventIds = (block?.events ?? []).filter(e => e.eventDate >= today).map(e => e.eventId)
    }
    const result = await postBlock({ chatId, isTest, eventIds, save: proposals })
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('rotation commit failed:', e)
    return NextResponse.json({ error: e.message ?? 'unknown' }, { status: 500 })
  }
}
