#!/usr/bin/env node
/*
 * Import des Ideenpools aus supabase/seed/ideenpool.json in die ideas-Tabelle
 * (source='elterngruppe', was_used=false, ohne Termin).
 *
 * Liest SUPABASE_URL und SUPABASE_SERVICE_KEY aus .env.local.
 * Upsert nach Titel: vorhandene Elternchat-Ideen werden aktualisiert
 * (Beschreibung, Mitbringen, Tags, Herkunft), neue eingefügt. Manuell in der
 * App angelegte Ideen (source='manual') bleiben unberührt.
 * Mit --dry-run wird nur gezählt, nichts geschrieben.
 *
 *   node scripts/import-ideenpool.mjs [--dry-run]
 *
 * Voraussetzung: Migration 011 (Spalte suggested_by) ist eingespielt.
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

function toRow(idea) {
  return {
    title: idea.title.slice(0, 200),
    description: `${idea.description.trim()} ${formatDone(idea.done)}`,
    material: idea.material || null,
    tags: idea.tags ?? [],
    suggested_by: idea.suggested_by || null,
    // Datum der ersten Chat-Nachricht, 18:00 lokale Zeit als neutraler Zeitpunkt
    created_at: idea.proposed_at ? `${idea.proposed_at}T18:00:00+02:00` : undefined,
  }
}

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const { data: existing, error: readError } = await db
  .from('ideas')
  .select('id, title')
  .eq('source', 'elterngruppe')
if (readError) {
  console.error('Lesen fehlgeschlagen:', readError.message)
  process.exit(1)
}
const idByTitle = new Map((existing ?? []).map((r) => [r.title, r.id]))

const updates = []
const inserts = []
for (const idea of seed) {
  const row = toRow(idea)
  const id = idByTitle.get(row.title)
  if (id) updates.push({ id, ...row })
  else inserts.push({ ...row, event_id: null, was_used: false, source: 'elterngruppe' })
}

console.log(`${seed.length} Ideen in der Seed-Datei: ${updates.length} aktualisieren, ${inserts.length} neu.`)
if (dryRun) process.exit(0)

for (const { id, ...patch } of updates) {
  const { error } = await db.from('ideas').update(patch).eq('id', id)
  if (error) {
    console.error(`Update fehlgeschlagen (${patch.title}):`, error.message)
    process.exit(1)
  }
}
if (inserts.length > 0) {
  const { error } = await db.from('ideas').insert(inserts)
  if (error) {
    console.error('Insert fehlgeschlagen:', error.message)
    process.exit(1)
  }
}
console.log(`Fertig: ${updates.length} aktualisiert, ${inserts.length} eingefügt.`)
