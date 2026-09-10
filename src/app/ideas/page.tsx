'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { ARCHIVE_START_DATE } from '@/utils/format'
import { Page, List, Row, Card, Button, Textarea, Loading, Empty, Star, Segmented, IconLine, SmallIcons, IconButton, Section } from '@/components/ui'

interface Suggestion {
  id: string
  description: string | null
  title: string
  suggested_by: string | null
  created_at: string
}

interface Helper { id: string; name: string }
interface Parent { id: string; name: string }

interface PastEvent {
  id: string
  event_date: string
  title: string | null
  assignments: { helper: Helper | null }[]
  parent_duties: { parent: Parent | null }[]
}

interface IdeaRecord {
  id: string
  event_id: string
  title: string
  description: string | null
  source: string
  created_at: string
  rating: number | null
  tags: string[] | null
  weather_description?: string | null
  temperature?: number | null
}

/** Zwei exklusive Paare: innerhalb eines Paares ist höchstens ein Wert gesetzt. */
const TAG_PAIRS = [
  [
    { value: 'drinnen', label: 'Drinnen' },
    { value: 'draußen', label: 'Draußen' },
  ],
] as const

type TagValue = (typeof TAG_PAIRS)[number][number]['value']

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('de-DE', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'elterngruppe': return 'Elterngruppe'
    case 'manual': return 'Manuell'
    case 'bot': return 'Per Bot'
    default: return 'Idee'
  }
}

