package in.ffshop.relay;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.util.Base64;
import java.util.Locale;

/** No Android dependencies: tested against the backend's canonical signing format. */
public final class Protocol {
    public record PairLink(String origin, String token) {}
    public static PairLink parseLink(String value) throws Exception {
        URI uri = new URI(value.trim());
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                || uri.getQuery() != null || uri.getFragment() != null || uri.getPort() == 0
                || !uri.getRawPath().matches("/device/pair/[A-Za-z0-9_-]{20,256}")) {
            throw new IllegalArgumentException("Paste the complete HTTPS pairing link from your FFSHOP dashboard.");
        }
        return new PairLink("https://" + uri.getRawAuthority(), uri.getRawPath().substring("/device/pair/".length()));
    }
    public static String hash(byte[] value) throws Exception {
        byte[] sum = MessageDigest.getInstance("SHA-256").digest(value);
        StringBuilder hex = new StringBuilder();
        for (byte b : sum) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        return hex.toString();
    }
    public static String canonical(String path, String timestamp, long epoch, byte[] body) throws Exception {
        return "POST\n" + path + "\n" + timestamp + "\n" + epoch + "\n" + hash(body);
    }
    public static String sign(PrivateKey key, String path, String timestamp, long epoch, byte[] body) throws Exception {
        Signature signature = Signature.getInstance("SHA256withECDSA");
        signature.initSign(key);
        signature.update(canonical(path, timestamp, epoch, body).getBytes(StandardCharsets.UTF_8));
        return Base64.getEncoder().encodeToString(signature.sign());
    }
    public static String merchantProfile(String packageName) {
        if (packageName == null) return "";
        switch (packageName) {
            case "com.paytm.business": return "paytm";
            case "com.phonepe.app.business": return "phonepe";
            case "com.hdfc.smarthub": return "hdfc";
            case "com.bharatpe.app": return "bharatpe";
            case "com.google.android.apps.nbu.paisa.merchant": return "gpay";
            default: return "";
        }
    }
    public static boolean accept(String packageName, boolean summary, long posted, long enrolled, long now) {
        return !merchantProfile(packageName).isEmpty() && !summary && enrolled > 0
                && posted >= enrolled && posted <= now + 60_000 && now - posted <= 24 * 60 * 60_000L;
    }
    private Protocol() {}
}
