'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { ARCHIVE_START_DATE } from '@/utils/format'
import { Page, List, Row, Button, Textarea, Badge, Loading, Empty, Star } from '@/components/ui'

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
}

const AVAILABLE_TAGS = ['drinnen', 'draußen'] as const

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('de-DE', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'elterngruppe': return 'Elterngruppe'
    case 'manual': return 'Manuell'
    default: return 'Idee'
  }
}

export default function ArchivePage() {
  const { showAlert } = useTelegram()
  const [events, setEvents] = useState<PastEvent[]>([])
  const [ideasMap, setIdeasMap] = useState<Map<string, IdeaRecord>>(new Map())
  const [loading, setLoading] = useState(true)
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [entryText, setEntryText] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
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

  function toggleTag(idea: IdeaRecord, tag: string) {
    const current = idea.tags || []
    const next = current.includes(tag)
      ? current.filter(t => t !== tag)
      : [...current, tag]
    updateIdea(idea, { tags: next })
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

  return (
    <Page
      back="/"
      title="Archiv"
      subtitle={`${events.length} ${events.length === 1 ? 'Termin' : 'Termine'}`}
    >
      {events.length === 0 ? (
        <Empty>Noch keine vergangenen Termine.</Empty>
      ) : (
        <List>
          {events.map((event) => {
            const idea = ideasMap.get(event.id)
            const isAddingLog = activeEntryId === event.id
            const parentName = getParentName(event)
            return (
              <Row key={event.id} className="flex-col items-stretch gap-2">
                <div>
                  <p className="font-medium">{formatDate(event.event_date)}</p>
                  <p className="text-sm text-muted">Helfer: {getHelperNames(event)}</p>
                  {parentName && (
                    <p className="text-sm text-muted">Essen: {parentName}</p>
                  )}
                </div>

                {idea ? (
                  <div className="space-y-3 pt-1">
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
                          <p className="flex-1 whitespace-pre-wrap text-sm">
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
                        <p className="mt-1 text-xs text-muted">{sourceLabel(idea.source)}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-1 text-fg">
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
                      {AVAILABLE_TAGS.map(tag => {
                        const active = (idea.tags || []).includes(tag)
                        return (
                          <Badge
                            key={tag}
                            tone={active ? 'accent' : 'outline'}
                            onClick={() => toggleTag(idea, tag)}
                          >
                            {tag}
                          </Badge>
                        )
                      })}
                    </div>
                  </div>
                ) : isAddingLog ? (
                  <div className="space-y-2 pt-1">
                    <Textarea
                      value={entryText}
                      onChange={(e) => setEntryText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          saveLog(event.id)
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
                        onClick={() => saveLog(event.id)}
                        disabled={savingId === event.id || !entryText.trim()}
                      >
                        {savingId === event.id ? 'Speichert …' : 'Speichern'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-3"
                      onClick={() => { setActiveEntryId(event.id); setEntryText('') }}
                    >
                      Aktivität nachtragen
                    </Button>
                  </div>
                )}
              </Row>
            )
          })}
        </List>
      )}
    </Page>
  )
}
