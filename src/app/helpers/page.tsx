'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { Badge, Button, CheckRow, ChevronRight, Empty, List, Loading, Page, Row, Sheet } from '@/components/ui'

interface Helper {
  id: string
  name: string
  telegram_user_id: number | null
  telegram_username: string | null
  is_admin: boolean
  is_senior: boolean
  is_ateam: boolean
}

export default function HelpersPage() {
  const { showAlert, showConfirm } = useTelegram()
  const [helpers, setHelpers] = useState<Helper[]>([])
  const [loading, setLoading] = useState(true)
  /** Helfer im Bearbeiten-Fenster (Senior, A-Team, Löschen). */
  const [editingId, setEditingId] = useState<string | null>(null)
  const editing = helpers.find(h => h.id === editingId) ?? null

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

  /** A-Team (Work and Travel): kommt in der Einteilung nur gemeinsam als Duo dran. */
  async function toggleATeam(helper: Helper) {
    const next = !helper.is_ateam
    setHelpers(prev => prev.map(h => h.id === helper.id ? { ...h, is_ateam: next } : h))
    const { error } = await (supabase as any)
      .from('helpers')
      .update({ is_ateam: next })
      .eq('id', helper.id)
    if (error) {
      showAlert('Fehler: ' + error.message)
      setHelpers(prev => prev.map(h => h.id === helper.id ? { ...h, is_ateam: helper.is_ateam } : h))
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
      setEditingId(null)
      fetchHelpers()
    }
  }

  if (loading) return <Loading />

  return (
    <Page
      title="Helfer"
      back="/"
      accent="helpers"
      subtitle="Neue Helfer registrieren sich im Bot mit /register. Antippen zum Bearbeiten."
    >
      {helpers.length === 0 ? (
        <Empty>Noch keine Helfer vorhanden</Empty>
      ) : (
        <List>
          {helpers.map((helper) => (
            <Row key={helper.id} onClick={() => setEditingId(helper.id)}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{helper.name}</p>
                <p className="text-sm text-muted">
                  {helper.telegram_username ? `@${helper.telegram_username}` : 'ohne Telegram-Name'}
                  {!helper.telegram_user_id && ' · nicht verknüpft'}
                </p>
                {(helper.is_admin || helper.is_senior || helper.is_ateam) && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {helper.is_admin && <Badge tone="accent">Admin</Badge>}
                    {helper.is_senior && <Badge tone="warn">Senior</Badge>}
                    {helper.is_ateam && <Badge tone="violet">A-Team</Badge>}
                  </div>
                )}
              </div>
              <ChevronRight />
            </Row>
          ))}
        </List>
      )}

      <Sheet open={!!editing} onClose={() => setEditingId(null)} title={editing?.name ?? 'Helfer'}>
        {editing && (
          <>
            <List className="mb-2">
              <CheckRow label="Senior" checked={editing.is_senior} onClick={() => toggleSenior(editing)} />
              <CheckRow label="A-Team (Work and Travel)" checked={editing.is_ateam} onClick={() => toggleATeam(editing)} />
            </List>
            <p className="mb-5 px-1 text-xs text-muted">
              Einteilung: immer Senior + Junior. A-Team kommt nur gemeinsam als Duo dran.
            </p>
            <Button variant="danger" block onClick={() => deleteHelper(editing.id, editing.name)}>
              Helfer löschen
            </Button>
          </>
        )}
      </Sheet>
    </Page>
  )
}
