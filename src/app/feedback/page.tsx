'use client'

import { useEffect, useState } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { Badge, Button, ChevronRight, Empty, List, Loading, Page, Row } from '@/components/ui'

/*
 * Feedback aus /bug: Fehler, Wünsche, Ideen zu Bot und App. Nur Admins.
 * Offene zuerst, Erledigte bleiben grau darunter. Nichts wird gelöscht.
 */

interface Feedback {
  id: string
  name: string
  role: string
  text: string
  photo_file_id: string | null
  done_at: string | null
  created_at: string
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function FeedbackPage() {
  const { showAlert } = useTelegram()
  const [items, setItems] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    ;(supabase as any)
      .from('feedback')
      .select('id, name, role, text, photo_file_id, done_at, created_at')
      .order('created_at', { ascending: false })
      .then(({ data, error }: any) => {
        if (error) showAlert('Fehler: ' + error.message)
        else setItems(data || [])
        setLoading(false)
      })
  }, [])

  async function setDone(item: Feedback, done: boolean) {
    const done_at = done ? new Date().toISOString() : null
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, done_at } : i)))
    const { error } = await (supabase as any).from('feedback').update({ done_at }).eq('id', item.id)
    if (error) {
      showAlert('Fehler: ' + error.message)
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, done_at: item.done_at } : i)))
    }
  }

  if (loading) return <Loading />

  const open = items.filter(i => !i.done_at)
  const done = items.filter(i => i.done_at)

  function renderItem(item: Feedback) {
    const isOpen = openId === item.id
    return (
      <div key={item.id} className={item.done_at ? 'opacity-60' : undefined}>
        <Row onClick={() => setOpenId(isOpen ? null : item.id)}>
          <div className="min-w-0 flex-1">
            <p className={`truncate ${item.done_at ? '' : 'font-medium'}`}>{item.text}</p>
            <p className="mt-0.5 text-xs text-muted">
              {item.name} · {item.role} · {fmt(item.created_at)}
              {item.photo_file_id ? ' · Bild' : ''}
            </p>
          </div>
          <span className={`shrink-0 text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}>
            <ChevronRight />
          </span>
        </Row>
        {isOpen && (
          <div className="space-y-3 px-4 pb-4">
            {item.photo_file_id && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/idea-photo?kind=feedback&id=${item.id}`} alt="" className="max-h-80 w-full rounded-xl object-contain" loading="lazy" />
            )}
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{item.text}</p>
            <div className="flex justify-end">
              {item.done_at ? (
                <Button variant="ghost" size="sm" onClick={() => setDone(item, false)}>Wieder öffnen</Button>
              ) : (
                <Button variant="primary" size="sm" onClick={() => setDone(item, true)}>Erledigt</Button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <Page back="/" title="Feedback" accent="status" subtitle={`${open.length} offen · ${done.length} erledigt · aus /bug im Bot`}>
      {items.length === 0 ? (
        <Empty>Noch kein Feedback. Alle können dem Bot mit /bug schreiben.</Empty>
      ) : (
        <>
          {open.length > 0 && (
            <div className="mb-6">
              <List>{open.map(renderItem)}</List>
            </div>
          )}
          {done.length > 0 && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="outline">Erledigt</Badge>
              </div>
              <List>{done.map(renderItem)}</List>
            </>
          )}
        </>
      )}
    </Page>
  )
}
