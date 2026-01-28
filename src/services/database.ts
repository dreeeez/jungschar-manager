import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy initialization - only created on first request
let supabase: SupabaseClient | null = null

/**
 * Gibt den Supabase Client zurück (Server-seitig mit Service Key)
 * Lazy initialization um Build-Fehler zu vermeiden
 */
export function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    )
  }
  return supabase
}

/**
 * Gibt das heutige Datum im ISO Format zurück
 */
export function getTodayISO(): string {
  return new Date().toISOString().split('T')[0]
}
