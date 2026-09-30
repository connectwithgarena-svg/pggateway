package in.ffshop.relay;

import org.junit.Test;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import static org.junit.Assert.*;

public class ProtocolTest {
    @Test public void pairingRejectsInsecureOrAmbiguousDestinations() throws Exception {
        String token = "a".repeat(32);
        assertEquals("https://pay.example", Protocol.parseLink("https://pay.example/device/pair/" + token).origin());
        for (String url : new String[]{"http://pay.example/device/pair/" + token, "https://evil@pay.example/device/pair/" + token,
                "https://pay.example/device/pair/" + token + "?redirect=evil", "https://pay.example/device/pair/" + token + "#x",
                "https://pay.example/other/" + token, "https://pay.example/device/pair/%61" + token}) {
            assertThrows(url, Exception.class, () -> Protocol.parseLink(url));
        }
    }
    @Test public void filtersOtherAppsSummariesAndHistoricalNotifications() {
        for (String pkg : new String[]{"com.paytm.business", "com.phonepe.app.business", "com.hdfc.smarthub", "com.bharatpe.app", "com.google.android.apps.nbu.paisa.merchant"}) {
            assertTrue(Protocol.accept(pkg, false, 2000, 1000, 3000));
            assertFalse(Protocol.accept(pkg + ".fake", false, 2000, 1000, 3000));
        }
        assertEquals("phonepe", Protocol.merchantProfile("com.phonepe.app.business"));
        assertEquals("hdfc", Protocol.merchantProfile("com.hdfc.smarthub"));
        assertEquals("bharatpe", Protocol.merchantProfile("com.bharatpe.app"));
        assertEquals("", Protocol.merchantProfile("com.phonepe.app"));
        assertFalse(Protocol.accept("com.phonepe.app", false, 2000, 1000, 3000));
        assertFalse(Protocol.accept("com.paytm.business.fake", false, 2000, 1000, 3000));
        assertFalse(Protocol.accept("com.paytm.business", true, 2000, 1000, 3000));
        assertFalse(Protocol.accept("com.paytm.business", false, 999, 1000, 3000));
        assertFalse(Protocol.accept("com.paytm.business", false, 2000, 0, 3000));
        assertFalse(Protocol.accept("com.paytm.business", false, 90000, 1000, 3000));
        assertFalse(Protocol.accept("com.paytm.business", false, 2000, 1000, 86403000));
    }
    @Test public void canonicalSigningBindsBodyPathAndEnrollment() throws Exception {
        byte[] body = "{}".getBytes(StandardCharsets.UTF_8);
        String canonical = "POST\n/api/v4/relay/events\n1700000000000\n1699999999000\n44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
        assertEquals(canonical, Protocol.canonical("/api/v4/relay/events", "1700000000000", 1699999999000L, body));
        KeyPairGenerator gen = KeyPairGenerator.getInstance("EC"); gen.initialize(new ECGenParameterSpec("secp256r1"));
        var keys = gen.generateKeyPair();
        byte[] signed = Base64.getDecoder().decode(Protocol.sign(keys.getPrivate(), "/api/v4/relay/events", "1700000000000", 1699999999000L, body));
        Signature verify = Signature.getInstance("SHA256withECDSA"); verify.initVerify(keys.getPublic()); verify.update(canonical.getBytes(StandardCharsets.UTF_8)); assertTrue(verify.verify(signed));
        verify.initVerify(keys.getPublic()); verify.update((canonical + " ").getBytes(StandardCharsets.UTF_8)); assertFalse(verify.verify(signed));
    }
}
