'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

interface Child {
  id: string
  name: string
  birthday: string | null
  notes: string | null
  active: boolean
}

function formatBirthday(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}

function getNextBirthday(dateStr: string): { date: Date; daysUntil: number } {
  const birthday = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const nextBday = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate())
  if (nextBday < today) {
    nextBday.setFullYear(today.getFullYear() + 1)
  }

  const diffTime = nextBday.getTime() - today.getTime()
  const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return { date: nextBday, daysUntil }
}

export default function ChildrenPage() {
  const { showAlert, showConfirm } = useTelegram()
  const [children, setChildren] = useState<Child[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newBirthday, setNewBirthday] = useState('')

  useEffect(() => {
    fetchChildren()
  }, [])

  async function fetchChildren() {
    const { data, error } = await (supabase as any)
      .from('children')
      .select('*')
      .eq('active', true)
      .order('name')

    if (error) {
      console.error('Error fetching children:', error)
    } else {
      setChildren(data || [])
    }
    setLoading(false)
  }

  async function addChild() {
    if (!newName.trim()) {
      showAlert('Bitte einen Namen eingeben')
      return
    }

    const { error } = await (supabase as any)
      .from('children')
      .insert({
        name: newName.trim(),
        birthday: newBirthday || null,
      })

    if (error) {
      showAlert('Fehler beim Hinzufügen: ' + error.message)
    } else {
      setNewName('')
      setNewBirthday('')
      fetchChildren()
    }
  }

  async function deleteChild(id: string, name: string) {
    const confirmed = await showConfirm(`"${name}" wirklich löschen?`)
    if (!confirmed) return

    const { error } = await (supabase as any)
      .from('children')
      .update({ active: false })
      .eq('id', id)

    if (error) {
      showAlert('Fehler beim Löschen: ' + error.message)
    } else {
      fetchChildren()
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-tg-button" />
      </div>
    )
  }

  // Kinder mit bald-Geburtstag oben sortieren
  const sortedChildren = [...children].sort((a, b) => {
    if (a.birthday && b.birthday) {
      return getNextBirthday(a.birthday).daysUntil - getNextBirthday(b.birthday).daysUntil
    }
    if (a.birthday) return -1
    if (b.birthday) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <main className="p-4 safe-area-top safe-area-bottom">
      <div className="flex items-center gap-2 mb-6">
        <Link href="/" className="text-tg-link">←</Link>
        <h1 className="text-xl font-bold">Kinder verwalten</h1>
      </div>

      {/* Add new child */}
      <div className="space-y-2 mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            className="flex-1 px-4 py-2 bg-tg-secondary-bg rounded-lg outline-none focus:ring-2 focus:ring-tg-button"
          />
          <button
            onClick={addChild}
            className="px-4 py-2 bg-tg-button text-tg-button-text rounded-lg font-medium"
          >
            +
          </button>
        </div>
        <input
          type="date"
          value={newBirthday}
          onChange={(e) => setNewBirthday(e.target.value)}
          className="w-full px-4 py-2 bg-tg-secondary-bg rounded-lg outline-none focus:ring-2 focus:ring-tg-button"
        />
      </div>

      {/* Children list */}
      <div className="space-y-2">
        {sortedChildren.length === 0 ? (
          <p className="text-tg-hint text-center py-8">
            Noch keine Kinder vorhanden
          </p>
        ) : (
          sortedChildren.map((child) => {
            const bday = child.birthday ? getNextBirthday(child.birthday) : null
            const isSoon = bday && bday.daysUntil <= 14
            const isToday = bday && bday.daysUntil === 0

            return (
              <div
                key={child.id}
                className={`flex items-center justify-between p-4 bg-tg-secondary-bg rounded-xl ${
                  isToday ? 'ring-2 ring-yellow-500' : ''
                }`}
              >
                <div>
                  <p className="font-medium">
                    {child.name}
                    {isToday && ' 🎂'}
                  </p>
                  {child.birthday && (
                    <p className={`text-sm ${isSoon ? 'text-yellow-500 font-medium' : 'text-tg-hint'}`}>
                      🎂 {formatBirthday(child.birthday)}
                      {bday && !isToday && isSoon && ` (in ${bday.daysUntil} Tagen)`}
                      {isToday && ' — Heute!'}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => deleteChild(child.id, child.name)}
                  className="text-red-500 p-2"
                >
                  🗑️
                </button>
              </div>
            )
          })
        )}
      </div>
    </main>
  )
}
