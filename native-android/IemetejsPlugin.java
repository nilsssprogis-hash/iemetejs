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
            // Tikai "rādīt pāri bloķēšanai" — ekrānu pati lietotne NEIESLĒDZ (to dara barošanas poga).
            if (Build.VERSION.SDK_INT >= 27) {
                a.setShowWhenLocked(on);
                a.setTurnScreenOn(false);
            } else {
                if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
                else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED);
                a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
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
