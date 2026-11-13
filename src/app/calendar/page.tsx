'use client'

import { useState, useEffect } from 'react'
import { useTelegram } from '@/components/TelegramProvider'
import { supabase } from '@/lib/supabase'
import { hasFoodDuty } from '@/utils/format'
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
  IconLine,
  SmallIcons,
  PAGE_COLORS,
} from '@/components/ui'

interface Helper {
  id: string
  name: string
  is_senior?: boolean
  is_ateam?: boolean
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
  /**
   * Einladung (/einladen im Bot). Wegen UNIQUE(event_id) liefert PostgREST
   * ein einzelnes Objekt, kein Array — deshalb beides zulassen.
   */
  invitations?: { id: string; parent: Parent | null }[] | { id: string; parent: Parent | null } | null
}

function getInvitation(event: Event) {
  const inv = Array.isArray(event.invitations) ? event.invitations[0] : event.invitations
  return inv?.parent ? { id: inv.id, name: inv.parent.name } : null
}

function getInvitationName(event: Event): string | null {
  return getInvitation(event)?.name ?? null
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
  helpers: { id: string; name: string; username: string | null; isSenior: boolean; isATeam?: boolean }[]
  /** Nur im gespeicherten nächsten Block: schon in der Helfer-Gruppe gepostet. */
  posted?: boolean
}

interface ParentProposal {
  eventId: string
  eventDate: string
  parent: Parent
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

/**
 * Telegram-HTML (nur b/i/a) für die Vorschau: Mentions werden zu blauem
 * Text, weil tg://-Links im Browser nichts tun. Der Text kommt vom eigenen
 * Server bereits escaped.
 */
function telegramHtmlForPreview(html: string): string {
  return html.replace(/<a href="tg:\/\/user\?id=\d+">(.*?)<\/a>/g, '<span class="text-accent">$1</span>')
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
  const [showAllUpcoming, setShowAllUpcoming] = useState(false)
  /** Nächster Block (4 Termine nach der gepinnten Einteilung), wie gespeichert. */
  const [nextBlock, setNextBlock] = useState<RotationProposal[] | null>(null)
  /** Noch offene Termine der gepinnten Einteilung (Helfer-Gruppe). */
  const [currentPinned, setCurrentPinned] = useState<RotationProposal[]>([])
  /** Bilanz je Helfer (negativ = liegt zurück) für den Ersatz-Vorschlag. */
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [rotationMessage, setRotationMessage] = useState<string | null>(null)
  const [rotationMessageLoading, setRotationMessageLoading] = useState(false)
  /** Chat-Auswahl: für die Vorschau (im Vorschau-Sheet) oder die gespeicherte Einteilung. */
  const [postChoice, setPostChoice] = useState<'preview' | 'current' | null>(null)
  /** Eltern-Einteilung (Essen, nur Samstage): Vorschau, null = Sheet zu. */
  const [parentPreview, setParentPreview] = useState<ParentProposal[] | null>(null)
  const [parentWindowLabel, setParentWindowLabel] = useState('')
  const [parentLoading, setParentLoading] = useState(false)
  const [parentSaving, setParentSaving] = useState(false)

  useEffect(() => {
    fetchData()
    loadNextBlock()
  }, [])

  async function loadNextBlock() {
    try {
      const res = await fetch('/api/rotation/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saved: true }),
      })
      const body = await res.json()
      if (res.ok) {
        setNextBlock(body.proposals ?? [])
        setCurrentPinned(body.current ?? [])
        setBalances(body.balances ?? {})
      }
    } catch {}
  }

