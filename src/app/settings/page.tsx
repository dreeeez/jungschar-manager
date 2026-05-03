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
