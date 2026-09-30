package in.ffshop.relay;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

public final class RelayService extends Service {
    static volatile boolean running;
    private final Handler timer = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override public void run() { Relay.get(RelayService.this).kick(false); timer.postDelayed(this, 60000); }
    };
    @Override public void onCreate() {
        super.onCreate();
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("relay", "FFSHOP relay status", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, "relay").setSmallIcon(R.drawable.ic_ffshop)
                .setContentTitle("FFSHOP Relay is running").setContentText("Selected merchant notifications → your server. Tap for connection health.")
                .setOngoing(true).setContentIntent(open).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(4102, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(4102, notification);
        running = true; timer.post(tick);
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!Relay.get(this).paired()) { stopSelf(); return START_NOT_STICKY; }
        return START_STICKY;
    }
    @Override public void onDestroy() { running = false; timer.removeCallbacks(tick); super.onDestroy(); }
    @Override public IBinder onBind(Intent intent) { return null; }
}
