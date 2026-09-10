#!/usr/bin/env node
/*
 * Einmaliger Import des Ideenpools aus supabase/seed/ideenpool.json in die
 * ideas-Tabelle (source='elterngruppe', was_used=false, ohne Termin).
 *
 * Liest SUPABASE_URL und SUPABASE_SERVICE_KEY aus .env.local.
 * Idempotent: Titel, die mit source='elterngruppe' schon existieren, werden
 * übersprungen. Mit --dry-run wird nur gezählt, nichts geschrieben.
 *
 *   node scripts/import-ideenpool.mjs [--dry-run]
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const dryRun = process.argv.includes('--dry-run')

function loadEnv(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
  return env
}

const env = loadEnv(new URL('../.env.local', import.meta.url))
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY fehlen in .env.local')
  process.exit(1)
}

const seed = JSON.parse(readFileSync(new URL('../supabase/seed/ideenpool.json', import.meta.url), 'utf8'))

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
function formatDone(done) {
  if (!done?.length) return 'Bisher noch nicht gemacht.'
  const list = done.map((ym) => {
    const [y, m] = ym.split('-')
    return `${MONTHS[Number(m) - 1]} ${y}`
  })
  return `Bisher gemacht (${done.length}×): ${list.join(', ')}.`
}

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const { data: existing, error: readError } = await db
  .from('ideas')
  .select('title')
  .eq('source', 'elterngruppe')
if (readError) {
  console.error('Lesen fehlgeschlagen:', readError.message)
  process.exit(1)
}
const have = new Set((existing ?? []).map((r) => r.title))

const rows = seed
  .filter((idea) => !have.has(idea.title))
  .map((idea) => ({
    event_id: null,
    title: idea.title.slice(0, 200),
    description: `${idea.description.trim()} ${formatDone(idea.done)}`,
    material: idea.material || null,
    was_used: false,
    source: 'elterngruppe',
    tags: idea.tags ?? [],
  }))

console.log(`${seed.length} Ideen in der Seed-Datei, ${have.size} bereits vorhanden, ${rows.length} neu.`)
if (dryRun || rows.length === 0) process.exit(0)

const { error } = await db.from('ideas').insert(rows)
if (error) {
  console.error('Insert fehlgeschlagen:', error.message)
  process.exit(1)
}
console.log(`${rows.length} Ideen importiert.`)
