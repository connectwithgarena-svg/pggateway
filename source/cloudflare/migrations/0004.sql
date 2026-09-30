CREATE TABLE IF NOT EXISTS bharatpe_rows(id TEXT PRIMARY KEY,first_event TEXT NOT NULL,received INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS bharatpe_snapshots(device_id TEXT PRIMARY KEY REFERENCES devices(id),event_id TEXT NOT NULL,rows TEXT NOT NULL,posted INTEGER NOT NULL,received INTEGER NOT NULL) STRICT;
CREATE TRIGGER IF NOT EXISTS guard_new_payment_amount BEFORE INSERT ON payments WHEN NEW.payable-NEW.requested NOT BETWEEN 1 AND 99 BEGIN SELECT RAISE(ABORT,'invalid_payment_adjustment'); END;
INSERT INTO settings(key,value) VALUES('schema_version','4') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
