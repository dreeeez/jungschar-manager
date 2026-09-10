import { getSupabase } from './database'
import { sendTelegramMessage } from './reminders'

/**
 * Ideen aus dem Pool in die Helfer-Gruppe teilen, damit das Team darüber
 * diskutieren kann. Nachricht mit den Ideen, bei 2–10 Ideen zusätzlich eine
 * Umfrage (Mehrfachauswahl), damit direkt abgestimmt werden kann.
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

export function formatIdeasMessage(ideas: PoolIdea[], sharedBy: string): string {
  const lines: string[] = [`💡 <b>Ideen aus dem Pool</b> · von ${esc(sharedBy)}`, '']
  ideas.forEach((idea, i) => {
    const tags = (idea.tags ?? []).map(t => CATEGORY_LABEL[t] ?? t)
    lines.push(`<b>${i + 1}. ${esc(idea.title)}</b>${tags.length ? ` · ${esc(tags.join(', '))}` : ''}`)
    if (idea.description) lines.push(esc(idea.description.trim()))
    if (idea.material) lines.push(`Mitbringen: ${esc(idea.material)}`)
    if (idea.suggested_by) lines.push(`<i>Vorschlag von ${esc(idea.suggested_by)}</i>`)
    lines.push('')
  })
  lines.push(ideas.length > 1
    ? 'Was meint ihr? Stimmt unten ab oder schreibt eure Gedanken hier rein.'
    : 'Was meint ihr? Schreibt eure Gedanken hier rein.')
  return lines.join('\n')
}

async function sendPoll(chatId: string, question: string, options: string[]) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const res = await fetch(`https://api.telegram.org/bot${token}/sendPoll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      question,
      options,
      is_anonymous: false,
      allows_multiple_answers: true,
    }),
  })
  return res.json()
}

export async function shareIdeas(opts: {
  ids: string[]
  chatId: string
  sharedBy: string
}): Promise<{ count: number; message: any; poll: any | null }> {
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

  const message = await sendTelegramMessage(opts.chatId, formatIdeasMessage(ideas, opts.sharedBy))
  if (!message?.ok) throw new Error(message?.description ?? 'Senden fehlgeschlagen')

  let poll: any = null
  if (ideas.length >= 2) {
    poll = await sendPoll(
      opts.chatId,
      'Welche Idee machen wir als Nächstes?',
      ideas.map(i => i.title.slice(0, 100)),
    )
  }

  return { count: ideas.length, message, poll }
}
