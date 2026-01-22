'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

interface Event {
  id: string
  event_date: string
  title: string | null
  description: string | null
  imported_at: string
}

export default function CalendarPage() {
  const { showAlert } = useTelegram()
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchEvents()
  }, [])

  async function fetchEvents() {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('event_date', { ascending: true })

    if (error) {
      console.error('Error fetching events:', error)
      showAlert('Fehler beim Laden der Events')
    } else {
      setEvents(data || [])
    }
    setLoading(false)
  }

  function formatDate(dateString: string) {
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
                className="p-4 bg-tg-secondary-bg rounded-xl"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="font-medium">{event.title || 'Jungschar'}</p>
                    <p className="text-sm text-tg-hint mt-1">
                      📅 {formatDate(event.event_date)}
                    </p>
                    {event.description && (
                      <p className="text-sm text-tg-hint mt-2">
                        {event.description}
                      </p>
                    )}
                  </div>
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
                <p className="font-medium">{event.title || 'Jungschar'}</p>
                <p className="text-sm text-tg-hint mt-1">
                  📅 {formatDate(event.event_date)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
