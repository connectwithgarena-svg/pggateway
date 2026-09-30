package in.ffshop.relay;
import android.content.Context;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;
@RunWith(RobolectricTestRunner.class) @Config(sdk=28)
public class OutboxTest {
 @Test public void terminalBodiesAreClearedWithoutLosingDeduplication() {
  Context context=RuntimeEnvironment.getApplication();
  try(Outbox outbox=new Outbox(context)) {
   outbox.add("accepted","private receipt"); outbox.add("rejected","private rejected receipt");
   outbox.mark("accepted",1); outbox.mark("rejected",2);
   outbox.add("accepted","must not requeue"); outbox.add("rejected","must not requeue");
   assertEquals(0,outbox.count(0)); assertEquals(1,outbox.count(1)); assertEquals(1,outbox.count(2));
   try(var c=outbox.getReadableDatabase().rawQuery("SELECT count(*) FROM events WHERE body!=''",null)) { c.moveToFirst(); assertEquals(0,c.getInt(0)); }
  }
 }
}
