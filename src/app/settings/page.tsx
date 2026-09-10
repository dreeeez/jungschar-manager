'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { Button, Card, Input, Label, Loading, Page, Section } from '@/components/ui'

interface LastSync {
  at: string
  result: {
    fetched: number
    jungscharFound: number
    inserted: number
    skipped: number
    errors: string[]
  }
}

export default function SettingsPage() {
  const { showAlert } = useTelegram()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [city, setCity] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [icalUrl, setIcalUrl] = useState('')
  const [lastSync, setLastSync] = useState<LastSync | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  async function fetchSettings() {
    const { data } = await (supabase as any)
      .from('settings')
      .select('key, value')
      .in('key', ['weather_location', 'ical_url', 'last_ical_sync'])

    for (const row of (data ?? []) as { key: string; value: string }[]) {
      if (row.key === 'weather_location' && row.value) {
        try {
          const location = JSON.parse(row.value)
          setCity(location.city || '')
          setLatitude(String(location.latitude || ''))
          setLongitude(String(location.longitude || ''))
        } catch {}
      } else if (row.key === 'ical_url') {
        setIcalUrl(row.value || '')
      } else if (row.key === 'last_ical_sync' && row.value) {
        try {
          setLastSync(JSON.parse(row.value))
        } catch {}
      }
    }
    setLoading(false)
  }

  async function syncIcal() {
    setSyncing(true)
    try {
      const res = await fetch('/api/sync-ical', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        showAlert('Sync fehlgeschlagen: ' + (body.errors?.join(', ') || 'Unbekannter Fehler'))
      } else {
        showAlert(`Sync OK: ${body.inserted} neu, ${body.skipped} bereits vorhanden`)
        setLastSync({ at: new Date().toISOString(), result: body })
      }
    } catch (e: any) {
      showAlert('Sync fehlgeschlagen: ' + e.message)
    }
    setSyncing(false)
  }

  function formatSyncTime(iso: string): string {
    return new Date(iso).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  async function saveLocation() {
    if (!city.trim() || !latitude.trim() || !longitude.trim()) {
      showAlert('Bitte alle Felder ausfüllen')
      return
    }

    const lat = parseFloat(latitude)
    const lon = parseFloat(longitude)

    if (isNaN(lat) || isNaN(lon)) {
      showAlert('Latitude und Longitude müssen Zahlen sein')
      return
    }

    setSaving(true)

    const value = JSON.stringify({ city: city.trim(), latitude: lat, longitude: lon })

    // Prüfe ob Eintrag existiert
    const { data: existing } = await (supabase as any)
      .from('settings')
      .select('id')
      .eq('key', 'weather_location')
      .single()

    let error
    if (existing) {
      const result = await (supabase as any)
        .from('settings')
        .update({ value })
        .eq('key', 'weather_location')
      error = result.error
    } else {
      const result = await (supabase as any)
        .from('settings')
        .insert({ key: 'weather_location', value })
      error = result.error
    }

    if (error) {
      showAlert('Fehler beim Speichern: ' + error.message)
    } else {
      showAlert('Standort gespeichert')
    }

    setSaving(false)
  }

  if (loading) {
    return <Loading />
  }

  return (
    <Page back="/" title="Einstellungen" accent="settings">
      <Section title="Termin-Sync" hint="Holt neue Jungschar-Termine aus dem Kalender-Feed. Läuft automatisch am 1. des Monats.">
        <Card className="space-y-3">
          {lastSync ? (
            <div className="text-sm">
              <p className="font-medium">Letzter Sync: {formatSyncTime(lastSync.at)}</p>
              <p className="text-muted">
                {lastSync.result.jungscharFound} im Feed, {lastSync.result.inserted} neu, {lastSync.result.skipped} vorhanden
              </p>
              {lastSync.result.errors?.length > 0 && (
                <p className="mt-1 text-danger">{lastSync.result.errors.join(', ')}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Noch nie synchronisiert.</p>
          )}
          {icalUrl && <p className="break-all text-xs text-muted">{icalUrl}</p>}
          <Button variant="primary" block onClick={syncIcal} disabled={syncing}>
            {syncing ? 'Synchronisiere …' : 'Jetzt synchronisieren'}
          </Button>
        </Card>
      </Section>

      <Section title="Wetter-Standort" hint="Für die Wettervorhersage in den Remindern.">
        <Card className="space-y-3">
          <div>
            <Label>Stadt</Label>
            <Input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="z.B. Zürich" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Breitengrad</Label>
              <Input type="text" inputMode="decimal" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="47.37" />
            </div>
            <div>
              <Label>Längengrad</Label>
              <Input type="text" inputMode="decimal" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="8.54" />
            </div>
          </div>
          <Button variant="primary" block onClick={saveLocation} disabled={saving}>
            {saving ? 'Speichern …' : 'Standort speichern'}
          </Button>
        </Card>
      </Section>
    </Page>
  )
}
