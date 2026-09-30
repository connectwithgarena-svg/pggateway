PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY CHECK(id IN ('paytm','phonepe','hdfc','bharatpe')),label TEXT NOT NULL,upi TEXT NOT NULL,payee TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1))) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS active_profile ON profiles(active) WHERE active=1;
CREATE TABLE IF NOT EXISTS pairings(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL,device_id TEXT UNIQUE) STRICT;
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,pair_hash TEXT UNIQUE NOT NULL REFERENCES pairings(hash),name TEXT NOT NULL,pem TEXT NOT NULL,epoch INTEGER NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,last_seen INTEGER,health TEXT NOT NULL DEFAULT '{}') STRICT;
CREATE TRIGGER IF NOT EXISTS consume_pair AFTER INSERT ON devices BEGIN UPDATE pairings SET device_id=NEW.id WHERE hash=NEW.pair_hash; END;
CREATE TABLE IF NOT EXISTS api_keys(id TEXT PRIMARY KEY,label TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,enabled INTEGER NOT NULL DEFAULT 1) STRICT;
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,scope TEXT NOT NULL,idem TEXT NOT NULL,request_hash TEXT NOT NULL,requested INTEGER NOT NULL CHECK(requested>0 AND requested%100=0),payable INTEGER NOT NULL CHECK(payable>requested AND payable-requested<=599 AND payable%100!=0),profile TEXT NOT NULL REFERENCES profiles(id),upi TEXT NOT NULL,payee TEXT NOT NULL,name TEXT NOT NULL,external_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','cancelled')),created INTEGER NOT NULL,expires INTEGER NOT NULL,grace INTEGER NOT NULL,reuse INTEGER NOT NULL,paid_at INTEGER,evidence TEXT,UNIQUE(scope,idem),CHECK(created<expires AND expires<grace AND grace<reuse),CHECK((status='paid' AND paid_at IS NOT NULL AND evidence IS NOT NULL) OR (status!='paid' AND paid_at IS NULL AND evidence IS NULL))) STRICT;
CREATE INDEX IF NOT EXISTS payments_created ON payments(created DESC);
CREATE INDEX IF NOT EXISTS payments_pending ON payments(status,grace);
CREATE TABLE IF NOT EXISTS slots(amount INTEGER PRIMARY KEY,payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),until INTEGER NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS slots_expiry ON slots(until);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id),source_id TEXT NOT NULL,hash TEXT NOT NULL,package TEXT NOT NULL,profile TEXT,amount INTEGER,posted INTEGER NOT NULL,received INTEGER NOT NULL,status TEXT NOT NULL,payment_id TEXT REFERENCES payments(id),UNIQUE(device_id,source_id)) STRICT;
CREATE INDEX IF NOT EXISTS events_received ON events(received DESC);
CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,payment_id TEXT NOT NULL REFERENCES payments(id),endpoint TEXT NOT NULL,secret TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,last_status INTEGER) STRICT;
CREATE INDEX IF NOT EXISTS deliveries_due ON deliveries(status,next_at);
CREATE TRIGGER IF NOT EXISTS confirm_payment AFTER INSERT ON events WHEN NEW.payment_id IS NOT NULL BEGIN
 UPDATE payments SET status='paid',paid_at=NEW.posted,evidence=NEW.id WHERE id=NEW.payment_id AND status='pending' AND NEW.received<=grace;
 UPDATE events SET status=CASE WHEN EXISTS(SELECT 1 FROM payments WHERE id=NEW.payment_id AND evidence=NEW.id) THEN 'matched' ELSE 'corroborated' END WHERE id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS queue_paid AFTER UPDATE OF status ON payments WHEN NEW.status='paid' AND OLD.status!='paid' BEGIN
 INSERT INTO deliveries(id,payment_id,endpoint,secret,payload,next_at)
 SELECT 'paid_'||NEW.id,NEW.id,json_extract(value,'$.endpoint'),json_extract(value,'$.secret'),json_object('id','paid_'||NEW.id,'type','payment.paid','payment',json_object('id',NEW.id,'external_id',NEW.external_id,'status','paid','requested_amount_paise',NEW.requested,'payable_amount_paise',NEW.payable,'paid_at_ms',NEW.paid_at)),NEW.paid_at FROM settings WHERE key='webhook' AND json_extract(value,'$.endpoint')!='';
END;
CREATE TRIGGER IF NOT EXISTS guard_destination BEFORE UPDATE OF upi ON profiles WHEN NEW.upi!=OLD.upi AND EXISTS(SELECT 1 FROM payments WHERE profile=OLD.id AND status='pending' AND grace>unixepoch('subsec')*1000) BEGIN SELECT RAISE(ABORT,'pending_destination_change'); END;
