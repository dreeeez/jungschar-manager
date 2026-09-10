'use client'

import { useEffect, useState } from 'react'
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

function daysLabel(n: number): string {
  if (n === 0) return 'heute'
  if (n === 1) return 'morgen'
  return `in ${n} Tagen`
}

export default function StatusPage() {
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchStatus()
  }, [])

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
              <Card className="flex items-center gap-3">
                <DateTile date={nextPing.eventDate} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{nextPing.label}</p>
                  <p className="text-sm text-muted">{fmtDateTime(nextPing.at)} Uhr</p>
                  {status.nextEvent && status.nextEvent.date === nextPing.eventDate && (
                    <p className="text-sm text-muted">Termin {daysLabel(status.nextEvent.daysUntil)}</p>
                  )}
                </div>
              </Card>
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
                  <Row key={`${p.type}-${p.eventDate}-${i}`}>
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

          <Section title="Kalender">
            <div className="space-y-2">
              {status.calendar.feedReachable ? (
                <p className="text-sm text-muted">
                  Feed erreichbar, {status.calendar.feedJungscharCount} Jungschar-Termine.
                </p>
              ) : (
                <Note tone="danger">Feed nicht erreichbar. Reminder laufen fail-safe weiter.</Note>
              )}
              {status.calendar.lastSync?.at && (
                <p className="text-sm text-muted">
                  Letzter Sync: {new Date(status.calendar.lastSync.at).toLocaleString('de-DE', {
                    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              )}
              {status.calendar.feedReachable && status.drift.staleInDb.length === 0 && status.drift.missingFromDb.length === 0 && (
                <p className="text-sm text-muted">Kalender und Datenbank stimmen überein.</p>
              )}
              {status.drift.staleInDb.length > 0 && (
                <Note tone="danger">
                  {status.drift.staleInDb.length} Termin(e) in der Datenbank, aber nicht mehr im Feed:{' '}
                  {status.drift.staleInDb.map(fmtShort).join(', ')}
                </Note>
              )}
              {status.drift.missingFromDb.length > 0 && (
                <Note tone="warn">
                  {status.drift.missingFromDb.length} Feed-Termin(e) noch nicht in der Datenbank:{' '}
                  {status.drift.missingFromDb.map(fmtShort).join(', ')}
                </Note>
              )}
            </div>
          </Section>

          <Section title="Kommende Termine">
            {status.upcoming.length === 0 ? (
              <Empty>Keine kommenden Termine.</Empty>
            ) : (
              <List>
                {status.upcoming.map((ev) => (
                  <Row key={ev.date} className="items-start">
                    <div className="min-w-0 flex-1">
                      <p>
                        <span className="font-semibold">{fmtShort(ev.date)}</span>{' '}
                        <span className="text-sm text-muted">{daysLabel(ev.daysUntil)}</span>
                      </p>
                      <p className="text-sm text-muted">
                        {ev.duo.length ? ev.duo.join(' + ') : 'keine Einteilung'}
                      </p>
                      {ev.remindersSent.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {ev.remindersSent.map((r) => (
                            <Badge key={r} tone="success">{stageLabel(r)}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {ev.inFeed === false && <Badge tone="warn">nicht im Feed</Badge>}
                      {ev.pinned && <Badge tone="accent">Gepinnt</Badge>}
                    </div>
                  </Row>
                ))}
              </List>
            )}
          </Section>
        </>
      )}
    </Page>
  )
}
