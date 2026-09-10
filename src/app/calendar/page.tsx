'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { ARCHIVE_START_DATE } from '@/utils/format'
import {
  Page,
  Section,
  List,
  Row,
  CheckRow,
  Button,
  Textarea,
  Badge,
  Loading,
  Empty,
  Note,
  Sheet,
  ChevronRight,
  DateTile,
} from '@/components/ui'

interface Helper {
  id: string
  name: string
}

interface Parent {
  id: string
  name: string
}

interface Assignment {
  id: string
  helper_id: string
  helper: Helper | null
}

interface ParentDuty {
  id: string
  parent_id: string
  parent: Parent | null
}

interface Event {
  id: string
  event_date: string
  title: string | null
  description: string | null
  imported_at: string
  assignments: Assignment[]
  parent_duties: ParentDuty[]
}

interface IdeaRecord {
  id: string
  event_id: string
  title: string
  description: string | null
  was_used: boolean
  source: string
  created_at: string
}

interface RotationProposal {
  eventId: string
  eventDate: string
  helpers: { id: string; name: string; username: string | null; isSenior: boolean }[]
}

interface Child {
  id: string
  name: string
  birthday: string | null
  active: boolean
}

interface Birthday {
  name: string
  dayMonth: string
  age: number
}

export default function CalendarPage() {
  const { showAlert, showConfirm } = useTelegram()
  const [events, setEvents] = useState<Event[]>([])
  const [helpers, setHelpers] = useState<Helper[]>([])
  const [parents, setParents] = useState<Parent[]>([])
  const [children, setChildren] = useState<Child[]>([])
  const [ideasMap, setIdeasMap] = useState<Map<string, IdeaRecord>>(new Map())
  const [loading, setLoading] = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [selectedEventIdea, setSelectedEventIdea] = useState<IdeaRecord | null | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [newActivityText, setNewActivityText] = useState('')
  const [savingActivity, setSavingActivity] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [rotationLoading, setRotationLoading] = useState(false)
  const [rotationPreview, setRotationPreview] = useState<RotationProposal[] | null>(null)
  const [rotationSkipped, setRotationSkipped] = useState<{ eventDate: string; reason: string }[]>([])
  const [rotationCommitting, setRotationCommitting] = useState(false)
  const [rotationTestMode, setRotationTestMode] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const [eventsResult, helpersResult, parentsResult, childrenResult] = await Promise.all([
      supabase
        .from('events')
        .select('*, assignments(id, helper_id, helper:helpers(id, name)), parent_duties(id, parent_id, parent:parents(id, name))')
        .order('event_date', { ascending: true }),
      supabase
        .from('helpers')
        .select('id, name')
        .order('name', { ascending: true }),
      (supabase as any)
        .from('parents')
        .select('id, name')
        .eq('active', true)
        .order('name', { ascending: true }),
      (supabase as any)
        .from('children')
        .select('id, name, birthday, active')
        .eq('active', true),
    ])

    if (childrenResult.data) {
      setChildren(childrenResult.data)
    }

    const loadedEvents = eventsResult.data as any[] || []

    if (eventsResult.error) {
      console.error('Error fetching events:', eventsResult.error)
      showAlert('Fehler beim Laden der Events')
    } else {
      setEvents(loadedEvents)
    }

    if (helpersResult.error) {
      console.error('Error fetching helpers:', helpersResult.error)
    } else {
      setHelpers(helpersResult.data || [])
    }

    if (parentsResult.error) {
      console.error('Error fetching parents:', parentsResult.error)
    } else {
      setParents(parentsResult.data || [])
    }

    // Last iCal sync timestamp for the header
    const { data: syncRow } = await (supabase as any)
      .from('settings')
      .select('value')
      .eq('key', 'last_ical_sync')
      .maybeSingle()
    if (syncRow?.value) {
      try {
        const parsed = JSON.parse(syncRow.value)
        if (parsed.at) setLastSyncAt(parsed.at)
      } catch {}
    }

    // Load ideas for all events (for badges)
    if (loadedEvents.length > 0) {
      const eventIds = loadedEvents.map((e: any) => e.id)
      const { data: ideas } = await (supabase as any)
        .from('ideas')
        .select('*')
        .in('event_id', eventIds)
        .order('created_at', { ascending: false })

      if (ideas) {
        // Build map: event_id → most recent idea
        const map = new Map<string, IdeaRecord>()
        for (const idea of ideas) {
          if (!map.has(idea.event_id)) {
            map.set(idea.event_id, idea)
          }
        }
        setIdeasMap(map)
      }
    }

    setLoading(false)
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('de-DE', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(date)
  }

  function formatDateLong(dateString: string) {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('de-DE', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date)
  }

  function isUpcoming(dateString: string) {
    return new Date(dateString) >= new Date()
  }

  function isPastEvent(dateString: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const event = new Date(dateString)
    event.setHours(0, 0, 0, 0)
    return event.getTime() < today.getTime()
  }

  // Geburtstage in einem ±3-Tage-Fenster (insgesamt 7 Tage) um das Event.
  function getBirthdaysNearEvent(eventDateStr: string): Birthday[] {
    const event = new Date(eventDateStr + 'T12:00:00')
    const eventTime = event.getTime()
    const dayMs = 1000 * 60 * 60 * 24
    const out: Birthday[] = []

    for (const c of children) {
      if (!c.active || !c.birthday) continue
      const bday = new Date(c.birthday + 'T12:00:00')
      const month = bday.getMonth()
      const day = bday.getDate()
      const birthYear = bday.getFullYear()
      const eventYear = event.getFullYear()

      // Geburtstag im Event-Jahr — und falls Event nahe Jahresgrenze auch
      // ±1 Jahr testen, damit z.B. 30.12. ↔ 02.01. korrekt erkannt wird.
      const candidates = [
        new Date(eventYear, month, day, 12, 0, 0),
        new Date(eventYear - 1, month, day, 12, 0, 0),
        new Date(eventYear + 1, month, day, 12, 0, 0),
      ]
      const closest = candidates.reduce((best, cur) =>
        Math.abs(cur.getTime() - eventTime) < Math.abs(best.getTime() - eventTime) ? cur : best,
      )
      const diffDays = Math.abs(closest.getTime() - eventTime) / dayMs
      if (diffDays <= 3) {
        out.push({
          name: c.name,
          dayMonth: `${day}.${month + 1}.`,
          age: closest.getFullYear() - birthYear,
        })
      }
    }
    return out
  }

  function getAssignedHelperIds(event: Event): string[] {
    return event.assignments?.map(a => a.helper_id) || []
  }

  function getAssignedHelperNames(event: Event): string {
    const names = event.assignments
      ?.map(a => a.helper?.name)
      .filter(Boolean)
    return names?.length ? names.join(' & ') : 'Niemand'
  }

  function getParentDutyName(event: Event): string {
    const duty = event.parent_duties?.[0]
    return duty?.parent?.name || ''
  }

  function getAssignedParentId(event: Event): string | null {
    return event.parent_duties?.[0]?.parent_id || null
  }

  function sourceLabel(source: string): string {
    switch (source) {
      case 'elterngruppe': return 'Elterngruppe'
      case 'manual': return 'Manuell erfasst'
      default: return 'Idee'
    }
  }

  function openModal(event: Event) {
    setSelectedEvent(event)
    setSelectedEventIdea(undefined) // undefined = loading
    setNewActivityText('')

    // Load idea for this specific event
    ;(supabase as any)
      .from('ideas')
      .select('*')
      .eq('event_id', event.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }: any) => {
        setSelectedEventIdea(data ?? null) // null = no idea found
      })
  }

  async function toggleHelper(helperId: string) {
    if (!selectedEvent || saving) return
    if (isPastEvent(selectedEvent.event_date)) return

    setSaving(true)
    const assignedIds = getAssignedHelperIds(selectedEvent)
    const isAssigned = assignedIds.includes(helperId)

    try {
      if (isAssigned) {
        const { error } = await supabase
          .from('assignments')
          .delete()
          .eq('event_id', selectedEvent.id)
          .eq('helper_id', helperId)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('assignments')
          .insert({
            event_id: selectedEvent.id,
            helper_id: helperId,
          } as any)

        if (error) throw error
      }

      await refreshSelectedEvent()
      // Rotation-Nachricht in Telegram aktualisieren (no-op wenn nicht verlinkt)
      fetch('/api/rotation/rerender?event_id=' + selectedEvent.id, { method: 'POST' }).catch(() => {})
    } catch (error: any) {
      showAlert('Fehler: ' + error.message)
    }

    setSaving(false)
  }

  async function toggleParentDuty(parentId: string) {
    if (!selectedEvent || saving) return
    if (isPastEvent(selectedEvent.event_date)) return

    setSaving(true)
    const currentParentId = getAssignedParentId(selectedEvent)

    try {
      if (currentParentId === parentId) {
        const { error } = await (supabase as any)
          .from('parent_duties')
          .delete()
          .eq('event_id', selectedEvent.id)
          .eq('parent_id', parentId)

        if (error) throw error
      } else {
        await (supabase as any)
          .from('parent_duties')
          .delete()
          .eq('event_id', selectedEvent.id)

        const { error } = await (supabase as any)
          .from('parent_duties')
          .insert({
            event_id: selectedEvent.id,
            parent_id: parentId,
          })

        if (error) throw error
      }

      await refreshSelectedEvent()
    } catch (error: any) {
      showAlert('Fehler: ' + error.message)
    }

    setSaving(false)
  }

  async function saveManualActivity() {
    if (!selectedEvent || !newActivityText.trim()) return

    setSavingActivity(true)
    try {
      const { data, error } = await (supabase as any)
        .from('ideas')
        .insert({
          event_id: selectedEvent.id,
          title: newActivityText.trim().slice(0, 200),
          description: newActivityText.trim(),
          was_used: true,
          source: 'manual',
        })
        .select('*')
        .single()

      if (error) throw error

      setSelectedEventIdea(data)
      setIdeasMap(prev => new Map(prev).set(selectedEvent.id, data))
      setNewActivityText('')
    } catch (error: any) {
      showAlert('Fehler: ' + error.message)
    }
    setSavingActivity(false)
  }

  async function loadRotationPreview() {
    setRotationLoading(true)
    try {
      const res = await fetch('/api/rotation/preview', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        showAlert('Fehler: ' + (body.error ?? 'unbekannt'))
        return
      }
      setRotationPreview(body.proposals ?? [])
      setRotationSkipped(body.skipped ?? [])
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    }
    setRotationLoading(false)
  }

  async function commitRotation(testMode: boolean) {
    setRotationCommitting(true)
    try {
      // Split-Datum: heute + 6 Monate. Termine davor in 1. Nachricht,
      // Rest in 2. Nachricht — damit lange Listen nicht erschlagen.
      const splitDate = new Date()
      splitDate.setMonth(splitDate.getMonth() + 6)
      const splitAt = `${splitDate.getFullYear()}-${String(splitDate.getMonth() + 1).padStart(2, '0')}-${String(splitDate.getDate()).padStart(2, '0')}`
      const params = new URLSearchParams()
      if (testMode) params.set('test', '1')
      params.set('splitAt', splitAt)
      const res = await fetch('/api/rotation/commit?' + params.toString(), { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        showAlert('Fehler: ' + (body.error ?? 'unbekannt'))
        return
      }
      if (testMode) {
        showAlert(`Test-Nachricht in den Test-Chat gesendet (${body.proposals?.length ?? 0} Termine).`)
      } else {
        showAlert(`Einteilung gepostet. ${body.inserted ?? 0} Helfer-Slots eingetragen.`)
        setRotationPreview(null)
        await fetchData()
      }
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    }
    setRotationCommitting(false)
  }

  async function refreshSelectedEvent() {
    if (!selectedEvent) return

    await fetchData()

    const { data } = await supabase
      .from('events')
      .select('*, assignments(id, helper_id, helper:helpers(id, name)), parent_duties(id, parent_id, parent:parents(id, name))')
      .eq('id', selectedEvent.id)
      .single()

    if (data) {
      setSelectedEvent(data as any)
    }
  }

  if (loading) {
    return <Loading />
  }

  const upcomingEvents = events.filter(e => isUpcoming(e.event_date))
  const pastEvents = events.filter(e => !isUpcoming(e.event_date) && e.event_date >= ARCHIVE_START_DATE)
  const selectedLocked = selectedEvent ? isPastEvent(selectedEvent.event_date) : false

  const syncSubtitle = lastSyncAt
    ? 'Stand: ' +
      new Date(lastSyncAt).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : 'Noch nie synchronisiert. In den Einstellungen synchronisieren.'

  return (
    <Page back="/" title="Kalender" subtitle={syncSubtitle}>
      <Section title="Kommende Termine">
        {upcomingEvents.length === 0 ? (
          <Empty>Keine kommenden Termine</Empty>
        ) : (
          <List>
            {upcomingEvents.slice(0, 5).map((event) => {
              const idea = ideasMap.get(event.id)
              const birthdays = getBirthdaysNearEvent(event.event_date)
              const parentName = getParentDutyName(event)
              return (
                <Row key={event.id} onClick={() => openModal(event)}>
                  <DateTile date={event.event_date} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{formatDate(event.event_date)}</span>
                      {idea && <Badge tone="success">Log</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-muted">{getAssignedHelperNames(event)}</p>
                    {parentName && (
                      <p className="text-sm text-muted">Essen: {parentName}</p>
                    )}
                    {birthdays.map((b, i) => (
                      <p key={i} className="text-sm text-muted">
                        Geburtstag: {b.name}, {b.dayMonth} (wird {b.age})
                      </p>
                    ))}
                  </div>
                  <ChevronRight />
                </Row>
              )
            })}
          </List>
        )}
        {upcomingEvents.length > 5 && (
          <p className="mt-2 text-xs text-muted">{upcomingEvents.length - 5} weitere folgen</p>
        )}
      </Section>

      {pastEvents.length > 0 && (
        <Section title="Archiv">
          <List>
            <Row href="/ideas">
              <div className="flex-1">
                <p className="font-medium">Vergangene Termine</p>
                <p className="text-sm text-muted">
                  {pastEvents.length} {pastEvents.length === 1 ? 'Termin' : 'Termine'}
                </p>
              </div>
              <ChevronRight />
            </Row>
          </List>
        </Section>
      )}

      <details className="mb-8">
        <summary className="cursor-pointer py-2 text-sm text-muted">
          Erweitert: Einteilung manuell neu generieren
        </summary>
        <p className="mb-3 mt-2 text-sm text-muted">
          Der Auto-Modus läuft täglich. Nur nutzen, wenn die aktuelle gepinnte Einteilung
          ersetzt werden soll (z.B. neuer Helfer). Die alte Pin-Nachricht wird entfernt, eine neue erstellt.
        </p>
        <Button
          variant="secondary"
          block
          onClick={async () => {
            const ok = await showConfirm('Aktuelle gepinnte Einteilung wirklich ersetzen?')
            if (ok) loadRotationPreview()
          }}
          disabled={rotationLoading}
        >
          {rotationLoading ? 'Berechne …' : 'Einteilung neu generieren'}
        </Button>
      </details>

      {/* Termin-Sheet */}
      <Sheet open={!!selectedEvent} onClose={() => setSelectedEvent(null)} title="Termin">
        {selectedEvent && (
          <>
            <div className="mb-5 flex items-center gap-3">
              <DateTile date={selectedEvent.event_date} />
              <div>
                <p className="font-medium">{selectedEvent.title || 'Jungschar'}</p>
                <p className="text-sm text-muted">{formatDateLong(selectedEvent.event_date)}</p>
              </div>
            </div>

            {selectedLocked && (
              <div className="mb-5">
                <Note>
                  Termin abgeschlossen: Zuweisungen sind eingefroren. Aktivität kannst du weiterhin nachtragen.
                </Note>
              </div>
            )}

            <Section title="Helfer">
              {helpers.length === 0 ? (
                <Empty>Keine Helfer vorhanden.</Empty>
              ) : (
                <List>
                  {helpers.map((helper) => (
                    <CheckRow
                      key={helper.id}
                      label={helper.name}
                      checked={getAssignedHelperIds(selectedEvent).includes(helper.id)}
                      onClick={() => toggleHelper(helper.id)}
                      disabled={saving || selectedLocked}
                    />
                  ))}
                </List>
              )}
            </Section>

            <Section title="Elterndienst (Essen)">
              {parents.length === 0 ? (
                <Empty>Keine Eltern vorhanden. Unter &quot;Eltern&quot; hinzufügen.</Empty>
              ) : (
                <List>
                  {parents.map((parent) => (
                    <CheckRow
                      key={parent.id}
                      label={parent.name}
                      checked={getAssignedParentId(selectedEvent) === parent.id}
                      onClick={() => toggleParentDuty(parent.id)}
                      disabled={saving || selectedLocked}
                    />
                  ))}
                </List>
              )}
            </Section>

            <Section title="Aktivität" className="mb-0">
              {selectedEventIdea === undefined ? (
                <p className="py-2 text-sm text-muted">Lädt …</p>
              ) : selectedEventIdea ? (
                <Note>
                  <p className="whitespace-pre-wrap text-fg">
                    {selectedEventIdea.description || selectedEventIdea.title}
                  </p>
                  <p className="mt-1 text-xs">
                    {sourceLabel(selectedEventIdea.source)} · im Archiv bearbeitbar
                  </p>
                </Note>
              ) : (
                <div className="space-y-2">
                  <Textarea
                    value={newActivityText}
                    onChange={(e) => setNewActivityText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        saveManualActivity()
                      }
                    }}
                    placeholder="Was habt ihr gemacht? (Shift+Enter für Absatz)"
                    rows={3}
                  />
                  <div className="flex justify-end">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={saveManualActivity}
                      disabled={savingActivity || !newActivityText.trim()}
                    >
                      {savingActivity ? 'Speichert …' : 'Speichern'}
                    </Button>
                  </div>
                </div>
              )}
            </Section>
          </>
        )}
      </Sheet>

      {/* Rotation-Sheet */}
      <Sheet
        open={!!rotationPreview}
        onClose={() => setRotationPreview(null)}
        title="Einteilungs-Vorschlag"
        locked={rotationCommitting}
      >
        {rotationPreview && (
          <>
            <p className="mb-4 text-sm text-muted">
              Weniger eingesetzte Helfer zuerst, Senior und Junior bevorzugt.
              Bestehende Zuweisungen bleiben unangetastet.
            </p>

            {rotationPreview.length === 0 ? (
              <Empty>Keine offenen Slots im 12-Wochen-Fenster.</Empty>
            ) : (
              <List className="mb-5">
                {rotationPreview.map(p => (
                  <Row key={p.eventId}>
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {new Date(p.eventDate + 'T12:00:00').toLocaleDateString('de-DE', {
                          weekday: 'short', day: '2-digit', month: '2-digit',
                        })}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        {p.helpers.map(h => (
                          <span key={h.id} className="inline-flex items-center gap-1.5">
                            {h.name}
                            {h.isSenior && <Badge tone="warn">Senior</Badge>}
                          </span>
                        ))}
                      </p>
                    </div>
                  </Row>
                ))}
              </List>
            )}

            {rotationSkipped.length > 0 && (
              <div className="mb-5 text-sm text-muted">
                <p className="mb-1 font-medium">Übersprungen</p>
                {rotationSkipped.map((s, i) => (
                  <p key={i}>{s.eventDate}: {s.reason}</p>
                ))}
              </div>
            )}

            {rotationPreview.length > 0 && (
              <div className="space-y-3">
                <Button
                  variant="primary"
                  block
                  onClick={() => commitRotation(true)}
                  disabled={rotationCommitting}
                >
                  {rotationCommitting ? 'Sende …' : 'Test in Test-Chat senden'}
                </Button>
                <details>
                  <summary className="cursor-pointer text-sm text-muted">
                    Live in Hauptgruppe posten (nur nach erfolgreichem Test)
                  </summary>
                  <Button
                    variant="danger"
                    block
                    className="mt-2 border border-line"
                    onClick={async () => {
                      const ok = await showConfirm('Wirklich LIVE in die Hauptgruppe posten und Assignments speichern?')
                      if (ok) commitRotation(false)
                    }}
                    disabled={rotationCommitting}
                  >
                    {rotationCommitting ? 'Sende …' : 'Live in Hauptgruppe posten'}
                  </Button>
                </details>
              </div>
            )}
          </>
        )}
      </Sheet>
    </Page>
  )
}
