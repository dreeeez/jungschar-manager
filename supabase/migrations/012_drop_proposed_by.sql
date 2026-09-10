-- Migration 012: Aufräumen. proposed_by wurde am 2026-09-10 von Hand angelegt,
-- bevor 011 mit suggested_by (Bot /idee) zusammengeführt wurde. Der Ideenpool
-- nutzt seitdem nur suggested_by.
ALTER TABLE ideas DROP COLUMN IF EXISTS proposed_by;
