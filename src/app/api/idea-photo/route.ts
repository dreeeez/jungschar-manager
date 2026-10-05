import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/services/api-guard'
import { getSupabase } from '@/services/database'

export const dynamic = 'force-dynamic'

/**
 * Bild zu einer Idee (/idee mit Foto) oder zu einem Feedback (/bug mit
 * Screenshot). Der Browser kennt den Bot-Token nicht, deshalb holt der
 * Server die Datei bei Telegram und reicht sie durch.
 * ?id=<uuid>[&kind=feedback], Session nötig; Feedback nur für Admins.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }
  const kind = req.nextUrl.searchParams.get('kind') === 'feedback' ? 'feedback' : 'ideas'
  if (kind === 'feedback' && session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data } = await getSupabase().from(kind).select('photo_file_id').eq('id', id).maybeSingle()
  const fileId = (data as any)?.photo_file_id as string | undefined
  if (!fileId) return NextResponse.json({ error: 'no photo' }, { status: 404 })

  const token = process.env.TELEGRAM_BOT_TOKEN
  const meta = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`).then(r => r.json())
  const path = meta?.result?.file_path
  if (!path) return NextResponse.json({ error: 'file not available' }, { status: 404 })

  const file = await fetch(`https://api.telegram.org/file/bot${token}/${path}`)
  if (!file.ok || !file.body) return NextResponse.json({ error: 'download failed' }, { status: 502 })
  return new NextResponse(file.body, {
    headers: {
      'Content-Type': file.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
