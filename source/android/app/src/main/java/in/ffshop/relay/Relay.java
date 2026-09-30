package in.ffshop.relay;

import android.app.ActivityManager;
import android.app.NotificationManager;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.PowerManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONObject;
import javax.net.ssl.HttpsURLConnection;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

final class Relay {
    static final String VERSION = "1.5.0";
    private static final String KEY = "ffshop-relay-device";
    private static Relay instance;
    final Context context;
    final SharedPreferences prefs;
    final SharedPreferences apps;
    final Outbox outbox;
    final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean scheduled = new AtomicBoolean();
    private Relay(Context context) {
        this.context = context.getApplicationContext();
        prefs = this.context.getSharedPreferences("connection", Context.MODE_PRIVATE);
        apps = this.context.getSharedPreferences("merchant-apps", Context.MODE_PRIVATE);
        outbox = new Outbox(this.context);
    }
    static synchronized Relay get(Context context) { if (instance == null) instance = new Relay(context); return instance; }
    boolean appEnabled(String packageName) {
        String provider = Protocol.merchantProfile(packageName);
        return !provider.isEmpty() && apps.getBoolean(provider, provider.equals("paytm"));
    }
    boolean paired() { return !prefs.getString("device", "").isEmpty(); }
    long epoch() { return prefs.getLong("epoch", 0); }
    private KeyStore keys() throws Exception { KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null); return ks; }
    private void ensureKey() throws Exception {
        if (keys().containsAlias(KEY)) return;
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
        generator.initialize(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256).build());
        generator.generateKeyPair();
    }
    void pair(Protocol.PairLink link) throws Exception {
        if (paired()) throw new IllegalStateException("Disconnect the current server first.");
        ensureKey();
        String pem = "-----BEGIN PUBLIC KEY-----\n" + Base64.getMimeEncoder(64, new byte[]{10})
                .encodeToString(keys().getCertificate(KEY).getPublicKey().getEncoded()) + "\n-----END PUBLIC KEY-----\n";
        JSONObject body = new JSONObject().put("token", link.token()).put("name", "FFSHOP " + Build.MODEL)
                .put("public_key_pem", pem).put("app_version", VERSION).put("device_model", Build.MODEL)
                .put("android_version", Build.VERSION.RELEASE);
        JSONObject response = post(link.origin(), "/api/v4/relay/pair", body.toString(), false);
        String device = response.getString("device_id"); long epoch = response.getLong("enrolled_at_ms");
        if (!device.matches("[a-f0-9]{64}") || epoch <= 0 || !response.getBoolean("enabled")) throw new Exception("Invalid pairing response");
        outbox.clear();
        if (!prefs.edit().clear().putString("origin", link.origin()).putString("device", device).putLong("epoch", epoch).commit())
            throw new Exception("Could not save pairing. Create a new link and retry.");
        scheduleJob();
    }
    void disconnect() throws Exception {
        if (!prefs.edit().clear().commit()) throw new Exception("Could not clear pairing");
        outbox.clear(); keys().deleteEntry(KEY);
        context.getSystemService(JobScheduler.class).cancel(4101);
    }
    private static final class HttpFailure extends Exception {
        final int code;
        HttpFailure(int code) { super("Server HTTP " + code); this.code = code; }
    }
    private JSONObject post(String origin, String path, String json, boolean signed) throws Exception {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        HttpsURLConnection c = (HttpsURLConnection) new URL(origin + path).openConnection();
        c.setInstanceFollowRedirects(false); c.setConnectTimeout(15000); c.setReadTimeout(15000);
        c.setRequestMethod("POST"); c.setDoOutput(true); c.setFixedLengthStreamingMode(body.length);
        c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("Accept", "application/json");
        try {
            if (signed) {
                String timestamp = Long.toString(System.currentTimeMillis());
                c.setRequestProperty("X-PayGate-Relay-Device", prefs.getString("device", ""));
                c.setRequestProperty("X-PayGate-Relay-Time", timestamp);
                c.setRequestProperty("X-PayGate-Relay-Epoch", Long.toString(epoch()));
                c.setRequestProperty("X-PayGate-Relay-Signature", Protocol.sign((PrivateKey)keys().getKey(KEY, null), path, timestamp, epoch(), body));
            }
            try (var out = c.getOutputStream()) { out.write(body); }
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) throw new HttpFailure(code);
            try (InputStream in = c.getInputStream()) {
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[4096]; int n;
                while ((n = in.read(buffer)) != -1) { if (bytes.size() + n > 65536) throw new Exception("Response too large"); bytes.write(buffer, 0, n); }
                return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
            }
        } finally { c.disconnect(); }
    }
    void error(String message) { prefs.edit().putString("error", message).apply(); }
    void kick(boolean force) {
        if (!scheduled.compareAndSet(false, true)) return;
        worker.execute(() -> { try { flush(force); } finally { scheduled.set(false); } });
    }
    void flush(boolean force) {
        if (!paired() || (!force && System.currentTimeMillis() < prefs.getLong("retry_at", 0))) return;
        try {
            String[] row;
            long started = android.os.SystemClock.elapsedRealtime();
            for (int n = 0; n < 20 && android.os.SystemClock.elapsedRealtime() - started < 45000 && (row = outbox.next()) != null; n++) {
                try {
                    JSONObject result = post(prefs.getString("origin", ""), "/api/v4/relay/events", row[1], true);
                    if (!row[0].equals(result.optString("event_id")) || result.optString("status").isEmpty()) throw new Exception("Invalid event receipt");
                    outbox.mark(row[0], 1);
                    prefs.edit().putLong("delivered", System.currentTimeMillis()).putString("receipt", result.getString("status")).apply();
                } catch (HttpFailure e) {
                    if (e.code == 400 || e.code == 413 || e.code == 422) { outbox.mark(row[0], 2); error("An event was rejected. Check server Activity; failed count retained."); continue; }
                    throw e;
                }
            }
            post(prefs.getString("origin", ""), "/api/v4/relay/heartbeat", heartbeat().toString(), true);
            prefs.edit().putLong("retry_at", 0).putInt("failures", 0).putLong("contact", System.currentTimeMillis())
                    .putString("error", outbox.count(2) + prefs.getInt("capture_failures", 0) > 0 ? "Some notifications failed. Check counts and verify affected payments manually." : "").apply();
        } catch (Exception e) {
            int attempts = Math.min(9, prefs.getInt("failures", 0) + 1);
            String message = e instanceof HttpFailure ? e.getMessage() : "Connection or signing failed. Check HTTPS, internet and phone time.";
            if (e instanceof HttpFailure && (((HttpFailure)e).code == 401 || ((HttpFailure)e).code == 403))
                message += ". Check automatic date/time and whether this device was revoked; reconnect if needed.";
            prefs.edit().putInt("failures", attempts).putLong("retry_at", System.currentTimeMillis() + Math.min(900000L, 5000L << attempts)).putString("error", message).apply();
        }
    }
    private JSONObject heartbeat() throws Exception {
        PowerManager power = context.getSystemService(PowerManager.class);
        String listeners = android.provider.Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
        boolean access = false;
        if (listeners != null) for (String item : listeners.split(":"))
            if (new ComponentName(context, PaytmListener.class).equals(ComponentName.unflattenFromString(item))) access = true;
        return new JSONObject().put("schema_version", 1).put("app_version", VERSION).put("android_version", Build.VERSION.RELEASE)
                .put("device_model", Build.MODEL).put("notification_access", access).put("listener_connected", PaytmListener.connected)
                .put("battery_optimization_exempt", power.isIgnoringBatteryOptimizations(context.getPackageName()))
                .put("power_save_mode", power.isPowerSaveMode())
                .put("background_restricted", Build.VERSION.SDK_INT >= 28 && context.getSystemService(ActivityManager.class).isBackgroundRestricted())
                .put("foreground_service", RelayService.running).put("pending_count", outbox.count(0)).put("failed_count", outbox.count(2) + prefs.getInt("capture_failures", 0))
                .put("last_successful_delivery_at_ms", prefs.getLong("delivered", 0)).put("last_client_error", prefs.getString("error", ""));
    }
    void scheduleJob() {
        context.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(4101, new ComponentName(context, RetryJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).setPeriodic(15 * 60 * 1000L).build());
    }
}
