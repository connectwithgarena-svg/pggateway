package in.ffshop.relay;
import android.app.Notification;
import android.content.Context;
import android.widget.RemoteViews;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class NotificationContentTest {
    private final Context context = RuntimeEnvironment.getApplication();
    @Test public void inboxLinesRetainNegativeAndRepeatedAmounts() {
        Notification n = new Notification();
        n.extras.putCharSequence(Notification.EXTRA_TEXT, "₹10.21 received");
        n.extras.putCharSequenceArray(Notification.EXTRA_TEXT_LINES, new CharSequence[]{"₹10.21 received", "₹10.21 refunded"});
        NotificationContent c = NotificationContent.read(context, "com.google.android.apps.nbu.paisa.merchant", n);
        assertEquals("₹10.21 received\n₹10.21 refunded", c.big); assertEquals("", c.error);
    }
    @Test public void malformedOrOversizedFieldsDiscardTheWholeReceipt() {
        Notification n = new Notification();
        n.extras.putString(Notification.EXTRA_TEXT, "₹10.21 received");
        n.extras.putInt(Notification.EXTRA_BIG_TEXT, 123);
        NotificationContent c = NotificationContent.read(context,"com.bharatpe.app",n);
        assertFalse(c.error.isEmpty()); assertEquals("",c.text);
        n.extras.putString(Notification.EXTRA_BIG_TEXT,"x".repeat(4097));
        assertFalse(NotificationContent.read(context,"com.bharatpe.app",n).error.isEmpty());
    }
    @Test public void absentExtrasStillReadsCustomLayout() {
        Notification n = new Notification(); n.extras = null;
        n.contentView = new RemoteViews(context.getPackageName(), R.layout.ffshop_receipt_fixture);
        n.contentView.setTextViewText(android.R.id.text1, "₹10.21 received");
        n.contentView.setTextViewText(android.R.id.text2, "Test customer");
        NotificationContent c = NotificationContent.read(context,"com.bharatpe.app",n);
        assertEquals("₹10.21 received\nTest customer",c.big); assertEquals("",c.error);
    }
    @Test public void negativeInboxTextIsNotHiddenByPositiveBigText() {
        Notification n = new Notification(); n.extras.putString(Notification.EXTRA_BIG_TEXT,"₹10.21 received");
        n.extras.putCharSequenceArray(Notification.EXTRA_TEXT_LINES,new CharSequence[]{"Payment reversed"});
        assertEquals("₹10.21 received\nPayment reversed",NotificationContent.read(context,"com.paytm.business",n).big);
    }
}
