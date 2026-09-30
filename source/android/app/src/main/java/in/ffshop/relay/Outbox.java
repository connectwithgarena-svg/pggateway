package in.ffshop.relay;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/** Keep delivered IDs for seven days so listener reconnects cannot submit them again. */
final class Outbox extends SQLiteOpenHelper {
    Outbox(Context context) { super(context, "relay-outbox.db", null, 1); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE events (id TEXT PRIMARY KEY, body TEXT NOT NULL, created INTEGER NOT NULL, state INTEGER NOT NULL DEFAULT 0)");
    }
    @Override public void onOpen(SQLiteDatabase db) { super.onOpen(db); db.execSQL("UPDATE events SET body='' WHERE state IN (1,2) AND body!=''"); }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { throw new IllegalStateException("Unsupported database upgrade"); }
    void add(String id, String body) {
        SQLiteDatabase db = getWritableDatabase();
        db.delete("events", "state=1 AND created<?", new String[]{Long.toString(System.currentTimeMillis() - 7 * 86400000L)});
        try (Cursor existing = db.rawQuery("SELECT 1 FROM events WHERE id=?", new String[]{id})) {
            if (existing.moveToFirst()) return;
        }
        if (count(0) + count(2) >= 5000) throw new IllegalStateException("Queue full. Restore server connection and inspect failed events.");
        ContentValues row = new ContentValues();
        row.put("id", id); row.put("body", body); row.put("created", System.currentTimeMillis());
        db.insertOrThrow("events", null, row);
    }
    int count(int state) {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT count(*) FROM events WHERE state=?", new String[]{Integer.toString(state)})) {
            c.moveToFirst(); return c.getInt(0);
        }
    }
    String[] next() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id,body FROM events WHERE state=0 ORDER BY created,id LIMIT 1", null)) {
            return c.moveToFirst() ? new String[]{c.getString(0), c.getString(1)} : null;
        }
    }
    void mark(String id, int state) {
        ContentValues v = new ContentValues(); v.put("state", state);
        // Retain failure counts and IDs, never terminal notification bodies.
        if (state == 1 || state == 2) v.put("body", "");
        getWritableDatabase().update("events", v, "id=?", new String[]{id});
    }
    void clear() { getWritableDatabase().delete("events", null, null); }
}
