import { NextRequest, NextResponse } from 'next/server'
import { requireOperator } from '@/services/api-guard'
import { renderReminderPreview } from '@/services/reminders'
import { renderPollReminderPreview } from '@/services/poll-reminder'
import { renderReviewPreview } from '@/services/review-ping'

export const dynamic = 'force-dynamic'

/**
 * Vorschau einer geplanten Bot-Nachricht, ohne zu senden.
 * ?type=stage1_sunday|stage2_wednesday|stage3_saturday|poll_thursday|review_evening
 * &date=YYYY-MM-DD (Termin-Datum)
 */
export async function GET(req: NextRequest) {
  const denied = requireOperator(req)
  if (denied) return denied

  const type = req.nextUrl.searchParams.get('type') ?? ''
  const date = req.nextUrl.searchParams.get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date required' }, { status: 400 })
  }

  try {
    let text: string | null = null
    let buttons: string[] = []
    if (type === 'poll_thursday') {
      text = await renderPollReminderPreview(date)
    } else if (type === 'review_evening') {
      text = await renderReviewPreview(date)
    } else {
      const r = await renderReminderPreview(type, date)
      text = r?.text ?? null
      buttons = (r?.replyMarkup?.inline_keyboard ?? []).flat().map((b: any) => b.text)
    }
    if (!text) return NextResponse.json({ error: 'no preview' }, { status: 404 })
    return NextResponse.json({ type, date, text, buttons })
  } catch (e: any) {
    console.error('preview failed:', e)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
