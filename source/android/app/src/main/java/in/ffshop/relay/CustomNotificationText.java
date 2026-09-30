package in.ffshop.relay;

import android.app.Notification;
import android.content.Context;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

/** Reads visible text from supported merchant notification layouts; never clicks or attaches the view. */
final class CustomNotificationText {
    static final class Result {
        final String text;
        final String error;
        Result(String text, String error) { this.text = text; this.error = error; }
    }
    static Result read(Context context, String packageName, Notification notification) {
        if (Protocol.merchantProfile(packageName).isEmpty()
                || (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0)
            return new Result("", "");
        RemoteViews layout = notification.bigContentView != null ? notification.bigContentView : notification.contentView;
        if (layout == null) return new Result("", "");
        try {
            View root = layout.apply(context, new FrameLayout(context));
            List<String> lines = new ArrayList<>();
            collect(root, lines, new int[2], 0);
            return new Result(String.join("\n", lines), "");
        } catch (RuntimeException e) {
            // Do not forward partially extracted text: omitted text may contain a negative status.
            return new Result("", "Custom layout could not be read completely. No custom text forwarded.");
        }
    }
    private static void collect(View view, List<String> lines, int[] limits, int depth) {
        if (++limits[0] > 256 || depth > 20) throw new IllegalArgumentException("Layout too large");
        if (view.getVisibility() != View.VISIBLE) return;
        if (view instanceof TextView) {
            CharSequence value = ((TextView) view).getText();
            String text = value == null ? "" : value.toString().trim();
            if (!text.isEmpty()) {
                limits[1] += text.length() + (lines.isEmpty() ? 0 : 1);
                if (limits[1] > 4096) throw new IllegalArgumentException("Text too large");
                // Preserve repeated amounts so the backend can reject ambiguous receipts.
                lines.add(text);
            }
        }
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) collect(group.getChildAt(i), lines, limits, depth + 1);
        }
    }
}
