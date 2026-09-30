-- FF Shop 1.5: apply AFTER 0002, as one migration/file. Back up D1 first.
-- Keep child references to profiles intact while extending the provider constraint.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE profiles_v15(id TEXT PRIMARY KEY CHECK(id IN ('paytm','phonepe','hdfc','bharatpe','gpay')),label TEXT NOT NULL,upi TEXT NOT NULL,payee TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1))) STRICT;
INSERT INTO profiles_v15 SELECT id,label,upi,payee,active,enabled,removed FROM profiles;
DROP TABLE profiles;
ALTER TABLE profiles_v15 RENAME TO profiles;
CREATE UNIQUE INDEX active_profile ON profiles(active) WHERE active=1;
CREATE TRIGGER guard_destination BEFORE UPDATE OF upi ON profiles WHEN NEW.upi!=OLD.upi AND EXISTS(SELECT 1 FROM payments WHERE profile=OLD.id AND status='pending' AND grace>unixepoch('subsec')*1000) BEGIN SELECT RAISE(ABORT,'pending_destination_change'); END;
CREATE TRIGGER guard_profile_removal BEFORE UPDATE OF removed ON profiles WHEN NEW.removed=1 AND OLD.removed=0 AND EXISTS(SELECT 1 FROM payments WHERE profile=OLD.id AND status='pending' AND grace>unixepoch('subsec')*1000) BEGIN SELECT RAISE(ABORT,'pending_destination_change'); END;
CREATE TRIGGER guard_profile_state BEFORE UPDATE ON profiles WHEN NEW.active=1 AND (NEW.enabled=0 OR NEW.removed=1) BEGIN SELECT RAISE(ABORT,'invalid_profile_state'); END;
-- Re-consent to any inherited callback destination after this privacy upgrade.
DELETE FROM settings WHERE key='webhook';
UPDATE deliveries SET status='cancelled',endpoint='',secret='',payload='',lease=NULL,lease_until=0 WHERE status IN ('pending','retry','exhausted');
INSERT INTO settings(key,value) VALUES('schema_version','3') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
PRAGMA defer_foreign_keys=OFF;
