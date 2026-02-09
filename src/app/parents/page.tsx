'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

interface Parent {
  id: string
  name: string
  phone: string | null
  active: boolean
}

export default function ParentsPage() {
  const { showAlert, showConfirm } = useTelegram()
  const [parents, setParents] = useState<Parent[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')

  useEffect(() => {
    fetchParents()
  }, [])

  async function fetchParents() {
    const { data, error } = await (supabase as any)
      .from('parents')
      .select('*')
      .eq('active', true)
      .order('name')

    if (error) {
      console.error('Error fetching parents:', error)
    } else {
      setParents(data || [])
    }
    setLoading(false)
  }

  async function addParent() {
    if (!newName.trim()) {
      showAlert('Bitte einen Namen eingeben')
      return
    }

    const { error } = await (supabase as any)
      .from('parents')
      .insert({ name: newName.trim(), phone: newPhone.trim() || null })

    if (error) {
      showAlert('Fehler beim Hinzufügen: ' + error.message)
    } else {
      setNewName('')
      setNewPhone('')
      fetchParents()
    }
  }

  async function deleteParent(id: string, name: string) {
    const confirmed = await showConfirm(`"${name}" wirklich löschen?`)
    if (!confirmed) return

    const { error } = await (supabase as any)
      .from('parents')
      .update({ active: false })
      .eq('id', id)

    if (error) {
      showAlert('Fehler beim Löschen: ' + error.message)
    } else {
      fetchParents()
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
        <h1 className="text-xl font-bold">Eltern verwalten</h1>
      </div>

      {/* Add new parent */}
      <div className="space-y-2 mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (z.B. Familie Müller)"
            className="flex-1 px-4 py-2 bg-tg-secondary-bg rounded-lg outline-none focus:ring-2 focus:ring-tg-button"
          />
          <button
            onClick={addParent}
            className="px-4 py-2 bg-tg-button text-tg-button-text rounded-lg font-medium"
          >
            +
          </button>
        </div>
        <input
          type="tel"
          value={newPhone}
          onChange={(e) => setNewPhone(e.target.value)}
          placeholder="Telefon (optional)"
          className="w-full px-4 py-2 bg-tg-secondary-bg rounded-lg outline-none focus:ring-2 focus:ring-tg-button"
        />
      </div>

      {/* Parent list */}
      <div className="space-y-2">
        {parents.length === 0 ? (
          <p className="text-tg-hint text-center py-8">
            Noch keine Eltern vorhanden
          </p>
        ) : (
          parents.map((parent) => (
            <div
              key={parent.id}
              className="flex items-center justify-between p-4 bg-tg-secondary-bg rounded-xl"
            >
              <div>
                <p className="font-medium">{parent.name}</p>
                {parent.phone && (
                  <p className="text-sm text-tg-hint">{parent.phone}</p>
                )}
              </div>
              <button
                onClick={() => deleteParent(parent.id, parent.name)}
                className="text-red-500 p-2"
              >
                🗑️
              </button>
            </div>
          ))
        )}
      </div>
    </main>
  )
}
