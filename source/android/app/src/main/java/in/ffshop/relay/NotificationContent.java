package in.ffshop.relay;

import android.app.Notification;
import android.content.Context;
import android.os.Bundle;

/** Bounded, shared extraction for capture and the local inspector. */
final class NotificationContent {
    final String title, text, big, error;
    private NotificationContent(String title, String text, String big, String error) {
        this.title = title; this.text = text; this.big = big; this.error = error;
    }
    static NotificationContent read(Context context, String pkg, Notification n) {
        try {
            Bundle extras = n.extras;
            String title = field(extras, Notification.EXTRA_TITLE);
            String text = field(extras, Notification.EXTRA_TEXT);
            String big = field(extras, Notification.EXTRA_BIG_TEXT);
            // InboxStyle can expose its receipt only in EXTRA_TEXT_LINES. Preserve
            // all lines (including negative states), even when big text exists.
            Object rawLines = extras == null ? null : extras.get(Notification.EXTRA_TEXT_LINES);
            if (rawLines != null) {
                if (!(rawLines instanceof CharSequence[])) throw new IllegalArgumentException();
                CharSequence[] lines = (CharSequence[]) rawLines;
                if (lines.length > 64) throw new IllegalArgumentException();
                StringBuilder joined = new StringBuilder();
                for (CharSequence line : lines) {
                    if (line == null) continue;
                    if (joined.length() > 0) joined.append('\n');
                    joined.append(line);
                    if (joined.length() > 4096) throw new IllegalArgumentException();
                }
                String expanded = joined.toString().trim();
                if (!expanded.isEmpty() && !big.contains(expanded))
                    big = big.isEmpty() ? expanded : big + "\n" + expanded;
            }
            if (text.trim().isEmpty() && big.trim().isEmpty()) {
                CustomNotificationText.Result custom = CustomNotificationText.read(context, pkg, n);
                if (!custom.error.isEmpty()) return new NotificationContent("", "", "", custom.error);
                big = custom.text;
            }
            if (title.length() > 4096 || text.length() > 4096 || big.length() > 4096)
                throw new IllegalArgumentException();
            return new NotificationContent(title, text, big, "");
        } catch (RuntimeException e) {
            return new NotificationContent("", "", "", "Notification fields are unreadable or too large. Check merchant history; no partial receipt sent.");
        }
    }
    private static String field(Bundle extras, String key) {
        Object value = extras == null ? null : extras.get(key);
        if (value == null) return "";
        if (!(value instanceof CharSequence)) throw new IllegalArgumentException();
        String result = value.toString();
        if (result.length() > 4096) throw new IllegalArgumentException();
        return result;
    }
}
