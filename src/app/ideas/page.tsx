'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

interface Activity {
  id: string
  title: string
  description: string | null
  was_used: boolean
  source: string
  created_at: string
  event: {
    id: string
    event_date: string
    title: string | null
  } | null
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'elterngruppe': return '📨 Elterngruppe'
    case 'manual': return '✍️ Manuell'
    default: return '💡 Idee'
  }
}

export default function IdeasPage() {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchActivities()
  }, [])

  async function fetchActivities() {
    const { data, error } = await (supabase as any)
      .from('ideas')
      .select('*, event:events(id, event_date, title)')
      .eq('was_used', true)
      .order('created_at', { ascending: false })

    if (!error) setActivities(data || [])
    setLoading(false)
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
        <h1 className="text-xl font-bold">Aktivitäten</h1>
      </div>

      <p className="text-sm text-tg-hint mb-5">
        {activities.length} {activities.length === 1 ? 'Aktivität' : 'Aktivitäten'} erfasst
      </p>

      <div className="space-y-3">
        {activities.length === 0 ? (
          <p className="text-tg-hint text-center py-8">
            Noch keine Aktivitäten erfasst.{'\n'}
            Füge den Bot zur Elterngruppe hinzu oder trage Aktivitäten manuell im Kalender ein.
          </p>
        ) : (
          activities.map((activity) => (
            <div
              key={activity.id}
              className="p-4 bg-tg-secondary-bg rounded-xl border-l-4 border-green-500"
            >
              <p className="font-medium leading-snug">✅ {activity.title}</p>
              {activity.event && (
                <p className="text-xs text-tg-hint mt-1">
                  📅 {formatDate(activity.event.event_date)}
                </p>
              )}
              <p className="text-xs text-tg-hint mt-1">
                {sourceLabel(activity.source)}
              </p>
            </div>
          ))
        )}
      </div>
    </main>
  )
}
