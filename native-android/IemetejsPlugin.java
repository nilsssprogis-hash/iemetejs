package lv.iemetejs.app;

import android.app.Activity;
import android.os.Build;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Iemetejs")
public class IemetejsPlugin extends Plugin {

    /** Spēles laikā rāda lietotni pāri bloķēšanas ekrānam (bez PIN), pēc spēles izslēdz. */
    @PluginMethod
    public void setLockScreen(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        final Activity a = getActivity();
        a.runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= 27) {
                a.setShowWhenLocked(on);
                a.setTurnScreenOn(on);
            } else {
                int flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON;
                if (on) a.getWindow().addFlags(flags); else a.getWindow().clearFlags(flags);
            }
            call.resolve();
        });
    }

    /** Ieslēdz vai izslēdz skaļuma pogu pārtveršanu. */
    @PluginMethod
    public void setVolumeKeys(PluginCall call) {
        MainActivity.volumeKeys = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }
}
