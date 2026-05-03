'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

interface Helper {
  id: string
  name: string
  telegram_user_id: number | null
  telegram_username: string | null
  is_admin: boolean
  is_senior: boolean
}

export default function HelpersPage() {
  const { showAlert, showConfirm } = useTelegram()
  const [helpers, setHelpers] = useState<Helper[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchHelpers()
  }, [])

  async function fetchHelpers() {
    const { data, error } = await supabase
      .from('helpers')
      .select('*')
      .order('name')

    if (error) {
      console.error('Error fetching helpers:', error)
    } else {
      setHelpers(data || [])
    }
    setLoading(false)
  }

  async function toggleSenior(helper: Helper) {
    const next = !helper.is_senior
    setHelpers(prev => prev.map(h => h.id === helper.id ? { ...h, is_senior: next } : h))
    const { error } = await (supabase as any)
      .from('helpers')
      .update({ is_senior: next })
      .eq('id', helper.id)
    if (error) {
      showAlert('Fehler: ' + error.message)
      setHelpers(prev => prev.map(h => h.id === helper.id ? { ...h, is_senior: helper.is_senior } : h))
    }
  }

  async function deleteHelper(id: string, name: string) {
    const confirmed = await showConfirm(`"${name}" wirklich löschen?`)
    if (!confirmed) return

    const { error } = await supabase
      .from('helpers')
      .delete()
      .eq('id', id)

    if (error) {
      showAlert('Fehler beim Löschen: ' + error.message)
    } else {
      fetchHelpers()
    }
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
        <h1 className="text-xl font-bold">Helfer verwalten</h1>
      </div>

      {/* Hinweis: neue Helfer registrieren sich selbst per /register im Bot */}
      <p className="text-sm text-tg-hint mb-6">
        Neue Helfer registrieren sich selbst im Bot mit <b>/register</b>.
      </p>

      {/* Helper list */}
      <div className="space-y-2">
        {helpers.length === 0 ? (
          <p className="text-tg-hint text-center py-8">
            Noch keine Helfer vorhanden
          </p>
        ) : (
          helpers.map((helper) => (
            <div
              key={helper.id}
              className="flex items-center justify-between p-4 bg-tg-secondary-bg rounded-xl"
            >
              <div className="flex-1">
                <p className="font-medium">{helper.name}</p>
                {helper.telegram_username && (
                  <p className="text-sm text-tg-hint">@{helper.telegram_username}</p>
                )}
                <div className="flex gap-1.5 mt-1 flex-wrap">
                  {helper.is_admin && (
                    <span className="text-xs bg-tg-button text-tg-button-text px-2 py-0.5 rounded">
                      Admin
                    </span>
                  )}
                  <button
                    onClick={() => toggleSenior(helper)}
                    className={`text-xs px-2 py-0.5 rounded ${
                      helper.is_senior
                        ? 'bg-amber-500/20 text-amber-700'
                        : 'bg-tg-bg text-tg-hint border border-tg-hint/20'
                    }`}
                  >
                    {helper.is_senior ? '👴 Senior' : '+ Senior'}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {helper.telegram_user_id ? (
                  <span className="text-green-500">✓</span>
                ) : (
                  <span className="text-tg-hint text-sm">Nicht verknüpft</span>
                )}
                <button
                  onClick={() => deleteHelper(helper.id, helper.name)}
                  className="text-red-500 p-2"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  )
}
