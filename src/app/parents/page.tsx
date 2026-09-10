'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { Button, Disclosure, Empty, IconButton, Input, List, Loading, Page, Row, Section, SmallIcons } from '@/components/ui'

interface Parent {
  id: string
  name: string
  telegram_username: string | null
  telegram_user_id: number | null
  active: boolean
}

function stripAt(s: string): string {
  return s.trim().replace(/^@+/, '')
}

/** Telegram-ID aus Eingabe: nur Ziffern, sonst null. */
function parseTgId(s: string): number | null {
  const digits = s.replace(/\D/g, '')
  return digits ? Number(digits) : null
}

function telegramLabel(p: Parent): string {
  if (p.telegram_username) return `@${p.telegram_username}`
  if (p.telegram_user_id) return `Telegram-ID ${p.telegram_user_id}`
  return 'ohne Telegram, wird nicht getaggt'
}

export default function ParentsPage() {
  const { showAlert, showConfirm } = useTelegram()
  const [parents, setParents] = useState<Parent[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newTag, setNewTag] = useState('')
  const [newTgId, setNewTgId] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTag, setEditTag] = useState('')
  const [editTgId, setEditTgId] = useState('')

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
        telegram_user_id: parseTgId(newTgId),
      })

    if (error) {
      showAlert('Fehler beim Hinzufügen: ' + error.message)
    } else {
      setNewName('')
      setNewTag('')
      setNewTgId('')
      setAdding(false)
      fetchParents()
    }
  }

  function startEdit(parent: Parent) {
    setEditingId(parent.id)
    setEditTag(parent.telegram_username || '')
    setEditTgId(parent.telegram_user_id ? String(parent.telegram_user_id) : '')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditTag('')
    setEditTgId('')
  }

  async function saveEdit(parentId: string) {
    const { error } = await (supabase as any)
      .from('parents')
      .update({
        telegram_username: stripAt(editTag) || null,
        telegram_user_id: parseTgId(editTgId),
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
    <Page title="Eltern" back="/" accent="parents">
      <Disclosure label="Eltern hinzufügen" open={adding} onOpenChange={setAdding}>
        <div className="space-y-2">
          <Input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name, z.B. Familie Müller"
            autoFocus
          />
          <Input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="Telegram-Name, optional"
          />
          <Input
            type="text"
            inputMode="numeric"
            value={newTgId}
            onChange={(e) => setNewTgId(e.target.value)}
            placeholder="Telegram-ID, falls kein Name"
          />
          <p className="text-xs text-muted">Mit Name oder ID wird die Person in den Reminder-Nachrichten getaggt.</p>
          <Button variant="primary" block onClick={addParent}>Hinzufügen</Button>
        </div>
      </Disclosure>

      <Section title={`${parents.length} Eltern`}>
        {parents.length === 0 ? (
          <Empty>Noch keine Eltern vorhanden</Empty>
        ) : (
          <List>
            {parents.map((parent) => {
              const isEditing = editingId === parent.id
              if (isEditing) {
                return (
                  <div key={parent.id} className="space-y-2 px-4 py-3">
                    <p className="font-medium">{parent.name}</p>
                    <Input
                      type="text"
                      value={editTag}
                      onChange={(e) => setEditTag(e.target.value)}
                      placeholder="Telegram-Name, z.B. muellerfamily"
                      autoFocus
                    />
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={editTgId}
                      onChange={(e) => setEditTgId(e.target.value)}
                      placeholder="Telegram-ID, falls kein Name"
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
                    <p className="text-sm text-muted">{telegramLabel(parent)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <IconButton label="Bearbeiten" onClick={() => startEdit(parent)}>
                      <SmallIcons.pencil />
                    </IconButton>
                    <IconButton label="Löschen" tone="danger" onClick={() => deleteParent(parent.id, parent.name)}>
                      <SmallIcons.trash />
                    </IconButton>
                  </div>
                </Row>
              )
            })}
          </List>
        )}
      </Section>
    </Page>
  )
}
