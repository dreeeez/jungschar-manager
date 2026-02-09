'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default function SettingsPage() {
  const { showAlert } = useTelegram()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [city, setCity] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')

  useEffect(() => {
    fetchSettings()
  }, [])

  async function fetchSettings() {
    const { data } = await (supabase as any)
      .from('settings')
      .select('value')
      .eq('key', 'weather_location')
      .single()

    if (data?.value) {
      try {
        const location = JSON.parse(data.value)
        setCity(location.city || '')
        setLatitude(String(location.latitude || ''))
        setLongitude(String(location.longitude || ''))
      } catch {
        // ignore parse errors
      }
    }
    setLoading(false)
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
