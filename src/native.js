/* Telefona glabātuve un eksports (Capacitor). Pārlūkā šis fails neko nedara. */
(function () {
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.Plugins || {};
  var KEY = "kedes.data.v1";
  window.NativeStore = {
    load: function () {
      if (!P.Preferences) return Promise.resolve(null);
      return P.Preferences.get({ key: KEY }).then(function (r) { return (r && r.value) || null; }).catch(function () { return null; });
    },
    save: function (json) {
      try { if (P.Preferences) P.Preferences.set({ key: KEY, value: json }); } catch (e) {}
    },
    getKV: function (k) {
      if (!P.Preferences) return Promise.resolve(null);
      return P.Preferences.get({ key: k }).then(function (r) { return (r && r.value) || null; }).catch(function () { return null; });
    },
    setKV: function (k, v) { try { if (P.Preferences) return v ? P.Preferences.set({ key: k, value: v }) : P.Preferences.remove({ key: k }); } catch (e) {} return Promise.resolve(); },
    // Paziņojumi (Firebase Cloud Messaging). Darbojas tikai, ja lietotne uzbūvēta ar google-services.json.
    pushInit: function (onToken, onTap, onReceive) {
      var PN = P.PushNotifications;
      if (!PN || !window.PUSH_ENABLED) return Promise.resolve(false);
      PN.addListener("registration", function (t) { if (t && t.value) onToken(t.value); });
      PN.addListener("registrationError", function (e) { console.warn("push", e); });
      PN.addListener("pushNotificationActionPerformed", function (a) { var d = a && a.notification && a.notification.data; if (d && d.roundId) onTap(d.roundId); });
      PN.addListener("pushNotificationReceived", function (n) { if (onReceive) onReceive(n); });
      try { PN.createChannel({ id: "rounds", name: "Pabeigti raundi", description: "Kad draugs pabeidz kopīgu raundu", importance: 4 }); } catch (e) {}
      return PN.checkPermissions()
        .then(function (p) { return p.receive === "granted" ? p : PN.requestPermissions(); })
        .then(function (p) { if (p.receive === "granted") { PN.register(); return true; } return false; })
        .catch(function () { return false; });
    },
    get hasDevice() { return !!((C.Plugins || {}).Iemetejs); },
    setLockScreen: function (on) { try { if (P.Iemetejs) return P.Iemetejs.setLockScreen({ enabled: !!on }); } catch (e) {} return Promise.resolve(); },
    setVolumeKeys: function (on) { try { if (P.Iemetejs) return P.Iemetejs.setVolumeKeys({ enabled: !!on }); } catch (e) {} return Promise.resolve(); },
    exportFile: function (name, data) {
      return P.Filesystem.writeFile({ path: name, data: data, directory: "CACHE", encoding: "utf8" })
        .then(function (r) {
          return P.Share.share({ title: "Iemetējs — rezerves kopija", files: [r.uri], dialogTitle: "Saglabāt vai nosūtīt rezerves kopiju" });
        });
    }
  };
})();
