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
    exportFile: function (name, data) {
      return P.Filesystem.writeFile({ path: name, data: data, directory: "CACHE", encoding: "utf8" })
        .then(function (r) {
          return P.Share.share({ title: "Iemetējs — rezerves kopija", files: [r.uri], dialogTitle: "Saglabāt vai nosūtīt rezerves kopiju" });
        });
    }
  };
})();
