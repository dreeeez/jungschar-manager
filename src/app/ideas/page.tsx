'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { ARCHIVE_START_DATE } from '@/utils/format'
import Link from 'next/link'

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
    case 'elterngruppe': return '📨 Elterngruppe'
    case 'manual': return '✍️ Manuell'
    default: return '💡 Idee'
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
    return names.length ? names.join(' & ') : '—'
  }

  function getParentName(event: PastEvent): string {
    return event.parent_duties?.[0]?.parent?.name || ''
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tg-button" />
      </div>
    )
  }

  return (
    <main className="p-4 safe-area-top safe-area-bottom">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/" className="text-tg-link">←</Link>
        <h1 className="text-xl font-bold">Vergangene Termine</h1>
      </div>

      <p className="text-sm text-tg-hint mb-5">
        {events.length} {events.length === 1 ? 'Termin' : 'Termine'} im Archiv
      </p>

      <div className="space-y-3">
        {events.length === 0 ? (
          <p className="text-tg-hint text-center py-8">
            Noch keine vergangenen Termine.
          </p>
        ) : (
          events.map((event) => {
            const idea = ideasMap.get(event.id)
            const isAddingLog = activeEntryId === event.id
            const parentName = getParentName(event)
            return (
              <div key={event.id} className="p-4 bg-tg-secondary-bg rounded-xl">
                <p className="font-medium">📅 {formatDate(event.event_date)}</p>
                <p className="text-xs text-tg-hint mt-1">👥 {getHelperNames(event)}</p>
                {parentName && (
                  <p className="text-xs text-tg-hint mt-0.5">🍽️ {parentName}</p>
                )}

                {idea ? (
                  <div className="mt-3 pt-3 border-t border-tg-hint/10 space-y-3">
                    <div>
                      <p className="text-sm">✅ {idea.title}</p>
                      <p className="text-xs text-tg-hint mt-1">{sourceLabel(idea.source)}</p>
                    </div>

                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map(star => (
                        <button
                          key={star}
                          onClick={() => toggleStar(idea, star)}
                          className="text-xl leading-none active:scale-90 transition-transform"
                          aria-label={`${star} Sterne`}
                        >
                          {(idea.rating ?? 0) >= star ? '⭐' : '☆'}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {AVAILABLE_TAGS.map(tag => {
                        const active = (idea.tags || []).includes(tag)
                        return (
                          <button
                            key={tag}
                            onClick={() => toggleTag(idea, tag)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                              active
                                ? 'bg-tg-button text-tg-button-text'
                                : 'bg-tg-bg text-tg-hint border border-tg-hint/20'
                            }`}
                          >
                            {tag === 'drinnen' ? '🏠' : '🌳'} {tag}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : isAddingLog ? (
                  <div className="mt-3 pt-3 border-t border-tg-hint/10">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={entryText}
                        onChange={(e) => setEntryText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveLog(event.id)}
                        placeholder="Was habt ihr gemacht?"
                        className="flex-1 px-3 py-2 bg-tg-bg rounded-lg text-sm outline-none focus:ring-2 focus:ring-tg-button"
                        autoFocus
                      />
                      <button
                        onClick={() => saveLog(event.id)}
                        disabled={savingId === event.id || !entryText.trim()}
                        className="px-4 py-2 bg-tg-button text-tg-button-text rounded-lg text-sm font-medium disabled:opacity-50"
                      >
                        {savingId === event.id ? '...' : '✓'}
                      </button>
                      <button
                        onClick={() => { setActiveEntryId(null); setEntryText('') }}
                        className="px-3 py-2 text-tg-hint text-sm"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setActiveEntryId(event.id); setEntryText('') }}
                    className="mt-3 pt-3 border-t border-tg-hint/10 w-full text-left text-sm text-tg-link"
                  >
                    + Aktivität nachtragen
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </main>
  )
}
