'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { IdeaBody } from '@/components/IdeaBody'
import { supabase } from '@/lib/supabase'
import { Badge, ChevronRight, Empty, Input, List, Loading, Page, Row, Segmented } from '@/components/ui'
import {
  CATEGORIES,
  CATEGORY_LABEL,
  PLACE_OPTIONS,
  POOL_SELECT,
  SORT_OPTIONS,
  filterIdeas,
  loadSort,
  originLabel,
  saveSort,
  shortOrigin,
  type Place,
  type PoolIdea,
  type Sort,
} from '@/lib/pool'

/*
 * Ideenpool für Helfer: dieselbe Liste wie /pool, aber nur lesen. Keine
 * weiteren Seiten, keine Buttons. Helfer landen hier automatisch
 * (TelegramProvider), der Server lässt für sie ohnehin nur das Lesen von
 * `ideas` zu. Admins kommen mit dem Link aus dem Heads-up ebenfalls her.
 */
export default function IdeenPage() {
  const { showAlert, helper } = useTelegram()
  const [ideas, setIdeas] = useState<PoolIdea[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [place, setPlace] = useState<Place | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('newest')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    setSort(loadSort())
    ;(supabase as any)
      .from('ideas')
      .select(POOL_SELECT)
      .is('event_id', null)
      .eq('was_used', false)
      .order('created_at', { ascending: false })
      .then(({ data, error }: any) => {
        if (error) showAlert('Fehler: ' + error.message)
        else setIdeas(data || [])
        setLoading(false)
      })
  }, [])

  const filtered = useMemo(() => filterIdeas(ideas, query, place, category, sort), [ideas, query, place, category, sort])

  if (loading) return <Loading />

  return (
    <Page
      back={helper?.isAdmin ? '/' : undefined}
      title="Ideenpool"
      accent="pool"
      subtitle={`${filtered.length} von ${ideas.length} Ideen · eigene Idee per /idee im Bot`}
    >
      <div className="mb-3 space-y-2.5">
        <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Suchen …" />
        <div className="flex items-center justify-between gap-2">
          <Segmented options={PLACE_OPTIONS} value={place} onChange={(v) => setPlace(place === v ? null : v)} />
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value as Sort); saveSort(e.target.value as Sort) }}
            aria-label="Sortierung"
            className="h-9 rounded-lg bg-bg px-2.5 text-sm font-medium text-accent outline-none"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Badge tone={category === null ? 'solid' : 'outline'} onClick={() => setCategory(null)}>Alle</Badge>
          {CATEGORIES.map((c) => (
            <Badge key={c.value} tone={category === c.value ? 'solid' : 'outline'} onClick={() => setCategory(category === c.value ? null : c.value)}>
              {c.label}
            </Badge>
          ))}
        </div>
      </div>

      {ideas.length === 0 ? (
        <Empty>Noch keine Ideen im Pool.</Empty>
      ) : filtered.length === 0 ? (
        <Empty>Keine Idee passt zu diesem Filter.</Empty>
      ) : (
        <List>
          {filtered.map((idea) => {
            const tags = idea.tags || []
            const placeTag = tags.find((t) => t === 'drinnen' || t === 'draußen')
            const categoryTags = tags.filter((t) => CATEGORY_LABEL.has(t))
            const open = openId === idea.id
            return (
              <div key={idea.id}>
                <Row onClick={() => setOpenId(open ? null : idea.id)}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{idea.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                      {placeTag && <span className="text-accent">{placeTag === 'drinnen' ? 'Drinnen' : 'Draußen'}</span>}
                      {categoryTags.length > 0 && <span>{categoryTags.map((t) => CATEGORY_LABEL.get(t)).join(', ')}</span>}
                      <span>{shortOrigin(idea)}</span>
                    </p>
                  </div>
                  <span className={`shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`}>
                    <ChevronRight />
                  </span>
                </Row>
                {open && (
                  <div className="space-y-3 px-4 pb-4">
                    <IdeaBody idea={idea} />
                    <p className="text-xs text-muted">{originLabel(idea)}</p>
                  </div>
                )}
              </div>
            )
          })}
        </List>
      )}
    </Page>
  )
}
