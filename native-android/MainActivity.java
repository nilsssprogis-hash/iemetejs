package lv.iemetejs.app;

import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Kad true, skaļuma pogas nemaina skaļumu, bet tiek nodotas lietotnei kā + / −. */
    public static volatile boolean volumeKeys = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(IemetejsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (volumeKeys && (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0 && getBridge() != null) {
                String dir = code == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down";
                getBridge().triggerWindowJSEvent("iemetejsVolume", "{\"dir\":\"" + dir + "\"}");
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
