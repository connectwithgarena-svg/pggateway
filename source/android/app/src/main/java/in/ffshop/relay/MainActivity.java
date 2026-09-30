package in.ffshop.relay;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.text.DateFormat;
import java.util.Date;

public final class MainActivity extends Activity {
    private Relay relay;
    private EditText link;
    private Button pair;
    private boolean pairing;
    private TextView status;
    private final Handler timer = new Handler(Looper.getMainLooper());
    private final Runnable refresh = new Runnable() { @Override public void run() { showStatus(); timer.postDelayed(this, 2000); } };
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        relay = Relay.get(this);
        ScrollView scroll = new ScrollView(this);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL); layout.setPadding(36, 40, 36, 40);
        scroll.addView(layout); setContentView(scroll);
        // Keep controls below status/navigation bars on Android 15's edge-to-edge layout.
        scroll.setOnApplyWindowInsetsListener((v, insets) -> { v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); return insets; });
        TextView heading = new TextView(this); heading.setText(getApplicationInfo().loadLabel(getPackageManager())); heading.setTextSize(30); layout.addView(heading);
        TextView info = new TextView(this); info.setText("FF Shop • Your private payment connection\n\nReads notifications from the merchant apps you enable below and sends their title, text and time to the HTTPS server you pair below. No SMS, bank login or UPI PIN is requested. Android grants broad notification access, but this app filters other packages locally. New provider formats need a small real-payment test on your phone.\n"); layout.addView(info);
        status = new TextView(this); status.setTextIsSelectable(true); layout.addView(status);
        TextView appHelp = new TextView(this); appHelp.setText("Enable only the apps receiving payments for your FFSHOP profiles:"); layout.addView(appHelp);
        String[][] providers = {{"paytm", "Paytm Business"}, {"phonepe", "PhonePe Business"}, {"hdfc", "HDFC SmartHub Vyapar"}, {"bharatpe", "BharatPe for Business"}, {"gpay", "Google Pay Business (test on your phone)"}};
        for (String[] provider : providers) {
            android.widget.CheckBox box = new android.widget.CheckBox(this); box.setText(provider[1]);
            box.setChecked(relay.apps.getBoolean(provider[0], provider[0].equals("paytm")));
            box.setOnCheckedChangeListener((button, checked) -> relay.apps.edit().putBoolean(provider[0], checked).apply());
            layout.addView(box);
        }
        link = new EditText(this); link.setHint("Paste HTTPS pairing link"); link.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI); link.setSingleLine(true); link.setSaveEnabled(false); layout.addView(link);
        pair = button(layout, "1. Connect my FFSHOP server", v -> confirmPair());
        button(layout, "2. Allow notification access", v -> launch(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        button(layout, "3. Battery settings → Unrestricted", v -> launch(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        button(layout, "4. Start relay / retry connection", v -> startRelay());
        button(layout, "Inspect active merchant notifications", v -> {
            TextView details = new TextView(this); details.setTextIsSelectable(true);
            details.setPadding(24, 16, 24, 16); details.setText(PaytmListener.inspectActive());
            ScrollView panel = new ScrollView(this); panel.addView(details);
            AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Notification details (local only)")
                    .setView(panel).setPositiveButton("Close", null).create();
            dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            dialog.show();
        });
        button(layout, "Open my dashboard", v -> { if (relay.paired()) launch(new Intent(Intent.ACTION_VIEW, Uri.parse(relay.prefs.getString("origin", "")))); });
        button(layout, "Disconnect this phone", v -> new AlertDialog.Builder(this).setTitle("Disconnect and clear local queue?")
                .setMessage("First inspect pending/failed events. This deletes local pairing and queued notifications. Also revoke this phone in dashboard Settings.")
                .setNegativeButton("Cancel", null).setPositiveButton("Disconnect", (d, w) -> {
                    stopService(new Intent(this, RelayService.class));
                    relay.worker.execute(() -> { try { relay.disconnect(); } catch (Exception e) { relay.error("Could not remove device key"); } runOnUiThread(this::showStatus); });
                }).show());
        TextView notes = new TextView(this); notes.setText("\nKeep your selected business apps logged in, payment notifications ON and internet connected. Set phone date/time to automatic. Reopen this app and tap Start after a reboot or force stop.\n\nDelivered means the server received evidence; check the dashboard for Paid. Delivery alone does not confirm a payment. Never fulfil an order based only on a customer screenshot.\n\nVersion " + Relay.VERSION + " • Source and AGPL licence included in the FFSHOP package."); layout.addView(notes);
    }
    private Button button(LinearLayout parent, String text, View.OnClickListener action) {
        Button b = new Button(this); b.setText(text); b.setAllCaps(false); b.setOnClickListener(action); parent.addView(b); return b;
    }
    private void launch(Intent intent) {
        try { startActivity(intent); } catch (Exception e) { new AlertDialog.Builder(this).setMessage("Open this setting manually from Android Settings.").setPositiveButton("OK", null).show(); }
    }
    private void confirmPair() {
        if (relay.paired()) return;
        try {
            Protocol.PairLink parsed = Protocol.parseLink(link.getText().toString());
            new AlertDialog.Builder(this).setTitle("Trust this server?").setMessage("Payment notifications will be sent to:\n\n" + parsed.origin() + "\n\nContinue only if this is your own FFSHOP server.")
                    .setNegativeButton("Cancel", null).setPositiveButton("Connect", (d, w) -> {
                        pairing = true; pair.setEnabled(false);
                        relay.worker.execute(() -> {
                            try { relay.pair(parsed); runOnUiThread(() -> { link.setText(""); startRelay(); }); }
                            catch (Exception e) { relay.error("Pairing failed. Check HTTPS and use a fresh link (expires in 2 minutes)."); }
                            runOnUiThread(() -> { pairing = false; showStatus(); });
                        });
                    }).show();
        } catch (Exception e) { new AlertDialog.Builder(this).setMessage(e.getMessage()).setPositiveButton("OK", null).show(); }
    }
    private void startRelay() {
        if (!relay.paired()) { new AlertDialog.Builder(this).setMessage("Connect your server first.").setPositiveButton("OK", null).show(); return; }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        startForegroundService(new Intent(this, RelayService.class));
        NotificationListenerService.requestRebind(new ComponentName(this, PaytmListener.class));
        relay.scheduleJob(); relay.kick(true); showStatus();
    }
    private String when(long value) { return value == 0 ? "Never" : DateFormat.getDateTimeInstance().format(new Date(value)); }
    private void showStatus() {
        pair.setEnabled(!relay.paired() && !pairing); link.setEnabled(!relay.paired());
        status.setText("Server: " + relay.prefs.getString("origin", "Not connected") + "\nListener: " + (PaytmListener.connected ? "connected" : "not connected")
                + "\nBackground relay: " + (RelayService.running ? "running" : "stopped")
                + "\nQueued: " + relay.outbox.count(0) + " • Rejected: " + relay.outbox.count(2)
                + " • Capture failures: " + relay.prefs.getInt("capture_failures", 0)
                + "\nLast server contact: " + when(relay.prefs.getLong("contact", 0))
                + "\nLast evidence delivered: " + when(relay.prefs.getLong("delivered", 0))
                + "\nLast server result: " + relay.prefs.getString("receipt", "None")
                + "\n" + relay.prefs.getString("error", "") + "\n");
    }
    @Override public void onResume() { super.onResume(); timer.post(refresh); }
    @Override public void onPause() { timer.removeCallbacks(refresh); super.onPause(); }
}
