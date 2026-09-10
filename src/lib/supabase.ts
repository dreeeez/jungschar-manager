import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Supabase-Client der Mini-App.
 *
 * Zeigt NICHT mehr direkt auf Supabase, sondern auf den eigenen Proxy
 * unter /api/db. Dort wird die Session geprüft und die Anfrage mit dem
 * Service-Key weitergereicht. Im Browser liegt damit kein Datenbank-
 * Schlüssel mehr — der frühere NEXT_PUBLIC_SUPABASE_ANON_KEY wird nicht
 * mehr gebraucht.
 *
 * Weil der Proxy die PostgREST-Pfade (rest/v1/…) 1:1 spiegelt, bleibt die
 * gewohnte supabase-js-API in den Seiten unverändert nutzbar.
 */

// Beim Server-Prerender der Client-Komponenten gibt es kein window. Dort
// werden keine Queries ausgeführt (die laufen in useEffect), der Wert
// dient nur dazu, dass createClient eine gültige URL bekommt.
const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'

export const supabase = createClient<Database>(`${origin}/api/db`, 'via-proxy', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    // Session-Cookie mitschicken.
    fetch: (input, init) => fetch(input, { ...init, credentials: 'same-origin' }),
  },
})
