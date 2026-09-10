'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { Badge, Button, Disclosure, Empty, IconButton, Input, List, Loading, Page, Row, Section, SmallIcons } from '@/components/ui'

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
  const [adding, setAdding] = useState(false)

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
      setAdding(false)
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

  if (loading) return <Loading />

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
    <Page title="Kinder" back="/" accent="children">
      <Disclosure label="Kind hinzufügen" open={adding} onOpenChange={setAdding}>
        <div className="space-y-2">
          <Input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            autoFocus
          />
          <Input
            type="date"
            value={newBirthday}
            onChange={(e) => setNewBirthday(e.target.value)}
          />
          <Button variant="primary" block onClick={addChild}>Hinzufügen</Button>
        </div>
      </Disclosure>

      <Section title={`${sortedChildren.length} Kinder`}>
        {sortedChildren.length === 0 ? (
          <Empty>Noch keine Kinder vorhanden</Empty>
        ) : (
          <List>
            {sortedChildren.map((child) => {
              const bday = child.birthday ? getNextBirthday(child.birthday) : null
              const isSoon = !!bday && bday.daysUntil <= 14
              const isToday = !!bday && bday.daysUntil === 0

              return (
                <Row key={child.id}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{child.name}</p>
                    {child.birthday && (
                      <p className="text-sm text-muted">{formatBirthday(child.birthday)}</p>
                    )}
                  </div>
                  {isToday ? (
                    <Badge tone="success">Heute</Badge>
                  ) : isSoon && bday ? (
                    <Badge tone="warn">in {bday.daysUntil} Tagen</Badge>
                  ) : null}
                  <IconButton label="Löschen" tone="danger" onClick={() => deleteChild(child.id, child.name)}>
                    <SmallIcons.trash />
                  </IconButton>
                </Row>
              )
            })}
          </List>
        )}
      </Section>
    </Page>
  )
}
