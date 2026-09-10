'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { Badge, Button, Empty, List, Loading, Page, Row } from '@/components/ui'

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

  if (loading) return <Loading />

  return (
    <Page
      title="Helfer"
      back="/"
      accent="helpers"
      subtitle="Neue Helfer registrieren sich im Bot mit /register."
    >
      {helpers.length === 0 ? (
        <Empty>Noch keine Helfer vorhanden</Empty>
      ) : (
        <List>
          {helpers.map((helper) => (
            <Row key={helper.id} className="items-start">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{helper.name}</p>
                <p className="text-sm text-muted">
                  {helper.telegram_username ? `@${helper.telegram_username}` : 'ohne Telegram-Name'}
                  {!helper.telegram_user_id && ' · nicht verknüpft'}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {helper.is_admin && <Badge tone="accent">Admin</Badge>}
                  <Badge tone={helper.is_senior ? 'warn' : 'outline'} onClick={() => toggleSenior(helper)}>
                    Senior
                  </Badge>
                </div>
              </div>
              <Button variant="danger" size="sm" onClick={() => deleteHelper(helper.id, helper.name)}>
                Löschen
              </Button>
            </Row>
          ))}
        </List>
      )}
    </Page>
  )
}
