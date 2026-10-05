/*
 * Gemeinsames für den Ideenpool: Admin-Seite (/pool, bearbeiten und teilen)
 * und Helfer-Seite (/ideen, nur lesen).
 */

export interface PoolIdea {
  id: string
  title: string
  description: string | null
  material: string | null
  source: string
  tags: string[] | null
  suggested_by: string | null
  created_at: string
  photo_file_id?: string | null
}

export const POOL_SELECT = 'id, title, description, material, source, tags, suggested_by, created_at, photo_file_id'

export type Place = 'drinnen' | 'draußen'
export const PLACE_OPTIONS: { value: Place; label: string }[] = [
  { value: 'drinnen', label: 'Drinnen' },
  { value: 'draußen', label: 'Draußen' },
]

/** Kategorien als Tags neben drinnen/draußen. Reihenfolge = Anzeige. */
export const CATEGORIES: { value: string; label: string }[] = [
  { value: 'ausflug', label: 'Ausflug' },
  { value: 'sport', label: 'Sport' },
  { value: 'wasser', label: 'Wasser' },
  { value: 'wald', label: 'Wald' },
  { value: 'kreativ', label: 'Kreativ' },
  { value: 'essen', label: 'Essen' },
  { value: 'winter', label: 'Winter' },
  { value: 'herbst', label: 'Herbst' },
  { value: 'feier', label: 'Feier' },
  { value: 'online', label: 'Online' },
  { value: 'aktion', label: 'Aktion' },
]
export const CATEGORY_LABEL = new Map(CATEGORIES.map((c) => [c.value, c.label]))

export type Sort = 'newest' | 'oldest' | 'title'
export const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Neueste zuerst' },
  { value: 'oldest', label: 'Älteste zuerst' },
  { value: 'title', label: 'A bis Z' },
]
const SORT_KEY = 'pool.sort'

export function loadSort(): Sort {
  try {
    const v = localStorage.getItem(SORT_KEY)
    if (v === 'newest' || v === 'oldest' || v === 'title') return v
  } catch {}
  return 'newest'
}

export function saveSort(next: Sort) {
  try { localStorage.setItem(SORT_KEY, next) } catch {}
}

export function formatPoolDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Kurzform für die Zeile: „Felix Schniepp, Nov. 2021". */
export function shortOrigin(idea: PoolIdea): string {
  const month = new Date(idea.created_at).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })
  return idea.suggested_by ? `${idea.suggested_by}, ${month}` : month
}

/** Herkunftszeile: „Felix Schniepp · 25. Nov. 2021 · Elternchat". */
export function originLabel(idea: PoolIdea): string {
  const parts = [idea.suggested_by, formatPoolDate(idea.created_at), idea.source === 'elterngruppe' ? 'Elternchat' : 'Mini-App']
  return parts.filter(Boolean).join(' · ')
}

/** Bild-URL einer Idee (Proxy zu Telegram), sonst null. */
export function ideaPhotoUrl(idea: PoolIdea): string | null {
  return idea.photo_file_id ? `/api/idea-photo?id=${idea.id}` : null
}

const URL_RE = /(https?:\/\/[^\s<]+)/g

/** Text in Stücke zerlegen: Links werden anklickbar, der Rest bleibt Text. */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = []
  let last = 0
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push({ text: text.slice(last, i) })
    const url = m[0].replace(/[.,;:)!?]+$/, '')
    out.push({ text: url, href: url })
    last = i + url.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Suche, Drinnen/Draußen, Kategorie und Sortierung anwenden. */
export function filterIdeas(ideas: PoolIdea[], query: string, place: Place | null, category: string | null, sort: Sort): PoolIdea[] {
  const q = query.trim().toLowerCase()
  const list = ideas.filter((idea) => {
    const tags = idea.tags || []
    if (place && !tags.includes(place)) return false
    if (category && !tags.includes(category)) return false
    if (!q) return true
    const haystack = `${idea.title} ${idea.description ?? ''} ${idea.material ?? ''}`.toLowerCase()
    return haystack.includes(q)
  })
  return list.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title, 'de')
    const diff = a.created_at.localeCompare(b.created_at)
    return sort === 'newest' ? -diff : diff
  })
}
