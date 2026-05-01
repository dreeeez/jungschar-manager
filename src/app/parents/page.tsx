'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

interface Parent {
  id: string
  name: string
  telegram_username: string | null
  active: boolean
}

function stripAt(s: string): string {
  return s.trim().replace(/^@+/, '')
}

export default function ParentsPage() {
  const { showAlert, showConfirm } = useTelegram()
  const [parents, setParents] = useState<Parent[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newTag, setNewTag] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTag, setEditTag] = useState('')

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
      .insert({
        name: newName.trim(),
        telegram_username: stripAt(newTag) || null,
      })

    if (error) {
      showAlert('Fehler beim Hinzufügen: ' + error.message)
    } else {
      setNewName('')
      setNewTag('')
      fetchParents()
    }
  }

  function startEdit(parent: Parent) {
    setEditingId(parent.id)
    setEditTag(parent.telegram_username || '')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditTag('')
  }

  async function saveEdit(parentId: string) {
    const { error } = await (supabase as any)
      .from('parents')
      .update({
        telegram_username: stripAt(editTag) || null,
      })
      .eq('id', parentId)

    if (error) {
      showAlert('Fehler beim Speichern: ' + error.message)
      return
    }
    cancelEdit()
    fetchParents()
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
          type="text"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          placeholder="Telegram-Tag, z.B. @muellerfamily (optional)"
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
          parents.map((parent) => {
            const isEditing = editingId === parent.id
            return (
              <div
                key={parent.id}
                className="p-4 bg-tg-secondary-bg rounded-xl"
              >
                {!isEditing ? (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{parent.name}</p>
                      {parent.telegram_username ? (
                        <p className="text-sm text-tg-link">@{parent.telegram_username}</p>
                      ) : (
                        <p className="text-sm text-tg-hint italic">kein Telegram-Tag</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(parent)}
                        className="text-tg-link p-2"
                        aria-label="Bearbeiten"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => deleteParent(parent.id, parent.name)}
                        className="text-red-500 p-2"
                        aria-label="Löschen"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="font-medium">{parent.name}</p>
                    <input
                      type="text"
                      value={editTag}
                      onChange={(e) => setEditTag(e.target.value)}
                      placeholder="Telegram-Tag, z.B. @muellerfamily"
                      className="w-full px-3 py-2 bg-tg-bg rounded-lg outline-none focus:ring-2 focus:ring-tg-button text-sm"
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1.5 text-sm text-tg-hint"
                      >
                        Abbrechen
                      </button>
                      <button
                        onClick={() => saveEdit(parent.id)}
                        className="px-3 py-1.5 text-sm bg-tg-button text-tg-button-text rounded-lg font-medium"
                      >
                        Speichern
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </main>
  )
}
