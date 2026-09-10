'use client'

import React, { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  DateTile,
  Empty,
  List,
  Loading,
  Note,
  Page,
  Row,
  Section,
  Sheet,
  SmallIcons,
} from '@/components/ui'

interface NextPing {
  type: string
  at: string
  eventDate: string
  label: string
}

interface UpcomingEvent {
  date: string
  daysUntil: number
  inFeed: boolean | null
  pinned: boolean
  duo: string[]
  remindersSent: string[]
}

interface BotStatus {
  now: string
  calendar: { feedReachable: boolean; feedJungscharCount: number | null; lastSync: any }
  upcoming: UpcomingEvent[]
  drift: { staleInDb: string[]; missingFromDb: string[] }
  health: { ok: boolean; issues: string[] }
  nextPings: NextPing[]
  nextEvent: { date: string; daysUntil: number; duo: string[] } | null
}

function fmtShort(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]
  return `${wd} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function stageLabel(t: string): string {
  if (t === 'stage1_sunday') return 'So'
  if (t === 'stage2_wednesday') return 'Mi'
  if (t === 'stage3_saturday') return 'Sa'
  return t
}

interface Preview {
  type: string
  date: string
  text: string
  buttons: string[]
}

/**
 * Telegram-HTML (nur <b>, <i>, <a>) in sichere React-Knoten wandeln.
 * Alles andere wird als Text gezeigt.
 */
function renderTelegramHtml(html: string) {
  const parts = html.split(/(<\/?(?:b|i)>|<a [^>]*>|<\/a>)/g)
  const out: React.ReactNode[] = []
  let bold = false
  let italic = false
  let link = false
  parts.forEach((part, i) => {
    if (part === '<b>') bold = true
    else if (part === '</b>') bold = false
    else if (part === '<i>') italic = true
    else if (part === '</i>') italic = false
    else if (part.startsWith('<a ')) link = true
    else if (part === '</a>') link = false
    else if (part) {
      const text = part.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      const cls = [bold ? 'font-semibold' : '', italic ? 'italic' : '', link ? 'text-accent' : ''].join(' ').trim()
      out.push(cls ? <span key={i} className={cls}>{text}</span> : text)
    }
  })
  return out
}

function daysLabel(n: number): string {
  if (n === 0) return 'heute'
  if (n === 1) return 'morgen'
  return `in ${n} Tagen`
}

export default function StatusPage() {
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewFor, setPreviewFor] = useState<NextPing | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    fetchStatus()
  }, [])

  async function openPreview(p: NextPing) {
    setPreviewFor(p)
    setPreview(null)
    setPreviewError(null)
    try {
      const res = await fetch(`/api/status/preview?type=${encodeURIComponent(p.type)}&date=${p.eventDate}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setPreview(body)
    } catch (e: any) {
      setPreviewError(e.message ?? 'Vorschau nicht verfügbar.')
    }
  }

  async function fetchStatus() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/status')
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setStatus(body)
    } catch (e: any) {
      setError(e.message ?? 'Status konnte nicht geladen werden.')
    }
    setLoading(false)
  }

  if (loading && !status) return <Loading />

  const nextPing = status?.nextPings[0] ?? null

  return (
    <Page
      back="/"
      title="Bot-Status"
      accent="status"
      action={
        <Button variant="ghost" size="sm" onClick={fetchStatus} disabled={loading}>
          {loading ? 'Lädt …' : 'Aktualisieren'}
        </Button>
      }
    >
      {error && (
        <div className="mb-6">
          <Note tone="danger">{error}</Note>
        </div>
      )}

      {status && (
        <>
          <Section>
            <Card>
              <p className={`text-xl font-semibold ${status.health.ok ? 'text-success' : 'text-warn'}`}>
                {status.health.ok ? 'Alles in Ordnung' : 'Achtung'}
              </p>
              {status.health.ok ? (
                <p className="mt-1 text-sm text-muted">Feed erreichbar, Kalender abgeglichen, Einteilungen vorhanden.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {status.health.issues.map((issue, i) => (
                    <li key={i} className="text-sm text-muted">{issue}</li>
                  ))}
                </ul>
              )}
            </Card>
          </Section>

          <Section title="Nächste Nachricht">
            {nextPing ? (
              <button type="button" onClick={() => openPreview(nextPing)} className="card flex w-full items-center gap-3 p-4 text-left active:opacity-60">
                <DateTile date={nextPing.eventDate} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{nextPing.label}</p>
                  <p className="text-sm text-muted">{fmtDateTime(nextPing.at)} Uhr</p>
                  {status.nextEvent && status.nextEvent.date === nextPing.eventDate && (
                    <p className="text-sm text-muted">Termin {daysLabel(status.nextEvent.daysUntil)}</p>
                  )}
                  <p className="mt-1 text-xs text-accent">Vorschau anzeigen</p>
                </div>
              </button>
            ) : (
              <Card>
                <Empty>Keine Nachricht geplant.</Empty>
              </Card>
            )}
          </Section>

          <Section title="Geplante Pings">
            {status.nextPings.length === 0 ? (
              <Empty>Keine ausstehenden Pings.</Empty>
            ) : (
              <List>
                {status.nextPings.map((p, i) => (
                  <Row key={`${p.type}-${p.eventDate}-${i}`} onClick={() => openPreview(p)}>
                    <span className="shrink-0 text-accent">
                      <SmallIcons.send />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{p.label}</p>
                      <p className="text-sm text-muted">{fmtDateTime(p.at)} Uhr</p>
                    </div>
                    <Badge tone="accent">{fmtShort(p.eventDate)}</Badge>
                  </Row>
                ))}
              </List>
            )}
          </Section>

        </>
      )}

      <Sheet
        open={!!previewFor}
        onClose={() => { setPreviewFor(null); setPreview(null) }}
        title={previewFor?.label ?? 'Vorschau'}
      >
        {previewFor && (
          <p className="mb-3 text-sm text-muted">
            Geplant {fmtDateTime(previewFor.at)} Uhr, Termin {fmtShort(previewFor.eventDate)}
          </p>
        )}
        {previewError && <Note tone="danger">{previewError}</Note>}
        {!preview && !previewError && <p className="py-6 text-center text-sm text-muted">Lädt …</p>}
        {preview && (
          <div className="space-y-3">
            <div className="card whitespace-pre-wrap p-4 text-[15px] leading-relaxed">
              {renderTelegramHtml(preview.text)}
            </div>
            {preview.buttons.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {preview.buttons.map((b) => (
                  <span key={b} className="rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent">{b}</span>
                ))}
              </div>
            )}
            <p className="text-xs text-muted">
              Vorschau mit aktuellen Daten. Texte rotieren zufällig, die gesendete Nachricht kann eine andere Variante sein.
            </p>
          </div>
        )}
      </Sheet>
    </Page>
  )
}
