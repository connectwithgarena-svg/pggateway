package in.ffshop.relay;

import android.app.Notification;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;

public final class PaytmListener extends NotificationListenerService {
    static volatile boolean connected;
    private static volatile PaytmListener activeListener;
    @Override public void onListenerConnected() {
        connected = true;
        activeListener = this;
        StatusBarNotification[] active = getActiveNotifications();
        if (active != null) for (StatusBarNotification n : active) capture(n);
        Relay.get(this).kick(true);
    }
    @Override public void onListenerDisconnected() { connected = false; activeListener = null; Relay.get(this).kick(true); }
    @Override public void onDestroy() { connected = false; activeListener = null; super.onDestroy(); }
    @Override public void onNotificationPosted(StatusBarNotification n) { capture(n); }
    private void capture(StatusBarNotification n) {
        if (n == null) return;
        Relay relay = Relay.get(this);
        if (!relay.appEnabled(n.getPackageName())) return;
        long enrollment = relay.epoch();
        Notification notification = n.getNotification();
        if (!Protocol.accept(n.getPackageName(), (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0,
                n.getPostTime(), enrollment, System.currentTimeMillis())) return;
        NotificationContent content = NotificationContent.read(this, n.getPackageName(), notification);
        if (!content.error.isEmpty()) {
            relay.worker.execute(() -> { relay.prefs.edit().putInt("capture_failures", relay.prefs.getInt("capture_failures", 0) + 1).apply(); relay.error(content.error); });
            return;
        }
        String title = content.title, text = content.text, big = content.big;
        if (title.isEmpty() && text.isEmpty() && big.isEmpty()) {
            relay.error("Merchant notification has no readable text. Inspect the notification and verify in merchant history.");
            return;
        }
        // Capture immutable fields now. Database/network work is serialized off the Android main thread.
        String packageName = n.getPackageName(), notificationKey = n.getKey();
        long posted = n.getPostTime();
        relay.worker.execute(() -> {
            if (enrollment != relay.epoch() || !relay.appEnabled(packageName)) return;
            try {
                String fingerprint = new org.json.JSONArray().put(packageName).put(notificationKey).put(posted)
                        .put(title).put(text).put(big).toString();
                String id = Protocol.hash(fingerprint.getBytes(StandardCharsets.UTF_8));
                JSONObject body = new JSONObject().put("schema_version", 1).put("event_id", id)
                        .put("package_name", packageName).put("posted_at_ms", posted)
                        .put("title", title).put("text", text).put("big_text", big);
                relay.outbox.add(id, body.toString());
            } catch (Exception e) { relay.prefs.edit().putInt("capture_failures", relay.prefs.getInt("capture_failures", 0) + 1).apply(); relay.error("Could not queue a notification. Check storage and failed count; inspect payment manually."); }
            relay.kick(false);
        });
    }
    /** Read-only, user-triggered inspection. Never queues, stores or sends these details. */
    static String inspectActive() {
        PaytmListener listener = activeListener;
        if (!connected || listener == null) return "Listener not connected. Allow notification access, then tap Start relay.";
        try {
            StatusBarNotification[] active = listener.getActiveNotifications();
            StringBuilder report = new StringBuilder("Local inspection only. These are the fields Relay reads.\nNames may be present; hide them before sharing.\n");
            int count = 0;
            Relay relay = Relay.get(listener);
            if (active != null) for (StatusBarNotification item : active) {
                if (item == null || !relay.appEnabled(item.getPackageName())) continue;
                if (count == 20) { report.append("\nMore notifications omitted.\n"); break; }
                count++;
                Notification n = item.getNotification();
                boolean summary = (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0;
                report.append("\n--- ").append(item.getPackageName()).append(" ---\n")
                        .append("Posted: ").append(new java.util.Date(item.getPostTime())).append("\n")
                        .append("Group summary: ").append(summary).append("\n")
                        .append("Eligible for capture: ").append(Protocol.accept(item.getPackageName(), summary, item.getPostTime(), relay.epoch(), System.currentTimeMillis())).append("\n")
                        .append("Custom layout: ").append(n.contentView != null || n.bigContentView != null).append("\n");
                NotificationContent content = NotificationContent.read(listener, item.getPackageName(), n);
                report.append("Title: ").append(content.title.isEmpty() ? "(empty)" : content.title).append("\n")
                        .append("Text: ").append(content.text.isEmpty() ? "(empty)" : content.text).append("\n")
                        .append("Expanded / custom text: ").append(content.big.isEmpty() ? "(empty)" : content.big).append("\n");
                if (!content.error.isEmpty()) report.append(content.error).append("\n");
            }
            if (count == 0) report.append("\nNo active notifications from enabled merchant apps. Dismissed notifications cannot be inspected.\n");
            return report.toString();
        } catch (RuntimeException error) {
            return "Could not read active notifications. Check notification access and tap Start relay, then try again.";
        }
    }
}
