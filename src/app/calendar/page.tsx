'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { ARCHIVE_START_DATE } from '@/utils/format'
import Link from 'next/link'

interface Helper {
  id: string
  name: string
}

interface Parent {
  id: string
  name: string
}

interface Assignment {
  id: string
  helper_id: string
  helper: Helper | null
}

interface ParentDuty {
  id: string
  parent_id: string
  parent: Parent | null
}

interface Event {
  id: string
  event_date: string
  title: string | null
  description: string | null
  imported_at: string
  assignments: Assignment[]
  parent_duties: ParentDuty[]
}

interface IdeaRecord {
  id: string
  event_id: string
  title: string
  description: string | null
  was_used: boolean
  source: string
  created_at: string
}

interface RotationProposal {
  eventId: string
  eventDate: string
  helpers: { id: string; name: string; username: string | null; isSenior: boolean }[]
}

export default function CalendarPage() {
  const { showAlert } = useTelegram()
  const [events, setEvents] = useState<Event[]>([])
  const [helpers, setHelpers] = useState<Helper[]>([])
  const [parents, setParents] = useState<Parent[]>([])
  const [ideasMap, setIdeasMap] = useState<Map<string, IdeaRecord>>(new Map())
  const [loading, setLoading] = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [selectedEventIdea, setSelectedEventIdea] = useState<IdeaRecord | null | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [newActivityText, setNewActivityText] = useState('')
  const [savingActivity, setSavingActivity] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [rotationLoading, setRotationLoading] = useState(false)
  const [rotationPreview, setRotationPreview] = useState<RotationProposal[] | null>(null)
  const [rotationSkipped, setRotationSkipped] = useState<{ eventDate: string; reason: string }[]>([])
  const [rotationCommitting, setRotationCommitting] = useState(false)
  const [rotationTestMode, setRotationTestMode] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const [eventsResult, helpersResult, parentsResult] = await Promise.all([
      supabase
        .from('events')
        .select('*, assignments(id, helper_id, helper:helpers(id, name)), parent_duties(id, parent_id, parent:parents(id, name))')
        .order('event_date', { ascending: true }),
      supabase
        .from('helpers')
        .select('id, name')
        .order('name', { ascending: true }),
      (supabase as any)
        .from('parents')
        .select('id, name')
        .eq('active', true)
        .order('name', { ascending: true }),
    ])

    const loadedEvents = eventsResult.data as any[] || []

    if (eventsResult.error) {
      console.error('Error fetching events:', eventsResult.error)
      showAlert('Fehler beim Laden der Events')
    } else {
      setEvents(loadedEvents)
    }

    if (helpersResult.error) {
      console.error('Error fetching helpers:', helpersResult.error)
    } else {
      setHelpers(helpersResult.data || [])
    }

    if (parentsResult.error) {
      console.error('Error fetching parents:', parentsResult.error)
    } else {
      setParents(parentsResult.data || [])
    }

    // Last iCal sync timestamp for the header
    const { data: syncRow } = await (supabase as any)
      .from('settings')
      .select('value')
      .eq('key', 'last_ical_sync')
      .maybeSingle()
    if (syncRow?.value) {
      try {
        const parsed = JSON.parse(syncRow.value)
        if (parsed.at) setLastSyncAt(parsed.at)
      } catch {}
    }

    // Load ideas for all events (for badges)
    if (loadedEvents.length > 0) {
      const eventIds = loadedEvents.map((e: any) => e.id)
      const { data: ideas } = await (supabase as any)
        .from('ideas')
        .select('*')
        .in('event_id', eventIds)
        .order('created_at', { ascending: false })

      if (ideas) {
        // Build map: event_id → most recent idea
        const map = new Map<string, IdeaRecord>()
        for (const idea of ideas) {
          if (!map.has(idea.event_id)) {
            map.set(idea.event_id, idea)
          }
        }
        setIdeasMap(map)
      }
    }

    setLoading(false)
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('de-DE', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date)
  }

  function formatDateLong(dateString: string) {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('de-DE', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date)
  }

  function isUpcoming(dateString: string) {
    return new Date(dateString) >= new Date()
  }

  function isPastEvent(dateString: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const event = new Date(dateString)
    event.setHours(0, 0, 0, 0)
    return event.getTime() < today.getTime()
  }

  function getAssignedHelperIds(event: Event): string[] {
    return event.assignments?.map(a => a.helper_id) || []
  }

  function getAssignedHelperNames(event: Event): string {
    const names = event.assignments
      ?.map(a => a.helper?.name)
      .filter(Boolean)
    return names?.length ? names.join(' & ') : 'Niemand'
  }

  function getParentDutyName(event: Event): string {
    const duty = event.parent_duties?.[0]
    return duty?.parent?.name || ''
  }

  function getAssignedParentId(event: Event): string | null {
    return event.parent_duties?.[0]?.parent_id || null
  }

  function sourceLabel(source: string): string {
    switch (source) {
      case 'elterngruppe': return '📨 Elterngruppe'
      case 'manual': return '✍️ Manuell erfasst'
      default: return '💡 Idee'
    }
  }

  function openModal(event: Event) {
    setSelectedEvent(event)
    setSelectedEventIdea(undefined) // undefined = loading
    setNewActivityText('')

    // Load idea for this specific event
    ;(supabase as any)
      .from('ideas')
      .select('*')
      .eq('event_id', event.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }: any) => {
        setSelectedEventIdea(data ?? null) // null = no idea found
      })
  }

  async function toggleHelper(helperId: string) {
    if (!selectedEvent || saving) return
    if (isPastEvent(selectedEvent.event_date)) return

    setSaving(true)
    const assignedIds = getAssignedHelperIds(selectedEvent)
    const isAssigned = assignedIds.includes(helperId)

    try {
      if (isAssigned) {
        const { error } = await supabase
          .from('assignments')
          .delete()
          .eq('event_id', selectedEvent.id)
          .eq('helper_id', helperId)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('assignments')
          .insert({
            event_id: selectedEvent.id,
            helper_id: helperId,
          } as any)

        if (error) throw error
      }

      await refreshSelectedEvent()
    } catch (error: any) {
      showAlert('Fehler: ' + error.message)
    }

    setSaving(false)
  }

  async function toggleParentDuty(parentId: string) {
    if (!selectedEvent || saving) return
    if (isPastEvent(selectedEvent.event_date)) return

    setSaving(true)
    const currentParentId = getAssignedParentId(selectedEvent)

    try {
      if (currentParentId === parentId) {
        const { error } = await (supabase as any)
          .from('parent_duties')
          .delete()
          .eq('event_id', selectedEvent.id)
          .eq('parent_id', parentId)

        if (error) throw error
      } else {
        await (supabase as any)
          .from('parent_duties')
          .delete()
          .eq('event_id', selectedEvent.id)

        const { error } = await (supabase as any)
          .from('parent_duties')
          .insert({
            event_id: selectedEvent.id,
            parent_id: parentId,
          })

        if (error) throw error
      }

      await refreshSelectedEvent()
    } catch (error: any) {
      showAlert('Fehler: ' + error.message)
    }

    setSaving(false)
  }

  async function saveManualActivity() {
    if (!selectedEvent || !newActivityText.trim()) return

    setSavingActivity(true)
    try {
      const { data, error } = await (supabase as any)
        .from('ideas')
        .insert({
          event_id: selectedEvent.id,
          title: newActivityText.trim().slice(0, 200),
          description: newActivityText.trim(),
          was_used: true,
          source: 'manual',
        })
        .select('*')
        .single()

      if (error) throw error

      setSelectedEventIdea(data)
      setIdeasMap(prev => new Map(prev).set(selectedEvent.id, data))
      setNewActivityText('')
    } catch (error: any) {
      showAlert('Fehler: ' + error.message)
    }
    setSavingActivity(false)
  }

  async function loadRotationPreview() {
    setRotationLoading(true)
    try {
      const res = await fetch('/api/rotation/preview', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        showAlert('Fehler: ' + (body.error ?? 'unbekannt'))
        return
      }
      setRotationPreview(body.proposals ?? [])
      setRotationSkipped(body.skipped ?? [])
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    }
    setRotationLoading(false)
  }

  async function commitRotation(testMode: boolean) {
    setRotationCommitting(true)
    try {
      const url = testMode ? '/api/rotation/commit?test=1' : '/api/rotation/commit'
      const res = await fetch(url, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        showAlert('Fehler: ' + (body.error ?? 'unbekannt'))
        return
      }
      if (testMode) {
        showAlert(`Test-Nachricht in den Test-Chat gesendet (${body.proposals?.length ?? 0} Termine).`)
      } else {
        showAlert(`✅ Einteilung gepostet. ${body.inserted ?? 0} Helfer-Slots eingetragen.`)
        setRotationPreview(null)
        await fetchData()
      }
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    }
    setRotationCommitting(false)
  }

  async function refreshSelectedEvent() {
    if (!selectedEvent) return

    await fetchData()

    const { data } = await supabase
      .from('events')
      .select('*, assignments(id, helper_id, helper:helpers(id, name)), parent_duties(id, parent_id, parent:parents(id, name))')
      .eq('id', selectedEvent.id)
      .single()

    if (data) {
      setSelectedEvent(data as any)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tg-button" />
      </div>
    )
  }

  const upcomingEvents = events.filter(e => isUpcoming(e.event_date))
  const pastEvents = events.filter(e => !isUpcoming(e.event_date) && e.event_date >= ARCHIVE_START_DATE)

  return (
    <main className="p-4 safe-area-top safe-area-bottom">
      <div className="flex items-center gap-2 mb-2">
        <Link href="/" className="text-tg-link">←</Link>
        <h1 className="text-xl font-bold">Kalender</h1>
      </div>

      <p className="text-xs text-tg-hint mb-6">
        Letzte Aktualisierung:{' '}
        {lastSyncAt
          ? new Date(lastSyncAt).toLocaleString('de-DE', {
              day: '2-digit', month: '2-digit', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })
          : 'noch nie — bitte in Einstellungen synchronisieren'}
      </p>

      <button
        onClick={loadRotationPreview}
        disabled={rotationLoading}
        className="w-full py-3 mb-6 bg-tg-button text-tg-button-text rounded-lg font-medium disabled:opacity-50"
      >
        {rotationLoading ? 'Berechne…' : '🔄 Einteilung für 12 Wochen vorschlagen'}
      </button>

      {/* Upcoming Events */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Kommende Termine</h2>
        {upcomingEvents.length === 0 ? (
          <p className="text-tg-hint text-center py-8">
            Keine kommenden Termine
          </p>
        ) : (
          <div className="space-y-3">
            {upcomingEvents.slice(0, 5).map((event) => {
              const idea = ideasMap.get(event.id)
              return (
                <div
                  key={event.id}
                  onClick={() => openModal(event)}
                  className="p-4 bg-tg-secondary-bg rounded-xl cursor-pointer active:opacity-80 transition-opacity"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-lg">📅</span>
                        <span className="font-medium">{formatDate(event.event_date)}</span>
                        {idea && (
                          <span className="text-xs bg-green-500/20 text-green-600 px-2 py-0.5 rounded-full font-medium">
                            📋 Log
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-tg-hint mt-2">
                        👥 {getAssignedHelperNames(event)}
                      </p>
                      {getParentDutyName(event) && (
                        <p className="text-xs text-tg-hint mt-1">
                          🍽️ {getParentDutyName(event)}
                        </p>
                      )}
                    </div>
                    <span className="text-tg-hint">›</span>
                  </div>
                </div>
              )
            })}
            {upcomingEvents.length > 5 && (
              <p className="text-xs text-tg-hint text-center pt-1">
                + {upcomingEvents.length - 5} weitere folgen
              </p>
            )}
          </div>
        )}
      </div>

      {pastEvents.length > 0 && (
        <Link
          href="/ideas"
          className="block p-4 bg-tg-secondary-bg rounded-xl active:opacity-70 transition-opacity"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">📋 Vergangene Termine</p>
              <p className="text-xs text-tg-hint mt-1">
                {pastEvents.length} {pastEvents.length === 1 ? 'Termin' : 'Termine'} im Archiv
              </p>
            </div>
            <span className="text-tg-hint">→</span>
          </div>
        </Link>
      )}

      {/* Assignment Modal */}
      {selectedEvent && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="bg-tg-bg w-full rounded-t-2xl p-4 pb-8 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Termin bearbeiten</h2>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-2 text-tg-hint"
              >
                ✕
              </button>
            </div>

            <div className="bg-tg-secondary-bg rounded-xl p-4 mb-6">
              <p className="font-medium">{selectedEvent.title || 'Jungschar'}</p>
              <p className="text-sm text-tg-hint mt-1">
                📅 {formatDateLong(selectedEvent.event_date)}
              </p>
            </div>

            {isPastEvent(selectedEvent.event_date) && (
              <div className="bg-tg-hint/10 border border-tg-hint/20 rounded-xl p-3 mb-6 text-sm text-tg-hint">
                🔒 Termin abgeschlossen — Helfer- und Eltern-Zuweisungen sind eingefroren. Aktivität kannst du weiterhin nachtragen.
              </div>
            )}

            {/* Helfer zuweisen */}
            <p className="text-sm text-tg-hint mb-3">
              👥 Helfer zuweisen:
            </p>

            <div className="space-y-2 mb-6">
              {helpers.map((helper) => {
                const isAssigned = getAssignedHelperIds(selectedEvent).includes(helper.id)
                const locked = isPastEvent(selectedEvent.event_date)
                return (
                  <button
                    key={helper.id}
                    onClick={() => toggleHelper(helper.id)}
                    disabled={saving || locked}
                    className={`w-full p-4 rounded-xl text-left flex items-center justify-between transition-colors ${
                      isAssigned
                        ? 'bg-green-500/20 border-2 border-green-500'
                        : 'bg-tg-secondary-bg border-2 border-transparent'
                    } ${saving || locked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="font-medium">{helper.name}</span>
                    {isAssigned && <span className="text-green-500">✓</span>}
                  </button>
                )
              })}
              {helpers.length === 0 && (
                <p className="text-center text-tg-hint py-4">
                  Keine Helfer vorhanden.
                </p>
              )}
            </div>

            {/* Elterndienst zuweisen */}
            <p className="text-sm text-tg-hint mb-3">
              🍽️ Elterndienst (Essen):
            </p>

            <div className="space-y-2 mb-6">
              {parents.map((parent) => {
                const isAssigned = getAssignedParentId(selectedEvent) === parent.id
                const locked = isPastEvent(selectedEvent.event_date)
                return (
                  <button
                    key={parent.id}
                    onClick={() => toggleParentDuty(parent.id)}
                    disabled={saving || locked}
                    className={`w-full p-4 rounded-xl text-left flex items-center justify-between transition-colors ${
                      isAssigned
                        ? 'bg-orange-500/20 border-2 border-orange-500'
                        : 'bg-tg-secondary-bg border-2 border-transparent'
                    } ${saving || locked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="font-medium">{parent.name}</span>
                    {isAssigned && <span className="text-orange-500">🍽️</span>}
                  </button>
                )
              })}
              {parents.length === 0 && (
                <p className="text-center text-tg-hint py-4">
                  Keine Eltern vorhanden. Füge sie unter &quot;Eltern&quot; hinzu.
                </p>
              )}
            </div>

            {/* Aktivitäts-Log */}
            <div className="border-t border-tg-hint/20 pt-5">
              <p className="text-sm text-tg-hint mb-3">📋 Aktivitäts-Log:</p>

              {selectedEventIdea === undefined ? (
                <div className="flex items-center gap-2 py-3 text-tg-hint text-sm">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-tg-button" />
                  Lädt...
                </div>
              ) : selectedEventIdea ? (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                  <p className="font-medium text-sm whitespace-pre-wrap">
                    ✅ {selectedEventIdea.description || selectedEventIdea.title}
                  </p>
                  <p className="text-xs text-tg-hint mt-1">
                    {sourceLabel(selectedEventIdea.source)} · im Archiv bearbeitbar
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-tg-hint">Noch keine Aktivität erfasst.</p>
                  <textarea
                    value={newActivityText}
                    onChange={(e) => setNewActivityText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        saveManualActivity()
                      }
                    }}
                    placeholder="Was habt ihr gemacht? (Shift+Enter für Absatz)"
                    rows={3}
                    className="w-full px-3 py-2 bg-tg-secondary-bg rounded-lg text-sm outline-none focus:ring-2 focus:ring-tg-button resize-y"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={saveManualActivity}
                      disabled={savingActivity || !newActivityText.trim()}
                      className="px-4 py-1 bg-tg-button text-tg-button-text rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {savingActivity ? '...' : 'Speichern'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rotation-Vorschlag Modal */}
      {rotationPreview && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end"
          onClick={() => !rotationCommitting && setRotationPreview(null)}
        >
          <div
            className="bg-tg-bg w-full rounded-t-2xl p-4 pb-8 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">Einteilungs-Vorschlag</h2>
              <button
                onClick={() => setRotationPreview(null)}
                disabled={rotationCommitting}
                className="p-2 text-tg-hint disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-tg-hint mb-4">
              Algorithmus: weniger eingesetzte Helfer zuerst, Senior+Junior bevorzugt.
              Bestehende Zuweisungen bleiben unangetastet.
            </p>

            {rotationPreview.length === 0 ? (
              <p className="text-tg-hint text-center py-6">
                Keine offenen Slots im 12-Wochen-Fenster.
              </p>
            ) : (
              <div className="space-y-2 mb-5">
                {rotationPreview.map(p => (
                  <div key={p.eventId} className="p-3 bg-tg-secondary-bg rounded-lg">
                    <p className="text-sm font-medium">
                      📅 {new Date(p.eventDate + 'T12:00:00').toLocaleDateString('de-DE', {
                        weekday: 'short', day: '2-digit', month: '2-digit',
                      })}
                    </p>
                    <p className="text-sm mt-1">
                      {p.helpers.map(h => (
                        <span key={h.id} className="inline-block mr-2">
                          {h.isSenior ? '👴 ' : ''}{h.name}
                        </span>
                      ))}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {rotationSkipped.length > 0 && (
              <div className="mb-5 text-xs text-tg-hint">
                <p className="font-medium mb-1">Übersprungen:</p>
                {rotationSkipped.map((s, i) => (
                  <p key={i}>• {s.eventDate}: {s.reason}</p>
                ))}
              </div>
            )}

            {rotationPreview.length > 0 && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={rotationTestMode}
                    onChange={(e) => setRotationTestMode(e.target.checked)}
                  />
                  Test-Modus (Nachricht nur in Test-Chat, keine DB-Änderung)
                </label>
                <button
                  onClick={() => commitRotation(rotationTestMode)}
                  disabled={rotationCommitting}
                  className="w-full py-3 bg-tg-button text-tg-button-text rounded-lg font-medium disabled:opacity-50"
                >
                  {rotationCommitting
                    ? 'Sende…'
                    : rotationTestMode
                      ? '🧪 Test in Test-Chat senden'
                      : '✅ Bestätigen & in Gruppe posten'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
