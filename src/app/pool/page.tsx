'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { IdeaBody } from '@/components/IdeaBody'
import { supabase } from '@/lib/supabase'
import { Badge, Button, Check, ChevronRight, Disclosure, Empty, Input, Label, List, Loading, Page, Row, Segmented, Textarea } from '@/components/ui'
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
 * Ideenpool: Aktivitäten, die noch keinem Termin zugeordnet sind.
 * Gespeichert in `ideas` mit event_id NULL und was_used=false. Der Grundstock
 * stammt aus dem Elternchat-Export (source='elterngruppe'), neue Ideen kommen
 * über das Formular dazu (source='manual'). Helfer sehen dieselbe Liste
 * nur lesend unter /ideen; Gemeinsames liegt in lib/pool.ts.
 */

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export default function PoolPage() {
  const { showAlert, showConfirm, helper, user } = useTelegram()
  const [ideas, setIdeas] = useState<PoolIdea[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [place, setPlace] = useState<Place | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('newest')
  const [openId, setOpenId] = useState<string | null>(null)

  // Auswahlmodus (nur Admins): Ideen markieren und in die Helfer-Gruppe teilen.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sharing, setSharing] = useState(false)
  const canShare = !!helper?.isAdmin

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 10) next.add(id)
      else showAlert('Höchstens 10 Ideen auf einmal.')
      return next
    })
  }

  function stopSelecting() {
    setSelecting(false)
    setSelected(new Set())
  }

  async function shareSelected(test: boolean) {
    if (selected.size === 0) return
    const target = test ? 'Sandbox-Gruppe' : 'Helfer-Gruppe'
    const ok = await showConfirm(`${selected.size} ${selected.size === 1 ? 'Idee' : 'Ideen'} in die ${target} posten?`)
    if (!ok) return
    setSharing(true)
    try {
      const res = await fetch('/api/pool/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], test }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      showAlert(`In der ${target} gepostet.`)
      stopSelecting()
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    }
    setSharing(false)
  }

  const [formOpen, setFormOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newMaterial, setNewMaterial] = useState('')
  const [newPlace, setNewPlace] = useState<Place | null>(null)
  const [newCategories, setNewCategories] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { setSort(loadSort()); fetchIdeas() }, [])

  function changeSort(next: Sort) {
    setSort(next)
    saveSort(next)
  }

  async function fetchIdeas() {
    const { data, error } = await (supabase as any)
      .from('ideas')
      .select(POOL_SELECT)
      .is('event_id', null)
      .eq('was_used', false)
      .order('created_at', { ascending: false })
    if (error) {
      showAlert('Fehler: ' + error.message)
    } else {
      setIdeas(data || [])
    }
    setLoading(false)
  }

  const filtered = useMemo(() => filterIdeas(ideas, query, place, category, sort), [ideas, query, place, category, sort])

  function resetForm() {
    setNewTitle('')
    setNewDescription('')
    setNewMaterial('')
    setNewPlace(null)
    setNewCategories([])
  }

  async function saveIdea() {
    const title = newTitle.trim()
    if (!title) return
    setSaving(true)
    const tags = [...(newPlace ? [newPlace] : []), ...newCategories]
    const { data, error } = await (supabase as any)
      .from('ideas')
      .insert({
        event_id: null,
        title: title.slice(0, 200),
        description: newDescription.trim() || null,
        material: newMaterial.trim() || null,
        was_used: false,
        source: 'manual',
        tags,
        suggested_by: helper?.name ?? user?.first_name ?? null,
      })
      .select(POOL_SELECT)
      .single()
    setSaving(false)
    if (error) {
      showAlert('Fehler: ' + error.message)
      return
    }
    setIdeas((prev) => [...prev, data])
    resetForm()
    setFormOpen(false)
  }

  async function removeIdea(idea: PoolIdea) {
    const ok = await showConfirm(`„${idea.title}" aus dem Pool entfernen?`)
    if (!ok) return
    const { error } = await (supabase as any).from('ideas').delete().eq('id', idea.id)
    if (error) {
      showAlert('Fehler: ' + error.message)
      return
    }
    setIdeas((prev) => prev.filter((i) => i.id !== idea.id))
  }

  function toggleNewCategory(value: string) {
    setNewCategories((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
  }

  if (loading) return <Loading />

  return (
    <Page
      back="/"
      title="Ideenpool"
      accent="pool"
      subtitle={`${filtered.length} von ${ideas.length} Ideen`}
    >
      {canShare && ideas.length > 0 && !selecting && (
        <div className="mb-6">
          <Button variant="secondary" block onClick={() => setSelecting(true)}>
            Ideen in Helfer-Gruppe teilen
          </Button>
        </div>
      )}
      {selecting && (
        <div className="card mb-6 flex items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm">Ideen antippen, die du teilen willst.</p>
          <Button variant="ghost" size="sm" onClick={stopSelecting}>Abbrechen</Button>
        </div>
      )}

      <Disclosure label="Idee hinzufügen" open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) resetForm() }}>
        <div className="space-y-3">
          <div>
            <Label>Titel</Label>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="z. B. Kanu fahren auf der Brenz"
              autoFocus
            />
          </div>
          <div>
            <Label>Beschreibung</Label>
            <Textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Was, wo, worauf achten?"
              rows={3}
            />
          </div>
          <div>
            <Label>Mitbringen</Label>
            <Input
              value={newMaterial}
              onChange={(e) => setNewMaterial(e.target.value)}
              placeholder="Helm, Taschenlampe, …"
            />
          </div>
          <Segmented options={PLACE_OPTIONS} value={newPlace} onChange={(v) => setNewPlace(newPlace === v ? null : v)} />
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <Badge key={c.value} tone={newCategories.includes(c.value) ? 'solid' : 'outline'} onClick={() => toggleNewCategory(c.value)}>
                {c.label}
              </Badge>
            ))}
          </div>
          <Button variant="primary" block onClick={saveIdea} disabled={saving || !newTitle.trim()}>
            {saving ? 'Speichert …' : 'Speichern'}
          </Button>
        </div>
      </Disclosure>

      <div className="mb-3 space-y-2.5">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Suchen …"
        />
        <div className="flex items-center justify-between gap-2">
          <Segmented options={PLACE_OPTIONS} value={place} onChange={(v) => setPlace(place === v ? null : v)} />
          <select
            value={sort}
            onChange={(e) => changeSort(e.target.value as Sort)}
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
            const isSelected = selected.has(idea.id)
            return (
              <div key={idea.id}>
                <Row onClick={() => (selecting ? toggleSelected(idea.id) : setOpenId(open ? null : idea.id))}>
                  {selecting && (
                    <span
                      className={cx(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
                        isSelected ? 'border-accent bg-accent text-accent-fg' : 'border-line',
                      )}
                    >
                      {isSelected && <Check />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{idea.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                      {placeTag && <span className="text-accent">{placeTag === 'drinnen' ? 'Drinnen' : 'Draußen'}</span>}
                      {categoryTags.length > 0 && <span>{categoryTags.map((t) => CATEGORY_LABEL.get(t)).join(', ')}</span>}
                      <span>{shortOrigin(idea)}</span>
                    </p>
                  </div>
                  {!selecting && (
                    <span className={cx('shrink-0 text-muted transition-transform', open && 'rotate-90')}>
                      <ChevronRight />
                    </span>
                  )}
                </Row>
                {open && !selecting && (
                  <div className="space-y-3 px-4 pb-4">
                    <IdeaBody idea={idea} />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted">{originLabel(idea)}</span>
                      <Button variant="danger" size="sm" className="-mr-3" onClick={() => removeIdea(idea)}>
                        Entfernen
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </List>
      )}

      {selecting && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-5 pb-6 pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="mx-auto flex max-w-md items-center gap-2">
            <p className="flex-1 text-sm">
              <span className="font-semibold">{selected.size}</span>
              <span className="text-muted"> {selected.size === 1 ? 'Idee' : 'Ideen'} ausgewählt</span>
            </p>
            <Button variant="ghost" size="sm" onClick={() => shareSelected(true)} disabled={sharing || selected.size === 0}>
              Test
            </Button>
            <Button variant="primary" size="sm" onClick={() => shareSelected(false)} disabled={sharing || selected.size === 0}>
              {sharing ? 'Sende …' : 'In Helfer-Gruppe teilen'}
            </Button>
          </div>
        </div>
      )}
    </Page>
  )
}
