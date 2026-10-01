package lv.iemetejs.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Kad true, skaļuma pogas nemaina skaļumu, bet tiek nodotas lietotnei. */
    public static volatile boolean volumeKeys = false;

    /** Cik ilgi jātur poga, lai tas skaitītos kā ilgs spiediens (ms). */
    private static final long LONG_MS = 550;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pendingLong = null;
    private boolean longFired = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IemetejsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    private void send(String kind, String dir) {
        if (getBridge() == null) return;
        getBridge().triggerWindowJSEvent("iemetejsVolume", "{\"dir\":\"" + dir + "\",\"kind\":\"" + kind + "\"}");
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (volumeKeys && (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            final String dir = code == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down";
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                // Poga nospiesta: gaidām. Ja tur ilgāk par LONG_MS — ilgs spiediens (punkti nemainās).
                if (pendingLong != null) handler.removeCallbacks(pendingLong);
                longFired = false;
                pendingLong = () -> { longFired = true; pendingLong = null; send("long", dir); };
                handler.postDelayed(pendingLong, LONG_MS);
            } else if (event.getAction() == KeyEvent.ACTION_UP) {
                // Poga atlaista: ja ilgais spiediens vēl nav nostrādājis — tas bija īss spiediens.
                if (pendingLong != null) { handler.removeCallbacks(pendingLong); pendingLong = null; }
                if (!longFired) send("short", dir);
                longFired = false;
            }
            return true; // skaļums nemainās
        }
        return super.dispatchKeyEvent(event);
    }
}
