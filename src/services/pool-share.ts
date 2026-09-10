import { getSupabase } from './database'
import { sendTelegramMessage } from './reminders'

/**
 * Ideen aus dem Pool in die Helfer-Gruppe teilen, damit das Team darüber
 * diskutieren kann. Eine knappe Nachricht, keine Umfrage.
 */

const CATEGORY_LABEL: Record<string, string> = {
  drinnen: 'Drinnen', draußen: 'Draußen', ausflug: 'Ausflug', sport: 'Sport', wasser: 'Wasser',
  wald: 'Wald', kreativ: 'Kreativ', essen: 'Essen', winter: 'Winter', herbst: 'Herbst',
  feier: 'Feier', online: 'Online', aktion: 'Aktion',
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface PoolIdea {
  id: string
  title: string
  description: string | null
  material: string | null
  tags: string[] | null
  suggested_by: string | null
}

const DESCRIPTION_MAX = 220

function trimText(s: string, max: number): string {
  const one = s.trim().replace(/\s*\n+\s*/g, ' · ')
  return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one
}

/** Knapp: Titel + Tags, eine Zeile Inhalt, Mitbringen, Absender. */
export function formatIdeasMessage(ideas: PoolIdea[]): string {
  const lines: string[] = [`💡 <b>Ideen aus dem Pool</b>`, '']
  ideas.forEach((idea, i) => {
    const tags = (idea.tags ?? []).map(t => CATEGORY_LABEL[t] ?? t)
    lines.push(`<b>${i + 1}. ${esc(idea.title)}</b>${tags.length ? ` <i>(${esc(tags.join(', '))})</i>` : ''}`)
    if (idea.description) lines.push(esc(trimText(idea.description, DESCRIPTION_MAX)))
    if (idea.material) lines.push(`Mitbringen: ${esc(trimText(idea.material, 80))}`)
    if (idea.suggested_by) lines.push(`von ${esc(idea.suggested_by)}`)
    lines.push('')
  })
  lines.push('Was meint ihr?')
  return lines.join('\n')
}

export async function shareIdeas(opts: {
  ids: string[]
  chatId: string
}): Promise<{ count: number; message: any }> {
  const ids = [...new Set(opts.ids)].slice(0, 10)
  if (ids.length === 0) throw new Error('keine Ideen ausgewählt')

  const { data, error } = await getSupabase()
    .from('ideas')
    .select('id, title, description, material, tags, suggested_by')
    .in('id', ids)
  if (error) throw error
  const byId = new Map(((data ?? []) as PoolIdea[]).map(i => [i.id, i]))
  const ideas = ids.map(id => byId.get(id)).filter((i): i is PoolIdea => !!i)
  if (ideas.length === 0) throw new Error('Ideen nicht gefunden')

  const message = await sendTelegramMessage(opts.chatId, formatIdeasMessage(ideas))
  if (!message?.ok) throw new Error(message?.description ?? 'Senden fehlgeschlagen')

  return { count: ideas.length, message }
}
