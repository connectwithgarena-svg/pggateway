-- Existing installations: apply once after backing up D1. Keep 0001 unchanged.
ALTER TABLE profiles ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1));
ALTER TABLE profiles ADD COLUMN removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1));
ALTER TABLE events ADD COLUMN reason TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),profile TEXT NOT NULL,reference TEXT NOT NULL,amount INTEGER NOT NULL,created INTEGER NOT NULL,UNIQUE(profile,reference)) STRICT;
CREATE TRIGGER IF NOT EXISTS guard_profile_removal BEFORE UPDATE OF removed ON profiles WHEN NEW.removed=1 AND OLD.removed=0 AND EXISTS(SELECT 1 FROM payments WHERE profile=OLD.id AND status='pending' AND grace>unixepoch('subsec')*1000) BEGIN SELECT RAISE(ABORT,'pending_destination_change'); END;
CREATE TRIGGER IF NOT EXISTS guard_profile_state BEFORE UPDATE ON profiles WHEN NEW.active=1 AND (NEW.enabled=0 OR NEW.removed=1) BEGIN SELECT RAISE(ABORT,'invalid_profile_state'); END;
