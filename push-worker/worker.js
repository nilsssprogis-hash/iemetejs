// Iemetējs paziņojumu serveris (Cloudflare Worker, bezmaksas).
// POST /notify {roundId}  + Authorization: Bearer <Firebase ID token>
// Pārbauda, ka sūtītājs ir raunda dalībnieks, un nosūta pārējiem dalībniekiem paziņojumu ar rezultātiem (FCM).
// Vajadzīgs Worker noslēpums FIREBASE_SA — Firebase servisa konta JSON.

const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = s => b64url(enc.encode(s));
const fromB64url = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });

let tokenCache = null; // { token, exp }
let jwksCache = null;  // { keys, exp }

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp > now + 60) return tokenCache.token;
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlStr(JSON.stringify({
    iss: sa.client_email, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging"
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(header + "." + claim));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + header + "." + claim + "." + b64url(sig)
  });
  const t = await r.json();
  if (!t.access_token) throw new Error("token: " + JSON.stringify(t));
  tokenCache = { token: t.access_token, exp: now + (t.expires_in || 3600) };
  return t.access_token;
}

async function verifyIdToken(idToken, projectId) {
  const [h, p, s] = idToken.split(".");
  if (!s) throw new Error("bad token");
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== "https://securetoken.google.com/" + projectId || payload.exp < now || !payload.sub) throw new Error("token claims");
  if (!jwksCache || jwksCache.exp < Date.now()) {
    const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    jwksCache = { keys: (await r.json()).keys, exp: Date.now() + 3600e3 };
  }
  const jwk = jwksCache.keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error("unknown kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(s), enc.encode(h + "." + p));
  if (!ok) throw new Error("signature");
  return payload.sub;
}

const val = v => v == null ? null : "stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) :
  "doubleValue" in v ? v.doubleValue : "booleanValue" in v ? v.booleanValue : "nullValue" in v ? null :
  "arrayValue" in v ? (v.arrayValue.values || []).map(val) : "mapValue" in v ? obj(v.mapValue.fields || {}) :
  "timestampValue" in v ? v.timestampValue : null;
const obj = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, val(v)]));

async function getDoc(base, path, token) {
  const r = await fetch(base + "/" + path, { headers: { authorization: "Bearer " + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("firestore " + r.status);
  return obj((await r.json()).fields || {});
}

const rel = d => d === 0 ? "E" : d > 0 ? "+" + d : "−" + Math.abs(d);

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "POST" } });
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "iemetejs-push" });
    if (url.pathname !== "/notify" || req.method !== "POST") return json({ error: "not found" }, 404);
    try {
      const sa = JSON.parse(env.FIREBASE_SA);
      const pid = sa.project_id;
      const auth = req.headers.get("authorization") || "";
      const uid = await verifyIdToken(auth.replace(/^Bearer\s+/i, ""), pid).catch(() => null);
      if (!uid) return json({ error: "unauthorized" }, 401);
      const { roundId } = await req.json();
      if (!roundId || !/^[\w.~:@+-]{1,200}$/.test(roundId)) return json({ error: "bad round" }, 400);

      const at = await accessToken(sa);
      const base = "https://firestore.googleapis.com/v1/projects/" + pid + "/databases/(default)/documents";
      const round = await getDoc(base, "rounds/" + roundId, at);
      if (!round) return json({ error: "no round yet" }, 409);
      if (!(round.memberUids || []).includes(uid)) return json({ error: "forbidden" }, 403);
      if (round.status !== "done") return json({ error: "not finished yet" }, 409);
      if (round.notified) return json({ ok: true, already: true });

      // atzīmē kā paziņotu, lai tas pats raunds netiktu sūtīts divreiz
      await fetch(base + "/rounds/" + roundId + "?updateMask.fieldPaths=notified", {
        method: "PATCH", headers: { authorization: "Bearer " + at, "content-type": "application/json" },
        body: JSON.stringify({ fields: { notified: { booleanValue: true } } })
      });

      const pars = round.pars || [], cells = round.cells || {};
      const rows = (round.players || []).map((p, i) => {
        let tot = 0, d = 0, n = 0;
        pars.forEach((par, h) => { const s = cells["p" + i + "_h" + h]; if (s != null) { tot += s; d += s - par; n++; } });
        return { name: p.name, tot, d, n };
      }).filter(r => r.n).sort((a, b) => a.d - b.d);
      let place = 0, prev = null;
      const body = rows.map((r, i) => { if (r.d !== prev) { place = i + 1; prev = r.d; } return place + ". " + r.name + " " + rel(r.d) + " (" + r.tot + ")"; }).join(" · ");
      const finisher = (round.players || []).find(p => p.uid === uid);
      const title = "Raunds pabeigts · " + (round.courseName || "disku golfs");

      let sent = 0;
      for (const m of (round.memberUids || [])) {
        if (m === uid) continue;
        const u = await getDoc(base, "users/" + m, at);
        if (!u || u.notify === false) continue;
        for (const token of (u.fcmTokens || []).slice(-5)) {
          const r = await fetch("https://fcm.googleapis.com/v1/projects/" + pid + "/messages:send", {
            method: "POST", headers: { authorization: "Bearer " + at, "content-type": "application/json" },
            body: JSON.stringify({ message: {
              token,
              notification: { title, body: body || ((finisher && finisher.name) || "Draugs") + " pabeidza raundu" },
              data: { roundId },
              android: { priority: "high", notification: { channel_id: "rounds", tag: roundId } }
            } })
          });
          if (r.ok) sent++;
        }
      }
      return json({ ok: true, sent });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  }
};
