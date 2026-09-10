'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { Badge, Button, Input, Label, List, Loading, Note, Page, Row, Section } from '@/components/ui'

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
  const [botStatus, setBotStatus] = useState<any>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  useEffect(() => {
    fetchSettings()
    fetchBotStatus()
  }, [])

  async function fetchBotStatus() {
    setStatusLoading(true)
    try {
      const res = await fetch('/api/status')
      const body = await res.json()
      if (res.ok) setBotStatus(body)
    } catch {
      // Status ist optional — bei Fehler bleibt die Karte leer.
    }
    setStatusLoading(false)
  }

  function fmtShort(iso: string): string {
    const d = new Date(iso + 'T12:00:00')
    const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]
    return `${wd} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
  }

  function stageLabel(t: string): string {
    if (t === 'stage1_sunday') return 'So'
    if (t === 'stage2_wednesday') return 'Mi'
    if (t === 'stage3_saturday') return 'Sa'
    return t
  }

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

  const driftClean =
    botStatus &&
    botStatus.drift.staleInDb.length === 0 &&
    botStatus.drift.missingFromDb.length === 0

  return (
    <Page back="/" title="Einstellungen">
      {/* Bot-Status (read-only) */}
      <Section
        title="Bot-Status"
        hint="Überblick über kommende Termine, Abgleich mit dem Kalender-Feed und Reminder-Status. Sendet nichts."
        action={
          <Button variant="ghost" size="sm" onClick={fetchBotStatus} disabled={statusLoading}>
            {statusLoading ? 'Lädt …' : 'Aktualisieren'}
          </Button>
        }
      >
        {!botStatus && statusLoading && <p className="text-sm text-muted">Lädt …</p>}

        {botStatus && (
          <div className="space-y-3">
            {/* Feed-Status */}
            {botStatus.calendar.feedReachable ? (
              <p className="text-sm text-muted">
                Feed erreichbar, {botStatus.calendar.feedJungscharCount} Jungschar-Termine
              </p>
            ) : (
              <Note tone="danger">
                Feed nicht erreichbar. Reminder laufen fail-safe normal weiter.
              </Note>
            )}

            {/* Drift */}
            {botStatus.calendar.feedReachable &&
              (driftClean ? (
                <p className="text-sm text-muted">Kalender und Datenbank stimmen überein</p>
              ) : (
                <div className="space-y-2">
                  {botStatus.drift.staleInDb.length > 0 && (
                    <Note tone="danger">
                      {botStatus.drift.staleInDb.length} Termin(e) in der Datenbank, aber nicht (mehr) im Feed:{' '}
                      {botStatus.drift.staleInDb.map(fmtShort).join(', ')}
                    </Note>
                  )}
                  {botStatus.drift.missingFromDb.length > 0 && (
                    <Note>
                      {botStatus.drift.missingFromDb.length} Feed-Termin(e) noch nicht in der Datenbank:{' '}
                      {botStatus.drift.missingFromDb.map(fmtShort).join(', ')}
                    </Note>
                  )}
                </div>
              ))}

            {/* Kommende Termine */}
            {botStatus.upcoming.length === 0 ? (
              <p className="text-sm text-muted">Keine kommenden Termine.</p>
            ) : (
              <List>
                {botStatus.upcoming.map((ev: any) => (
                  <Row key={ev.date}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">{fmtShort(ev.date)}</span>{' '}
                        <span className="text-muted">in {ev.daysUntil} Tagen</span>
                      </p>
                      <p className="mt-0.5 text-sm text-muted">
                        {ev.duo.length ? ev.duo.join(' + ') : 'keine Einteilung'}
                      </p>
                      {ev.remindersSent.length > 0 && (
                        <p className="mt-0.5 text-xs text-muted">
                          Reminder: {ev.remindersSent.map(stageLabel).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {ev.inFeed === false && <Badge tone="warn">nicht im Feed</Badge>}
                      {ev.pinned && <Badge tone="accent">Gepinnt</Badge>}
                    </div>
                  </Row>
                ))}
              </List>
            )}
          </div>
        )}
      </Section>

      {/* iCal-Sync */}
      <Section
        title="Termin-Sync"
        hint="Lädt neue Jungschar-Termine aus dem BCC-Kalender. Läuft automatisch am 1. jedes Monats und kann hier jederzeit manuell angestoßen werden."
      >
        <div className="space-y-3">
          {icalUrl && (
            <Note>
              <span className="break-all text-xs">{icalUrl}</span>
            </Note>
          )}

          <Button variant="primary" block onClick={syncIcal} disabled={syncing}>
            {syncing ? 'Synchronisiere …' : 'Jetzt synchronisieren'}
          </Button>

          {lastSync && (
            <div className="text-xs text-muted">
              <p>Letzter Sync: {formatSyncTime(lastSync.at)}</p>
              <p>
                {lastSync.result.jungscharFound} Jungschar-Events im Feed,{' '}
                {lastSync.result.inserted} neu importiert,{' '}
                {lastSync.result.skipped} bereits vorhanden
              </p>
              {lastSync.result.errors?.length > 0 && (
                <p className="mt-1 text-danger">{lastSync.result.errors.join(', ')}</p>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* Wetter-Standort */}
      <Section
        title="Wetter-Standort"
        hint="Wird für die Wettervorhersage in den Remindern verwendet."
      >
        <div className="space-y-3">
          <div>
            <Label>Stadt</Label>
            <Input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="z.B. Zürich"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Breitengrad</Label>
              <Input
                type="text"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="z.B. 47.37"
              />
            </div>
            <div>
              <Label>Längengrad</Label>
              <Input
                type="text"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="z.B. 8.54"
              />
            </div>
          </div>

          <p className="text-xs text-muted">
            Tipp: Suche deine Stadt auf Google Maps, rechtsklicke auf den Ort und kopiere die Koordinaten.
          </p>

          <Button variant="primary" block onClick={saveLocation} disabled={saving}>
            {saving ? 'Speichern …' : 'Standort speichern'}
          </Button>
        </div>
      </Section>
    </Page>
  )
}