  async function fetchData() {
    const [eventsResult, helpersResult, parentsResult, childrenResult] = await Promise.all([
      supabase
        .from('events')
        .select('*, assignments(id, helper_id, helper:helpers(id, name)), parent_duties(id, parent_id, parent:parents(id, name)), invitations(id, parent:parents(id, name))')
        .order('event_date', { ascending: true }),
      supabase
        .from('helpers')
        .select('id, name, is_senior, is_ateam')
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

  /** Heute zählt mit (Vergleich nach Kalendertag, nicht nach Uhrzeit). */
  function isUpcoming(dateString: string) {
    return !isPastEvent(dateString)
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

  /** Nächsten Block in der Vorschau öffnen: gespeicherter Entwurf ('saved') oder neu gezogen ('new'). */
  async function loadRotationPreview(mode: 'saved' | 'new' = 'new') {
    setRotationLoading(true)
    try {
      const res = await fetch('/api/rotation/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'saved' ? { saved: true } : {}),
      })
      const body = await res.json()
      if (!res.ok) {
        showAlert('Fehler: ' + (body.error ?? 'unbekannt'))
        return
      }
      setPostChoice(null)
      setRotationMessage(null)
      setRotationPreview(body.proposals ?? [])
      setRotationSkipped(body.skipped ?? [])
      setBalances(body.balances ?? {})
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    } finally {
      setRotationLoading(false)
    }
  }

  async function saveRotationDraft() {
    setRotationCommitting(true)
    try {
      const res = await fetch('/api/rotation/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rotationPayload(), draftOnly: true }),
      })
      const body = await res.json()
      if (!res.ok) {
        showAlert('Fehler: ' + (body.error ?? 'unbekannt'))
        return
      }
      showAlert('Entwurf gespeichert. In der Gruppe ist nichts passiert.')
      setRotationPreview(null)
      setRotationMessage(null)
      await Promise.all([fetchData(), loadNextBlock()])
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    } finally {
      setRotationCommitting(false)
    }
  }

  /**
   * Tausch-Auswahl: erst dieselbe Gruppe (Senior/Junior), sortiert nach
   * Bilanz. Der Erste bekommt einen Stern = Vorschlag (liegt am weitesten zurück).
   */
  function swapOptions(current: { id: string; isSenior: boolean; isATeam?: boolean }, taken: string[]) {
    const group = (h: { is_senior?: boolean; is_ateam?: boolean }) => (h.is_ateam ? 'a' : h.is_senior ? 's' : 'j')
    const mine = current.isATeam ? 'a' : current.isSenior ? 's' : 'j'
    const same = helpers.filter(h => group(h) === mine)
    const other = helpers.filter(h => group(h) !== mine)
    const byBalance = (a: Helper, b: Helper) => (balances[a.id] ?? 0) - (balances[b.id] ?? 0)
    const sorted = [...same.sort(byBalance), ...other.sort(byBalance)]
    const best = sorted.find(h => group(h) === mine && h.id !== current.id && !taken.includes(h.id))
    return sorted.map(h => ({
      id: h.id,
      label: (best?.id === h.id ? '★ ' : '') + h.name + (h.is_senior ? ' (S)' : h.is_ateam ? ' (A-Team)' : ''),
    }))
  }

  function rotationPayload() {
    return { proposals: (rotationPreview ?? []).map(p => ({ eventId: p.eventId, helperIds: p.helpers.map(h => h.id) })) }
  }

  async function loadRotationMessage() {
    setRotationMessageLoading(true)
    try {
      const res = await fetch('/api/rotation/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rotationPayload()),
      })
      const body = await res.json()
      if (!res.ok) {
        showAlert('Fehler: ' + (body.error ?? 'unbekannt'))
        return
      }
      setRotationMessage(body.text ?? '')
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    }
    setRotationMessageLoading(false)
  }

  function swapRotationHelper(eventId: string, index: number, helperId: string) {
    const helper = helpers.find(h => h.id === helperId)
    if (!helper) return
    setRotationMessage(null)
    setRotationPreview(prev => prev?.map(p => {
      if (p.eventId !== eventId) return p
      const next = [...p.helpers]
      next[index] = { ...next[index], id: helper.id, name: helper.name, isSenior: !!helper.is_senior, isATeam: !!helper.is_ateam }
      return { ...p, helpers: next }
    }) ?? null)
  }

  /**
   * source 'preview': Vorschau speichern und posten. 'current': gespeicherte
   * Einteilung posten, ohne Neuberechnung.
   */
  async function commitRotation(testMode: boolean, source: 'preview' | 'current') {
    if (!testMode) {
      const ok = await showConfirm('In die Helfer-Gruppe posten und pinnen? Alle Helfer sehen die Nachricht.')
      if (!ok) return
    }
    setRotationCommitting(true)
    try {
      const res = await fetch('/api/rotation/commit' + (testMode ? '?test=1' : ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(source === 'preview' ? rotationPayload() : {}),
      })
      const body = await res.json()
      if (!res.ok) {
        showAlert('Fehler: ' + (body.error ?? 'unbekannt'))
        return
      }
      const n = body.proposals?.length ?? 0
      const where = testMode ? 'Sandbox-Gruppe' : 'Helfer-Gruppe'
      showAlert(n === 0
        ? 'Nichts gepostet (keine Termine mit Team).'
        : testMode
          ? `In der Sandbox-Gruppe gepostet: ${n} Termine. Test, in der Helfer-Gruppe ist nichts passiert.`
          : `In der ${where} gepostet und gepinnt: ${n} Termine. Tausche in der App aktualisieren die Nachricht.`)
      setPostChoice(null)
      setRotationPreview(null)
      setRotationMessage(null)
      await Promise.all([fetchData(), loadNextBlock()])
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    } finally {
      setRotationCommitting(false)
    }
  }

  function renderPostTargets(source: 'preview' | 'current') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {source === 'preview'
            ? 'Wohin posten? Der Block wird gespeichert und als neue Nachricht gepostet und gepinnt, zusammen mit den noch offenen Terminen der jetzigen Einteilung.'
            : 'Wohin posten? Die aktuelle Einteilung kommt noch einmal als neue Nachricht, ganz unten, und wird gepinnt.'}
        </p>
        <Button variant="secondary" block onClick={() => commitRotation(true, source)} disabled={rotationCommitting}>
          {rotationCommitting ? 'Sende …' : 'Sandbox-Gruppe (Test)'}
        </Button>
        <Button variant="danger" block className="border border-line" onClick={() => commitRotation(false, source)} disabled={rotationCommitting}>
          {rotationCommitting ? 'Sende …' : 'Helfer-Gruppe'}
        </Button>
        <Button variant="ghost" block onClick={() => setPostChoice(null)} disabled={rotationCommitting}>
          Abbrechen
        </Button>
      </div>
    )
  }

  async function loadParentPreview() {
    setParentLoading(true)
    try {
      const res = await fetch('/api/rotation/parents/preview', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        showAlert('Fehler: ' + (body.error ?? 'unbekannt'))
        return
      }
      setParentWindowLabel(body.window?.label ?? '')
      setParentPreview(body.proposals ?? [])
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    } finally {
      setParentLoading(false)
    }
  }

  function swapParentProposal(eventId: string, parentId: string) {
    const parent = parents.find(p => p.id === parentId)
    if (!parent) return
    setParentPreview(prev => prev?.map(p => (p.eventId === eventId ? { ...p, parent } : p)) ?? null)
  }

  async function saveParentPreview() {
    if (!parentPreview || parentPreview.length === 0) return
    const ok = await showConfirm('Elterndienst dieser Samstage ersetzen?')
    if (!ok) return
    setParentSaving(true)
    try {
      const res = await fetch('/api/rotation/parents/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposals: parentPreview.map(p => ({ eventId: p.eventId, parentId: p.parent.id })) }),
      })
      const body = await res.json()
      if (!res.ok) {
        showAlert('Fehler: ' + (body.error ?? 'unbekannt'))
        return
      }
      showAlert(`Elterndienst für ${body.saved ?? 0} Samstage gespeichert.`)
      setParentPreview(null)
      await fetchData()
    } catch (e: any) {
      showAlert('Fehler: ' + e.message)
    } finally {
      setParentSaving(false)
    }
  }

  async function removeInvitation(id: string) {
    if (!selectedEvent || saving) return
    const ok = await showConfirm('Einladung entfernen?')
    if (!ok) return
    setSaving(true)
    try {
      const { error } = await (supabase as any).from('invitations').delete().eq('id', id)
      if (error) throw error
      await refreshSelectedEvent()
    } catch (error: any) {
      showAlert('Fehler: ' + error.message)
    }
    setSaving(false)
  }

  async function refreshSelectedEvent() {
    if (!selectedEvent) return

    await fetchData()

    const { data } = await supabase
      .from('events')
      .select('*, assignments(id, helper_id, helper:helpers(id, name)), parent_duties(id, parent_id, parent:parents(id, name)), invitations(id, parent:parents(id, name))')
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
  const blockState: 'empty' | 'draft' | 'posted' =
    !nextBlock || nextBlock.length === 0 || nextBlock.every(p => p.helpers.length === 0)
      ? 'empty'
      : nextBlock.every(p => p.posted) ? 'posted' : 'draft'
  /**
   * Lücken: kommende Termine bis zum Ende der gepinnten Einteilung, die in
   * keinem Pin stehen (z. B. später per ICS dazugekommen). Die Block-Logik
   * plant sie nicht, deshalb hier sichtbar machen.
   */
  const pinnedIds = new Set(currentPinned.map(p => p.eventId))
  const pinnedUntil = currentPinned.length ? currentPinned[currentPinned.length - 1].eventDate : null
  const gaps = pinnedUntil
    ? upcomingEvents.filter(e => e.event_date <= pinnedUntil && !pinnedIds.has(e.id))
    : []
  /** "Henrik (S) · Hartmut" — Vorname reicht, Gruppe in Klammern. */
  const teamLine = (p: RotationProposal) =>
    p.helpers.map(h => h.name.split(' ')[0] + (h.isSenior ? ' (S)' : h.isATeam ? ' (A)' : '')).join(' · ')
  const selectedLocked = selectedEvent ? isPastEvent(selectedEvent.event_date) : false

  const syncSubtitle = lastSyncAt
    ? 'Stand: ' +
      new Date(lastSyncAt).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : 'Noch nie synchronisiert. In den Einstellungen synchronisieren.'

  return (
    <Page back="/" title="Kalender" subtitle={syncSubtitle} accent="calendar">
      <Section title="Kommende Termine">
        {upcomingEvents.length === 0 ? (
          <Empty>Keine kommenden Termine</Empty>
        ) : (
          <List>
            {(showAllUpcoming ? upcomingEvents : upcomingEvents.slice(0, 5)).map((event) => {
              const idea = ideasMap.get(event.id)
              const birthdays = getBirthdaysNearEvent(event.event_date)
              // Elterndienst (Essen) gibt es nur samstags.
              const parentName = hasFoodDuty(event.event_date) ? getParentDutyName(event) : ''
              return (
                <Row key={event.id} onClick={() => openModal(event)}>
                  <DateTile date={event.event_date} weekday={false} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{formatDate(event.event_date)}</span>
                      {idea && <Badge tone="success">Log</Badge>}
                    </div>
                    <IconLine icon={<SmallIcons.users />} color={PAGE_COLORS.helpers}>
                      {getAssignedHelperNames(event)}
                    </IconLine>
                    {parentName && (
                      <IconLine icon={<SmallIcons.food />} color={PAGE_COLORS.parents}>
                        {parentName}
                      </IconLine>
                    )}
                    {getInvitationName(event) && (
                      <IconLine icon={<SmallIcons.home />} color={PAGE_COLORS.parents}>
                        Einladung: {getInvitationName(event)}
                      </IconLine>
                    )}
                    {birthdays.map((b, i) => (
                      <IconLine key={i} icon={<SmallIcons.gift />} color={PAGE_COLORS.children}>
                        {b.name} wird {b.age} ({b.dayMonth})
                      </IconLine>
                    ))}
                  </div>
                  <ChevronRight />
                </Row>
              )
            })}
          </List>
        )}
        {upcomingEvents.length > 5 && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAllUpcoming(v => !v)}>
            {showAllUpcoming ? 'Weniger anzeigen' : `Alle ${upcomingEvents.length} Termine anzeigen`}
          </Button>
        )}
      </Section>


      <Section title="Einteilung">
        <div className="space-y-3">
          {currentPinned.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-3">
                <p className="text-sm font-medium">Gepinnt in der Helfer-Gruppe</p>
                <Button variant="ghost" size="sm" className="-mr-2" onClick={() => setPostChoice('current')}>
                  Neu posten
                </Button>
              </div>
              <div className="px-4 pb-3 pt-1">
                {currentPinned.map(p => (
                  <div key={p.eventId} className="flex gap-3 py-1 text-sm">
                    <span className="w-24 shrink-0 text-muted">{formatDate(p.eventDate)}</span>
                    <span className="min-w-0 flex-1">{teamLine(p)}</span>
                  </div>
                ))}
                {gaps.map(e => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => openModal(e)}
                    className="flex w-full gap-3 py-1 text-left text-sm active:opacity-60"
                  >
                    <span className="w-24 shrink-0 text-warn">{formatDate(e.event_date)}</span>
                    <span className="min-w-0 flex-1 text-warn">
                      {(e.assignments?.length ?? 0) > 0 ? `${getAssignedHelperNames(e)}, nicht im Pin` : 'nicht eingeteilt, antippen'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3">
              <p className="text-sm font-medium">Nächster Block</p>
              <Badge tone={blockState === 'draft' ? 'warn' : blockState === 'posted' ? 'success' : 'outline'}>
                {blockState === 'draft' ? 'Entwurf' : blockState === 'posted' ? 'Gepostet' : 'Leer'}
              </Badge>
            </div>
            <div className="px-4 pb-3 pt-1">
              {(nextBlock ?? []).length === 0 ? (
                <p className="py-1 text-sm text-muted">Keine weiteren Termine im Kalender.</p>
              ) : (
                (nextBlock ?? []).map(p => (
                  <div key={p.eventId} className="flex gap-3 py-1 text-sm">
                    <span className="w-24 shrink-0 text-muted">{formatDate(p.eventDate)}</span>
                    <span className={p.helpers.length ? 'min-w-0 flex-1' : 'min-w-0 flex-1 text-muted'}>
                      {p.helpers.length ? teamLine(p) : 'offen'}
                    </span>
                  </div>
                ))
              )}
              {blockState === 'empty' && (nextBlock ?? []).length > 0 && (
                <p className="pt-1 text-xs text-muted">Der Entwurf kommt automatisch nach dem vorletzten gepinnten Termin, per DM.</p>
              )}
              {(nextBlock ?? []).length > 0 && blockState !== 'posted' && (
                <Button
                  variant="primary"
                  block
                  className="mt-3"
                  onClick={() => loadRotationPreview(blockState === 'draft' ? 'saved' : 'new')}
                  disabled={rotationLoading}
                >
                  {rotationLoading ? 'Lade …' : blockState === 'draft' ? 'Prüfen und posten' : 'Jetzt schon ziehen'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Elterndienst">
        <Button variant="secondary" block onClick={loadParentPreview} disabled={parentLoading}>
          {parentLoading && !parentPreview ? 'Berechne …' : 'Eltern einteilen (Samstage)'}
        </Button>
      </Section>

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

            {getInvitationName(selectedEvent) && (
              <div className="mb-5">
                <Note tone="accent">Einladung: {getInvitationName(selectedEvent)} lädt die Jungschar zu sich ein.</Note>
              </div>
            )}

            {selectedLocked && (
              <div className="mb-5">
                <Note>
                  Termin abgeschlossen: Zuweisungen sind eingefroren. Aktivität kannst du weiterhin nachtragen.
                </Note>
              </div>
            )}

            <Section
              title="Helfer"
              className={hasFoodDuty(selectedEvent.event_date) || getInvitation(selectedEvent) ? undefined : 'mb-0'}
            >
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

            {/* Elterndienst gibt es nur samstags, freitags wird niemand eingeteilt. */}
            {hasFoodDuty(selectedEvent.event_date) && (
              <Section title="Elterndienst (Essen)" className={getInvitation(selectedEvent) ? undefined : 'mb-0'}>
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
            )}

            {getInvitation(selectedEvent) && (
              <Section title="Einladung" className="mb-0">
                <Row>
                  <span className="flex-1 text-sm">{getInvitation(selectedEvent)!.name} lädt die Jungschar zu sich ein</span>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => removeInvitation(getInvitation(selectedEvent)!.id)}
                    disabled={saving || selectedLocked}
                  >
                    Entfernen
                  </Button>
                </Row>
              </Section>
            )}

          </>
        )}
      </Sheet>

      {/* Rotation-Sheet */}
      <Sheet
        open={!!rotationPreview}
        onClose={() => { setRotationPreview(null); setRotationMessage(null); setPostChoice(null) }}
        title="Nächster Block"
        locked={rotationCommitting}
      >
        {rotationPreview && (
          <>
            <p className="mb-4 text-sm text-muted">
              {rotationPreview.length} Termine · Tippe auf einen Namen zum Tauschen, ★ = liegt am weitesten zurück.
            </p>

            {rotationPreview.length === 0 ? (
              <Empty>Keine weiteren Termine im Kalender.</Empty>
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
                      <div className="mt-1 space-y-1">
                        {p.helpers.map((h, i) => (
                          <p key={i} className="flex items-center justify-between gap-2 text-sm">
                            <label className="relative inline-flex items-center gap-1.5 py-0.5">
                              <span>{h.name}</span>
                              <span className="text-muted"><SmallIcons.pencilSmall /></span>
                              <select
                                value={h.id}
                                onChange={e => swapRotationHelper(p.eventId, i, e.target.value)}
                                disabled={rotationCommitting}
                                aria-label="Helfer tauschen"
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                              >
                                {swapOptions(h, p.helpers.map(x => x.id)).map(opt => (
                                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                                ))}
                              </select>
                            </label>
                            <Badge tone={h.isSenior ? 'warn' : h.isATeam ? 'accent' : 'outline'}>{h.isSenior ? 'Senior' : h.isATeam ? 'A-Team' : 'Junior'}</Badge>
                          </p>
                        ))}
                      </div>
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
                {rotationMessage === null ? (
                  <Button
                    variant="secondary"
                    block
                    onClick={loadRotationMessage}
                    disabled={rotationMessageLoading || rotationCommitting}
                  >
                    {rotationMessageLoading ? 'Lade …' : 'Nachricht ansehen'}
                  </Button>
                ) : (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">So geht die Nachricht raus</p>
                    <div
                      className="whitespace-pre-wrap rounded-2xl rounded-tl-md bg-card px-3 py-2 shadow-sm text-sm leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: telegramHtmlForPreview(rotationMessage) }}
                    />
                  </div>
                )}
                {postChoice === 'preview' ? renderPostTargets('preview') : (
                  <>
                    <Button variant="primary" block onClick={saveRotationDraft} disabled={rotationCommitting}>
                      {rotationCommitting ? 'Speichere …' : 'Als Entwurf speichern'}
                    </Button>
                    <Button variant="secondary" block onClick={() => setPostChoice('preview')} disabled={rotationCommitting}>
                      Speichern und jetzt posten …
                    </Button>
                    <Button variant="ghost" block onClick={() => loadRotationPreview('new')} disabled={rotationLoading || rotationCommitting}>
                      {rotationLoading ? 'Berechne …' : 'Neu ziehen'}
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Sheet>

      {/* Eltern-Einteilung (Essen, nur Samstage) */}
      <Sheet
        open={!!parentPreview}
        onClose={() => setParentPreview(null)}
        title="Eltern-Einteilung"
        locked={parentSaving}
      >
        {parentPreview && (
          <>
            <p className="mb-1 font-medium">{parentWindowLabel}</p>
            <p className="mb-4 text-sm text-muted">
              Essen gibt es nur an Samstagen. {parentPreview.length} Samstage · {parents.length} Eltern
            </p>

            {parents.length === 0 ? (
              <Empty>Keine Eltern vorhanden. Unter &quot;Eltern&quot; hinzufügen.</Empty>
            ) : parentPreview.length === 0 ? (
              <Empty>Keine Samstags-Termine im Halbjahr.</Empty>
            ) : (
              <>
                <List className="mb-5">
                  {parentPreview.map(p => (
                    <Row key={p.eventId}>
                      <span className="w-24 shrink-0 text-sm font-medium">{formatDate(p.eventDate)}</span>
                      <label className="relative inline-flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-sm">
                        <span className="truncate">{p.parent.name}</span>
                        <span className="text-muted"><SmallIcons.pencilSmall /></span>
                        <select
                          value={p.parent.id}
                          onChange={e => swapParentProposal(p.eventId, e.target.value)}
                          disabled={parentSaving}
                          aria-label="Eltern tauschen"
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        >
                          {parents.map(opt => (
                            <option key={opt.id} value={opt.id}>{opt.name}</option>
                          ))}
                        </select>
                      </label>
                    </Row>
                  ))}
                </List>
                <div className="space-y-3">
                  <Button variant="primary" block onClick={saveParentPreview} disabled={parentSaving}>
                    {parentSaving ? 'Speichere …' : 'Speichern'}
                  </Button>
                  <Button variant="ghost" block onClick={loadParentPreview} disabled={parentLoading || parentSaving}>
                    {parentLoading ? 'Berechne …' : 'Neu berechnen'}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </Sheet>

      {/* Gespeicherte Einteilung posten */}
      <Sheet open={postChoice === 'current'} onClose={() => setPostChoice(null)} title="Gepinnte Einteilung neu posten" locked={rotationCommitting}>
        <List className="mb-5">
          {currentPinned.map(p => (
            <Row key={p.eventId}>
              <span className="w-24 shrink-0 text-sm font-medium">{formatDate(p.eventDate)}</span>
              <span className="min-w-0 flex-1 text-sm text-muted">{teamLine(p)}</span>
            </Row>
          ))}
        </List>
        {renderPostTargets('current')}
      </Sheet>
    </Page>
  )
}
