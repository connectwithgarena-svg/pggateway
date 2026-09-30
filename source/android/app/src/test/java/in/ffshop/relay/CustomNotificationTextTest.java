package in.ffshop.relay;

import android.app.Notification;
import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class CustomNotificationTextTest {
    private final Context context = RuntimeEnvironment.getApplication();
    private RemoteViews layout(String first, String second) {
        RemoteViews view = new RemoteViews(context.getPackageName(), R.layout.ffshop_receipt_fixture);
        view.setTextViewText(android.R.id.text1, first);
        view.setTextViewText(android.R.id.text2, second);
        return view;
    }
    @Test public void bharatPeIndividualCustomLayoutIsReadWithoutInventingReceiptStatus() {
        Notification n = new Notification();
        n.contentView = layout("10:10 AM\nTest Customer", "₹4.96\nClose\nRefresh");
        CustomNotificationText.Result r = CustomNotificationText.read(context, "com.bharatpe.app", n);
        assertEquals("10:10 AM\nTest Customer\n₹4.96\nClose\nRefresh", r.text);
        assertEquals("", r.error);
        assertNull(n.extras.getCharSequence(Notification.EXTRA_TEXT));
    }
    @Test public void bharatPeExpandedLayoutPreservesNegativeAndMultipleTransactionText() {
        Notification n = new Notification();
        n.contentView = layout("₹4.96", "");
        n.bigContentView = layout("₹4.96 received", "₹3.21 refunded");
        assertEquals("₹4.96 received\n₹3.21 refunded", CustomNotificationText.read(context, "com.bharatpe.app", n).text);
    }
    @Test public void bharatPeGroupSummaryIsNotRead() {
        Notification n = new Notification();
        n.contentView = layout("₹4.96", "Test Customer");
        n.flags |= Notification.FLAG_GROUP_SUMMARY;
        CustomNotificationText.Result r = CustomNotificationText.read(context, "com.bharatpe.app", n);
        assertEquals("", r.text);
        assertEquals("", r.error);
    }
    @Test public void bharatPeBrokenLayoutDiscardsAllText() {
        Notification n = new Notification();
        n.contentView = layout("₹4.96", "Test Customer");
        n.bigContentView = new RemoteViews(context.getPackageName(), 1);
        CustomNotificationText.Result r = CustomNotificationText.read(context, "com.bharatpe.app", n);
        assertEquals("", r.text);
        assertFalse(r.error.isEmpty());
    }
    @Test public void allSupportedBusinessCustomLayoutsAreRead() {
        for (String packageName : new String[]{"com.paytm.business", "com.bharatpe.app", "com.phonepe.app.business", "com.hdfc.smarthub", "com.google.android.apps.nbu.paisa.merchant"}) {
            Notification n = new Notification();
            n.contentView = layout("₹10.21 received", "Test Customer");
            CustomNotificationText.Result r = CustomNotificationText.read(context, packageName, n);
            assertEquals(packageName, "₹10.21 received\nTest Customer", r.text);
            assertEquals("", r.error);
            n.flags |= Notification.FLAG_GROUP_SUMMARY;
            assertEquals("", CustomNotificationText.read(context, packageName, n).text);
        }
    }
    @Test public void expandedHindiTextIsReadWhenExtrasAreEmpty() {
        Notification n = new Notification();
        n.contentView = layout("Payment Received on Paytm for Business", "");
        n.bigContentView = layout("₹13.69 Test Customer से प्राप्त हुआ", "30 Sep 2026 09:17 AM को प्राप्त हुआ");
        CustomNotificationText.Result r = CustomNotificationText.read(context, "com.paytm.business", n);
        assertEquals("₹13.69 Test Customer से प्राप्त हुआ\n30 Sep 2026 09:17 AM को प्राप्त हुआ", r.text);
        assertEquals("", r.error);
    }
    @Test public void collapsedLayoutWorksAndInvisibleTextIsExcluded() {
        Notification n = new Notification();
        n.contentView = layout("₹13.69 received", "₹90.00");
        n.contentView.setViewVisibility(android.R.id.text2, View.GONE);
        assertEquals("₹13.69 received", CustomNotificationText.read(context, "com.paytm.business", n).text);
    }
    @Test public void summariesAndOtherPackagesAreNeverRead() {
        Notification n = new Notification(); n.contentView = layout("₹13.69 received", "");
        assertEquals("", CustomNotificationText.read(context, "com.other.app", n).text);
        n.flags |= Notification.FLAG_GROUP_SUMMARY;
        assertEquals("", CustomNotificationText.read(context, "com.paytm.business", n).text);
    }
    @Test public void ambiguityAndNegativeTextArePreservedForServerRejection() {
        Notification n = new Notification(); n.bigContentView = layout("₹13.69 received", "₹13.69 रिफंड");
        assertEquals("₹13.69 received\n₹13.69 रिफंड", CustomNotificationText.read(context, "com.paytm.business", n).text);
    }
    @Test public void oversizedOrBrokenExpandedLayoutNeverUsesPartialOrCollapsedText() {
        Notification n = new Notification(); n.contentView = layout("₹13.69 received", "");
        n.bigContentView = layout("₹13.69 received", "x".repeat(4097));
        CustomNotificationText.Result tooLong = CustomNotificationText.read(context, "com.paytm.business", n);
        assertEquals("", tooLong.text); assertFalse(tooLong.error.isEmpty());
        n.bigContentView = new RemoteViews(context.getPackageName(), 1);
        CustomNotificationText.Result broken = CustomNotificationText.read(context, "com.paytm.business", n);
        assertEquals("", broken.text); assertFalse(broken.error.isEmpty());
    }
}
