-- Datenbank zumachen: kein Zugriff mehr mit dem öffentlichen Anon-Key.
--
-- Bisher hatte jede Tabelle eine Policy „FOR ALL USING (true)" — der Browser
-- schrieb mit dem Anon-Key direkt in die Datenbank, und wer die URL der App
-- kannte, konnte dasselbe. Seit dem Umbau (services/telegram-auth.ts, /api/db)
-- läuft jeder Zugriff über den Server, der sich mit dem Service-Role-Key
-- anmeldet. Der Service-Role umgeht RLS grundsätzlich, braucht also keine
-- Policy. Ohne Policies bleibt für anon/authenticated nichts mehr übrig.
--
-- Vorbedingung: das Deployment muss bereits mit dem echten Service-Role-Key
-- in SUPABASE_SERVICE_KEY laufen — sonst steht der Server danach genauso
-- vor verschlossener Tür wie der Browser.
--
-- Mehrfaches Ausführen ist ungefährlich.
DO $$
DECLARE
  pol RECORD;
  tbl RECORD;
BEGIN
  -- Alle Policies im public-Schema entfernen (auch die von Hand angelegten,
  -- z.B. auf parents/parent_duties, die in keiner Migration stehen).
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;

  -- RLS auf jeder Tabelle einschalten — ohne Policy heißt das: zu.
  FOR tbl IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.tablename);
  END LOOP;
END $$;

-- Kontrolle nach dem Lauf — sollte 0 Zeilen liefern:
--   SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';
