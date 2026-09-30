CREATE TABLE IF NOT EXISTS payment_returns(payment_id TEXT PRIMARY KEY REFERENCES payments(id),url TEXT NOT NULL) STRICT;
INSERT INTO settings(key,value) VALUES('schema_version','5') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
