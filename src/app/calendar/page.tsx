'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
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

export default function CalendarPage() {
  const { showAlert } = useTelegram()
  const [events, setEvents] = useState<Event[]>([])
  const [helpers, setHelpers] = useState<Helper[]>([])
  const [parents, setParents] = useState<Parent[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [saving, setSaving] = useState(false)

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

    if (eventsResult.error) {
      console.error('Error fetching events:', eventsResult.error)
      showAlert('Fehler beim Laden der Events')
    } else {
      setEvents(eventsResult.data as any || [])
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

  async function toggleHelper(helperId: string) {
    if (!selectedEvent || saving) return

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

    setSaving(true)
    const currentParentId = getAssignedParentId(selectedEvent)

    try {
      if (currentParentId === parentId) {
        // Zuweisung entfernen
        const { error } = await (supabase as any)
          .from('parent_duties')
          .delete()
          .eq('event_id', selectedEvent.id)
          .eq('parent_id', parentId)

        if (error) throw error
      } else {
        // Alte Zuweisung entfernen, neue setzen
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
  const pastEvents = events.filter(e => !isUpcoming(e.event_date))

  return (
    <main className="p-4 safe-area-top safe-area-bottom">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/" className="text-tg-link">←</Link>
        <h1 className="text-xl font-bold">Kalender</h1>
      </div>

      {/* Upcoming Events */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Kommende Termine</h2>
        {upcomingEvents.length === 0 ? (
          <p className="text-tg-hint text-center py-8">
            Keine kommenden Termine
          </p>
        ) : (
          <div className="space-y-3">
            {upcomingEvents.map((event) => (
              <div
                key={event.id}
                onClick={() => setSelectedEvent(event)}
                className="p-4 bg-tg-secondary-bg rounded-xl cursor-pointer active:opacity-80 transition-opacity"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📅</span>
                      <span className="font-medium">{formatDate(event.event_date)}</span>
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
            ))}
          </div>
        )}
      </div>

      {/* Past Events */}
      {pastEvents.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Vergangene Termine</h2>
          <div className="space-y-3 opacity-60">
            {pastEvents.slice(-5).reverse().map((event) => (
              <div
                key={event.id}
                className="p-4 bg-tg-secondary-bg rounded-xl"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">📅</span>
                  <span className="font-medium">{formatDate(event.event_date)}</span>
                </div>
                <p className="text-sm text-tg-hint mt-2">
                  👥 {getAssignedHelperNames(event)}
                </p>
              </div>
            ))}
          </div>
        </div>
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

            {/* Helfer zuweisen */}
            <p className="text-sm text-tg-hint mb-3">
              👥 Helfer zuweisen:
            </p>

            <div className="space-y-2 mb-6">
              {helpers.map((helper) => {
                const isAssigned = getAssignedHelperIds(selectedEvent).includes(helper.id)
                return (
                  <button
                    key={helper.id}
                    onClick={() => toggleHelper(helper.id)}
                    disabled={saving}
                    className={`w-full p-4 rounded-xl text-left flex items-center justify-between transition-colors ${
                      isAssigned
                        ? 'bg-green-500/20 border-2 border-green-500'
                        : 'bg-tg-secondary-bg border-2 border-transparent'
                    } ${saving ? 'opacity-50' : ''}`}
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

            <div className="space-y-2">
              {parents.map((parent) => {
                const isAssigned = getAssignedParentId(selectedEvent) === parent.id
                return (
                  <button
                    key={parent.id}
                    onClick={() => toggleParentDuty(parent.id)}
                    disabled={saving}
                    className={`w-full p-4 rounded-xl text-left flex items-center justify-between transition-colors ${
                      isAssigned
                        ? 'bg-orange-500/20 border-2 border-orange-500'
                        : 'bg-tg-secondary-bg border-2 border-transparent'
                    } ${saving ? 'opacity-50' : ''}`}
                  >
                    <span className="font-medium">{parent.name}</span>
                    {isAssigned && <span className="text-orange-500">🍽️</span>}
                  </button>
                )
              })}
              {parents.length === 0 && (
                <p className="text-center text-tg-hint py-4">
                  Keine Eltern vorhanden. Füge sie unter "Eltern" hinzu.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