export default function ArchivePage() {
  const { showAlert, showConfirm } = useTelegram()
  const [events, setEvents] = useState<PastEvent[]>([])
  const [ideasMap, setIdeasMap] = useState<Map<string, IdeaRecord>>(new Map())
  const [loading, setLoading] = useState(true)
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [entryText, setEntryText] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])

  useEffect(() => { fetchData() }, [])

  async function deleteSuggestion(s: Suggestion) {
    const ok = await showConfirm('Idee löschen?')
    if (!ok) return
    const { error } = await (supabase as any).from('ideas').delete().eq('id', s.id)
    if (error) showAlert('Fehler: ' + error.message)
    else setSuggestions(prev => prev.filter(x => x.id !== s.id))
  }

  async function fetchData() {
    // Vorschläge aus dem Bot (/idee): ohne Termin, noch nicht umgesetzt.
    const { data: sugg } = await (supabase as any)
      .from('ideas')
      .select('id, title, description, suggested_by, created_at')
      .is('event_id', null)
      .eq('was_used', false)
      .order('created_at', { ascending: false })
    setSuggestions(sugg ?? [])

    const today = new Date()
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    const { data, error } = await (supabase as any)
      .from('events')
      .select('id, event_date, title, assignments(helper:helpers(id, name)), parent_duties(parent:parents(id, name))')
      .lt('event_date', todayIso)
      .gte('event_date', ARCHIVE_START_DATE)
      .order('event_date', { ascending: false })

    if (error) {
      console.error('Error loading past events:', error)
      setLoading(false)
      return
    }

    const list: PastEvent[] = data || []
    setEvents(list)

    if (list.length > 0) {
      const ids = list.map(e => e.id)
      const { data: ideas } = await (supabase as any)
        .from('ideas')
        .select('*')
        .in('event_id', ids)
        .eq('was_used', true)
        .order('created_at', { ascending: false })

      const map = new Map<string, IdeaRecord>()
      for (const idea of (ideas || [])) {
        if (!map.has(idea.event_id)) map.set(idea.event_id, idea)
      }
      setIdeasMap(map)
    }

    setLoading(false)
  }

  async function saveLog(eventId: string) {
    if (!entryText.trim()) return
    setSavingId(eventId)
    try {
      const { data, error } = await (supabase as any)
        .from('ideas')
        .insert({
          event_id: eventId,
          title: entryText.trim().slice(0, 200),
          description: entryText.trim(),
          was_used: true,
          source: 'manual',
        })
        .select('*')
        .single()
      if (error) throw error
      setIdeasMap(prev => new Map(prev).set(eventId, data))
      setActiveEntryId(null)
      setEntryText('')
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    }
    setSavingId(null)
  }

  async function updateIdea(idea: IdeaRecord, patch: Partial<IdeaRecord>) {
    const optimistic = { ...idea, ...patch }
    setIdeasMap(prev => new Map(prev).set(idea.event_id, optimistic))
    const { error } = await (supabase as any)
      .from('ideas')
      .update(patch)
      .eq('id', idea.id)
    if (error) {
      showAlert('Fehler: ' + error.message)
      setIdeasMap(prev => new Map(prev).set(idea.event_id, idea))
    }
  }

  async function saveEdit(idea: IdeaRecord) {
    const text = editText.trim()
    if (!text) return
    await updateIdea(idea, {
      title: text.slice(0, 200),
      description: text,
    })
    setEditingId(null)
    setEditText('')
  }

  function toggleStar(idea: IdeaRecord, star: number) {
    const newRating = idea.rating === star ? null : star
    updateIdea(idea, { rating: newRating })
  }

  /** Setzt innerhalb eines Paares exklusiv; erneutes Tippen auf den aktiven Wert entfernt ihn. */
  function setPairTag(idea: IdeaRecord, pair: readonly { value: TagValue }[], tag: TagValue) {
    const current = idea.tags || []
    const pairValues = pair.map(p => p.value as string)
    const rest = current.filter(t => !pairValues.includes(t))
    const next = current.includes(tag) ? rest : [...rest, tag]
    updateIdea(idea, { tags: next })
  }

  function pairValue(idea: IdeaRecord, pair: readonly { value: TagValue }[]): TagValue | null {
    const current = idea.tags || []
    const hit = pair.find(p => current.includes(p.value))
    return hit ? hit.value : null
  }

  function getHelperNames(event: PastEvent): string {
    const names = event.assignments?.map(a => a.helper?.name).filter(Boolean) as string[]
    return names.length ? names.join(' & ') : '–'
  }

  function getParentName(event: PastEvent): string {
    return event.parent_duties?.[0]?.parent?.name || ''
  }

  if (loading) {
    return <Loading />
  }

  const logged = events.filter(e => ideasMap.has(e.id))
  const unlogged = events.filter(e => !ideasMap.has(e.id))

  function renderEntryForm(eventId: string) {
    return (
      <div className="space-y-2 pt-1">
        <Textarea
          value={entryText}
          onChange={(e) => setEntryText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              saveLog(eventId)
            }
          }}
          placeholder="Was habt ihr gemacht? (Shift+Enter für Absatz)"
          rows={3}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setActiveEntryId(null); setEntryText('') }}
          >
            Abbrechen
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => saveLog(eventId)}
            disabled={savingId === eventId || !entryText.trim()}
          >
            {savingId === eventId ? 'Speichert …' : 'Speichern'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Page
      back="/"
      title="Archiv"
      accent="archive"
      subtitle={`${logged.length} ${logged.length === 1 ? 'Eintrag' : 'Einträge'}`}
    >
      {suggestions.length > 0 && (
        <Section title="Ideen aus dem Bot">
          <List>
            {suggestions.map((s) => (
              <Row key={s.id} className="items-start">
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap text-sm">{s.description || s.title}</p>
                  <p className="mt-1 text-xs text-muted">
                    {s.suggested_by ?? 'Unbekannt'} · {new Date(s.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </p>
                </div>
                <IconButton label="Löschen" tone="danger" onClick={() => deleteSuggestion(s)}>
                  <SmallIcons.trash />
                </IconButton>
              </Row>
            ))}
          </List>
        </Section>
      )}

      {events.length === 0 ? (
        <Empty>Noch keine vergangenen Termine.</Empty>
      ) : logged.length === 0 ? (
        <Empty>Noch keine Einträge. Unten lässt sich eine Aktivität nachtragen.</Empty>
      ) : (
        logged.map((event) => {
          const idea = ideasMap.get(event.id)!
          const parentName = getParentName(event)
          return (
            <Card key={event.id} className="mb-3 p-5">
              <p className="font-semibold">{formatDate(event.event_date)}</p>
              <IconLine icon={<SmallIcons.users />}>{getHelperNames(event)}</IconLine>
              {parentName && (
                <IconLine icon={<SmallIcons.food />}>{parentName}</IconLine>
              )}
              {idea.weather_description && (
                <IconLine icon={<SmallIcons.weather />}>
                  {idea.weather_description}
                  {idea.temperature != null && `, ${idea.temperature} °C`}
                </IconLine>
              )}

              <div className="mt-4 space-y-4">
                {editingId === idea.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          saveEdit(idea)
                        }
                      }}
                      rows={3}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setEditingId(null); setEditText('') }}
                      >
                        Abbrechen
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => saveEdit(idea)}
                        disabled={!editText.trim()}
                      >
                        Speichern
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="flex-1 whitespace-pre-wrap text-[15px] leading-relaxed">
                        {idea.description || idea.title}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-mr-3 -mt-1 shrink-0"
                        onClick={() => { setEditingId(idea.id); setEditText(idea.description || idea.title) }}
                      >
                        Bearbeiten
                      </Button>
                    </div>
                    <p className="mt-1.5 text-xs text-muted">{sourceLabel(idea.source)}</p>
                  </div>
                )}

                <div className="flex items-center gap-1 text-accent">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => toggleStar(idea, star)}
                      className="p-0.5 transition-transform active:scale-90"
                      aria-label={`${star} Sterne`}
                    >
                      <Star filled={(idea.rating ?? 0) >= star} />
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  {TAG_PAIRS.map((pair) => (
                    <Segmented
                      key={pair[0].value}
                      options={[...pair]}
                      value={pairValue(idea, pair)}
                      onChange={(v) => setPairTag(idea, pair, v)}
                    />
                  ))}
                </div>
              </div>
            </Card>
          )
        })
      )}

      {unlogged.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer py-2 text-sm text-muted">
            {unlogged.length} {unlogged.length === 1 ? 'Termin' : 'Termine'} ohne Eintrag
          </summary>
          <List className="mt-2">
            {unlogged.map((event) => {
              const isAddingLog = activeEntryId === event.id
              return (
                <div key={event.id}>
                  <Row>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{formatDate(event.event_date)}</p>
                      <p className="text-sm text-muted">{getHelperNames(event)}</p>
                    </div>
                    {!isAddingLog && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setActiveEntryId(event.id); setEntryText('') }}
                      >
                        Nachtragen
                      </Button>
                    )}
                  </Row>
                  {isAddingLog && <div className="px-4 pb-4">{renderEntryForm(event.id)}</div>}
                </div>
              )
            })}
          </List>
        </details>
      )}
    </Page>
  )
}
