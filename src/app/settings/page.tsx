'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

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
        showAlert(`✅ Sync OK — ${body.inserted} neu, ${body.skipped} bereits vorhanden`)
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
      showAlert('Standort gespeichert!')
    }

    setSaving(false)
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
        <h1 className="text-xl font-bold">Einstellungen</h1>
      </div>

      {/* Bot-Status (read-only) */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold">Bot-Status</h2>
          <button
            onClick={fetchBotStatus}
            disabled={statusLoading}
            className="text-xs text-tg-link disabled:opacity-50"
          >
            {statusLoading ? '…' : '↻ Aktualisieren'}
          </button>
        </div>
        <p className="text-sm text-tg-hint mb-4">
          Überblick — kommende Termine, Abgleich mit dem Kalender-Feed und
          Reminder-Status. Sendet nichts.
        </p>

        {!botStatus && statusLoading && (
          <p className="text-xs text-tg-hint">Lädt…</p>
        )}

        {botStatus && (
          <>
            {/* Feed-Status */}
            <p className="text-xs mb-3">
              {botStatus.calendar.feedReachable ? (
                <span className="text-tg-hint">
                  📡 Feed erreichbar — {botStatus.calendar.feedJungscharCount} Jungschar-Termine
                </span>
              ) : (
                <span className="text-red-500">
                  📡 Feed nicht erreichbar (Reminder laufen fail-safe normal weiter)
                </span>
              )}
            </p>

            {/* Drift-Warnung */}
            {botStatus.calendar.feedReachable &&
              (botStatus.drift.staleInDb.length === 0 &&
              botStatus.drift.missingFromDb.length === 0 ? (
                <p className="text-xs text-green-600 mb-3">✅ Kalender &amp; DB im Einklang</p>
              ) : (
                <div className="text-xs mb-3 bg-tg-secondary-bg p-2 rounded space-y-1">
                  {botStatus.drift.staleInDb.length > 0 && (
                    <p className="text-red-500">
                      ⚠️ {botStatus.drift.staleInDb.length} Termin(e) in der DB, aber nicht (mehr) im Feed:{' '}
                      {botStatus.drift.staleInDb.map(fmtShort).join(', ')}
                    </p>
                  )}
                  {botStatus.drift.missingFromDb.length > 0 && (
                    <p className="text-amber-600">
                      ➕ {botStatus.drift.missingFromDb.length} Feed-Termin(e) noch nicht in der DB:{' '}
                      {botStatus.drift.missingFromDb.map(fmtShort).join(', ')}
                    </p>
                  )}
                </div>
              ))}

            {/* Kommende Termine */}
            <div className="space-y-2">
              {botStatus.upcoming.length === 0 && (
                <p className="text-xs text-tg-hint">Keine kommenden Termine.</p>
              )}
              {botStatus.upcoming.map((ev: any) => (
                <div key={ev.date} className="text-xs bg-tg-secondary-bg p-2 rounded">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {ev.inFeed === false ? '❌' : ev.inFeed === null ? '·' : '✅'} {fmtShort(ev.date)}{' '}
                      <span className="text-tg-hint font-normal">· in {ev.daysUntil} T</span>
                    </span>
                    {ev.pinned && <span className="text-tg-hint">📌</span>}
                  </div>
                  <div className="text-tg-hint mt-0.5">
                    {ev.duo.length ? ev.duo.join(' + ') : '— keine Einteilung —'}
                  </div>
                  {ev.remindersSent.length > 0 && (
                    <div className="text-tg-hint mt-0.5">
                      📨 {ev.remindersSent.map(stageLabel).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* iCal-Sync */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-2">Termin-Sync</h2>
        <p className="text-sm text-tg-hint mb-4">
          Lädt neue Jungschar-Termine aus dem BCC-Kalender. Läuft automatisch
          am 1. jedes Monats — kann hier jederzeit manuell angestoßen werden.
        </p>

        {icalUrl && (
          <p className="text-xs text-tg-hint mb-3 break-all bg-tg-secondary-bg p-2 rounded">
            🔗 {icalUrl}
          </p>
        )}

        <button
          onClick={syncIcal}
          disabled={syncing}
          className={`w-full py-3 bg-tg-button text-tg-button-text rounded-lg font-medium ${
            syncing ? 'opacity-50' : ''
          }`}
        >
          {syncing ? 'Synchronisiere...' : '🔄 Jetzt synchronisieren'}
        </button>

        {lastSync && (
          <div className="mt-3 text-xs text-tg-hint">
            <p>Letzter Sync: {formatSyncTime(lastSync.at)}</p>
            <p>
              {lastSync.result.jungscharFound} Jungschar-Events im Feed,{' '}
              {lastSync.result.inserted} neu importiert,{' '}
              {lastSync.result.skipped} bereits vorhanden
            </p>
            {lastSync.result.errors?.length > 0 && (
              <p className="text-red-500 mt-1">⚠️ {lastSync.result.errors.join(', ')}</p>
            )}
          </div>
        )}
      </div>

      {/* Wetter-Standort */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-2">Wetter-Standort</h2>
        <p className="text-sm text-tg-hint mb-4">
          Wird für die AI-Ideengenerierung verwendet (Wetter-basierte Vorschläge).
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-tg-hint block mb-1">Stadt</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="z.B. Zürich"
              className="w-full px-4 py-2 bg-tg-secondary-bg rounded-lg outline-none focus:ring-2 focus:ring-tg-button"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-tg-hint block mb-1">Breitengrad</label>
              <input
                type="text"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="z.B. 47.37"
                className="w-full px-4 py-2 bg-tg-secondary-bg rounded-lg outline-none focus:ring-2 focus:ring-tg-button"
              />
            </div>
            <div>
              <label className="text-sm text-tg-hint block mb-1">Längengrad</label>
              <input
                type="text"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="z.B. 8.54"
                className="w-full px-4 py-2 bg-tg-secondary-bg rounded-lg outline-none focus:ring-2 focus:ring-tg-button"
              />
            </div>
          </div>

          <p className="text-xs text-tg-hint">
            Tipp: Suche deine Stadt auf Google Maps, rechtsklicke auf den Ort und kopiere die Koordinaten.
          </p>

          <button
            onClick={saveLocation}
            disabled={saving}
            className={`w-full py-3 bg-tg-button text-tg-button-text rounded-lg font-medium ${
              saving ? 'opacity-50' : ''
            }`}
          >
            {saving ? 'Speichern...' : 'Standort speichern'}
          </button>
        </div>
      </div>
    </main>
  )
}
