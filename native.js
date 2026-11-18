/* Элсэн цаг — the native (iOS app) layer. In a browser this file does nothing but set NATIVE=false.
 *
 * Storage: the app keeps using localStorage (synchronous, as it always has). Every write to an elsen_* key
 * is mirrored to Capacitor Preferences (iOS UserDefaults: survives web-storage clean-ups and is part of the
 * phone's iCloud/computer backup). Nothing is ever deleted from localStorage here.
 *  - First start of the native app: every elsen_* key in localStorage is copied to Preferences.
 *  - iOS emptied the web storage: everything is copied back from Preferences and the page reloads once.
 * Notifications: reminders and running timers are scheduled with the system, so they arrive while the
 * app is closed. No server is involved.
 */
(function () {
  "use strict";
  const C = window.Capacitor;
  const native = !!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform());
  window.NATIVE = native;
  if (!native) return;

  const Plug = C.Plugins || {};
  const Pref = Plug.Preferences, LN = Plug.LocalNotifications, FS = Plug.Filesystem, Share = Plug.Share;
  const NativeApp = (window.NativeApp = {});

  /* ---------- storage: localStorage mirrored to Preferences ---------- */
  const MARK_P = "elsen_native_v1"; // in Preferences: the data has been copied there (value: when)
  const MARK_L = "elsen_native_ls"; // in localStorage: this localStorage is the one Preferences mirrors
  const ours = k => typeof k === "string" && /^elsen_/.test(k) && k !== MARK_L && k !== MARK_P;
  const ls = window.localStorage, proto = Storage.prototype, rawSet = proto.setItem, rawRemove = proto.removeItem;
  let ready = false, chain = Promise.resolve();
  const queue = new Map(); // writes made before the start-up check finished: key -> value | null

  function send(k, v) {
    if (!Pref) return;
    if (!ready) { queue.set(k, v); return; }
    // one at a time, in order: a later write never lands before an earlier one
    chain = chain.then(() => (v == null ? Pref.remove({ key: k }) : Pref.set({ key: k, value: v }))).catch(() => {});
  }
  proto.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === ls && ours(String(k))) send(String(k), String(v));
  };
  proto.removeItem = function (k) {
    rawRemove.call(this, k);
    if (this === ls && ours(String(k))) send(String(k), null);
  };

  NativeApp.storageReady = (async () => {
    if (!Pref) return;
    try {
      const copied = (await Pref.get({ key: MARK_P })).value;
      if (copied && ls.getItem(MARK_L) == null) {
        // Web storage was emptied (iOS may do this under low space): bring every key back, then start again.
        const { keys } = await Pref.keys();
        for (const k of keys) {
          if (!ours(k)) continue;
          const { value } = await Pref.get({ key: k });
          if (value != null) rawSet.call(ls, k, value);
        }
        rawSet.call(ls, MARK_L, copied);
        location.reload();
        return new Promise(() => {}); // the page is going away
      }
      // First start: copy everything that is already here. Later starts: make sure Preferences has
      // every key localStorage has (a write can be lost if the app was killed mid-way).
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (!ours(k)) continue;
        const v = ls.getItem(k), old = (await Pref.get({ key: k })).value;
        if (old !== v) await Pref.set({ key: k, value: v });
      }
      if (!copied) {
        const at = new Date().toISOString();
        await Pref.set({ key: MARK_P, value: at });
        rawSet.call(ls, MARK_L, at);
      }
    } catch (e) {
      console.warn("native storage", e);
    }
    ready = true;
    for (const [k, v] of queue) send(k, v);
    queue.clear();
  })();

  /* ---------- notifications ---------- */
  let perm = "default"; // granted | denied | default — the same words as the web Notification API
  const norm = p => (p === "granted" ? "granted" : p === "denied" ? "denied" : "default");
  NativeApp.notifReady = (async () => {
    try { perm = norm((await LN.checkPermissions()).display); } catch (e) {}
  })();
  NativeApp.perm = () => perm;
  NativeApp.askNotif = async () => {
    try { perm = norm((await LN.requestPermissions()).display); } catch (e) {}
    return perm;
  };
  // Stable 31-bit id from a key such as "rem-t3-2026-11-18", so the same reminder keeps the same id.
  const nid = key => {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 1) || 1;
  };
  NativeApp.notify = async (title, body, key, inMs) => {
    if (perm !== "granted") return false;
    try {
      await LN.schedule({ notifications: [{ id: nid(key || "now-" + Date.now()), title, body,
        schedule: { at: new Date(Date.now() + (inMs || 1000)), allowWhileIdle: true } }] });
      return true;
    } catch (e) { return false; }
  };
  // Replace every pending notification with `list` ([{key, at, title, body}]); iOS keeps at most 64.
  let planChain = Promise.resolve();
  NativeApp.plan = list => (planChain = planChain.then(async () => {
    if (perm !== "granted") return;
    try {
      const pending = (await LN.getPending()).notifications || [];
      if (pending.length) await LN.cancel({ notifications: pending.map(n => ({ id: n.id })) });
      const items = list.slice(0, 60).map(x => ({ id: nid(x.key), title: x.title, body: x.body,
        schedule: { at: new Date(x.at), allowWhileIdle: true }, extra: { key: x.key } }));
      if (items.length) await LN.schedule({ notifications: items });
    } catch (e) { console.warn("native plan", e); }
  }));

  /* ---------- files: the backup goes out through the share sheet ---------- */
  NativeApp.shareFile = async (name, text, title) => {
    const { uri } = await FS.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" });
    await Share.share({ title, files: [uri] });
  };
})();
