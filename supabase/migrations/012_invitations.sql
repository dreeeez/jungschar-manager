-- /einladen im Bot: Eltern laden die Jungschar zu einem konkreten Termin zu
-- sich nach Hause ein. Nur per Buttons (Termin wählen → bestätigen).
-- Eine Einladung pro Termin; der Elterndienst (parent_duties) bleibt getrennt.
CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (event_id)
);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
