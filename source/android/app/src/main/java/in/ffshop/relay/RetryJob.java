package in.ffshop.relay;

import android.app.job.JobParameters;
import android.app.job.JobService;

public final class RetryJob extends JobService {
    @Override public boolean onStartJob(JobParameters params) {
        Relay relay = Relay.get(this);
        relay.worker.execute(() -> { relay.flush(false); jobFinished(params, false); });
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) { return true; }
}
