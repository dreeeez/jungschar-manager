import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@jungschar/shared/database.types';

// Lazy initialization to ensure env vars are loaded
let _supabase: SupabaseClient<Database> | null = null;

function getSupabase(): SupabaseClient<Database> {
  if (!_supabase) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    }

    _supabase = createClient<Database>(supabaseUrl, supabaseKey);
  }
  return _supabase;
}

// Use getter for supabase client
const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_, prop) {
    return (getSupabase() as any)[prop];
  }
});

// Export supabase client
export { supabase };

// Helper functions for database operations

export async function getHelperByTelegramId(telegramUserId: number) {
  const { data, error } = await supabase
    .from('helpers')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .single();

  if (error) return null;
  return data;
}

export async function registerHelper(name: string, telegramUserId: number, telegramUsername?: string) {
  const { data, error } = await supabase
    .from('helpers')
    .upsert({
      name,
      telegram_user_id: telegramUserId,
      telegram_username: telegramUsername
    }, { onConflict: 'telegram_user_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getNextEvent() {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      assignments (
        helper:helpers (*)
      ),
      event_status (*)
    `)
    .gte('event_date', new Date().toISOString().split('T')[0])
    .order('event_date', { ascending: true })
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

export async function getUpcomingEvents(limit = 5) {
  const { data, error } = await supabase
    .from('events')
    .select(`
      *,
      assignments (
        helper:helpers (*)
      )
    `)
    .gte('event_date', new Date().toISOString().split('T')[0])
    .order('event_date', { ascending: true })
    .limit(limit);

  if (error) return [];
  return data;
}

export async function updateEventStatus(
  eventId: string,
  status: {
    idea_ready?: boolean;
    food_communicated?: boolean;
    all_ready?: boolean;
    needs_help?: boolean;
    help_note?: string;
  }
) {
  const { data, error } = await supabase
    .from('event_status')
    .upsert({
      event_id: eventId,
      ...status,
      updated_at: new Date().toISOString()
    }, { onConflict: 'event_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getBirthdaysThisWeek() {
  const today = new Date();
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + 7);

  const { data, error } = await supabase
    .from('children')
    .select('*')
    .eq('active', true);

  if (error) return [];

  // Filter for birthdays this week (ignoring year)
  return data.filter(child => {
    if (!child.birthday) return false;
    const birthday = new Date(child.birthday);
    const thisYearBirthday = new Date(today.getFullYear(), birthday.getMonth(), birthday.getDate());
    return thisYearBirthday >= today && thisYearBirthday <= endOfWeek;
  });
}

export async function getAssignmentsForHelper(helperId: string) {
  const { data, error } = await supabase
    .from('assignments')
    .select(`
      *,
      event:events (*)
    `)
    .eq('helper_id', helperId)
    .gte('event.event_date', new Date().toISOString().split('T')[0])
    .order('event(event_date)', { ascending: true });

  if (error) return [];
  return data;
}
