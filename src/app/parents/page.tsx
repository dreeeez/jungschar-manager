'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { Button, Empty, Input, List, Loading, Page, Row, Section } from '@/components/ui'

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

  if (loading) return <Loading />

  return (
    <Page title="Eltern" back="/">
      <Section title="Hinzufügen">
        <div className="space-y-2">
          <Input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name, z.B. Familie Müller"
          />
          <div className="flex gap-2">
            <Input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="Telegram-Name, optional"
              className="flex-1"
            />
            <Button variant="primary" onClick={addParent}>Hinzufügen</Button>
          </div>
        </div>
      </Section>

      <Section title={`${parents.length} Eltern`}>
        {parents.length === 0 ? (
          <Empty>Noch keine Eltern vorhanden</Empty>
        ) : (
          <List>
            {parents.map((parent) => {
              const isEditing = editingId === parent.id
              if (isEditing) {
                return (
                  <div key={parent.id} className="space-y-2 py-3">
                    <p className="font-medium">{parent.name}</p>
                    <Input
                      type="text"
                      value={editTag}
                      onChange={(e) => setEditTag(e.target.value)}
                      placeholder="Telegram-Name, z.B. muellerfamily"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={cancelEdit}>Abbrechen</Button>
                      <Button variant="primary" size="sm" onClick={() => saveEdit(parent.id)}>Speichern</Button>
                    </div>
                  </div>
                )
              }
              return (
                <Row key={parent.id}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{parent.name}</p>
                    <p className="text-sm text-muted">
                      {parent.telegram_username ? `@${parent.telegram_username}` : 'ohne Telegram-Name'}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => startEdit(parent)}>Bearbeiten</Button>
                  <Button variant="danger" size="sm" onClick={() => deleteParent(parent.id, parent.name)}>Löschen</Button>
                </Row>
              )
            })}
          </List>
        )}
      </Section>
    </Page>
  )
}
