/* =====================================================================
   Talking to Supabase. Plain fetch — no libraries, nothing loaded from
   anyone else's server.
   ===================================================================== */
(function (w) {
  "use strict";

  var URL_ = (w.CONFIG && w.CONFIG.SUPABASE_URL || "").replace(/\/+$/, "");
  var KEY = (w.CONFIG && w.CONFIG.SUPABASE_ANON_KEY) || "";
  var SESSION_KEY = "mitchs.staff.session";

  function configured() {
    return URL_ && KEY && URL_.indexOf("YOUR-PROJECT") === -1 && KEY.indexOf("YOUR-ANON") === -1;
  }

  /* ---------- staff session (localStorage, staff devices only) ------- */
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }
  function setSession(s) {
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }
  function accessToken() {
    var s = getSession();
    return s && s.access_token ? s.access_token : null;
  }

  function headers(useSession, extra) {
    var h = {
      "apikey": KEY,
      "Content-Type": "application/json",
      "Accept": "application/json"
    };
    var tok = useSession ? accessToken() : null;
    h["Authorization"] = "Bearer " + (tok || KEY);
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  function netError() {
    var e = new Error("We could not reach the shop's system. Check your connection and try again.");
    e.offline = true;
    return e;
  }

  function request(path, opts, useSession) {
    if (!configured()) {
      return Promise.reject(new Error("The site is not connected to its database yet. See README step 2."));
    }
    return fetch(URL_ + path, opts).then(function (r) {
      if (r.status === 204) return null;
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
        if (r.ok) return data;
        if (r.status === 401 && useSession) { setSession(null); }
        var msg = (data && (data.message || data.error_description || data.hint || data.error)) || "";
        var err = new Error(msg || ("Request failed (" + r.status + ")"));
        err.status = r.status;
        err.body = data;
        throw err;
      });
    }, function () { throw netError(); });
  }

  /* ---------- database ---------- */
  function rpc(fn, args, useSession) {
    return request("/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: headers(useSession),
      body: JSON.stringify(args || {})
    }, useSession);
  }

  function select(table, query, useSession) {
    return request("/rest/v1/" + table + (query ? "?" + query : ""), {
      method: "GET",
      headers: headers(useSession)
    }, useSession);
  }

  function insert(table, rows, useSession) {
    return request("/rest/v1/" + table, {
      method: "POST",
      headers: headers(useSession, { Prefer: "return=representation" }),
      body: JSON.stringify(rows)
    }, useSession);
  }

  function update(table, query, patch, useSession) {
    return request("/rest/v1/" + table + "?" + query, {
      method: "PATCH",
      headers: headers(useSession, { Prefer: "return=representation" }),
      body: JSON.stringify(patch)
    }, useSession);
  }

  function remove(table, query, useSession) {
    return request("/rest/v1/" + table + "?" + query, {
      method: "DELETE",
      headers: headers(useSession)
    }, useSession);
  }

  /* ---------- staff auth ---------- */
  function signIn(email, password) {
    return request("/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (s) {
      s.expires_at = Date.now() + ((s.expires_in || 3600) - 60) * 1000;
      setSession(s);
      return s;
    });
  }

  function refresh() {
    var s = getSession();
    if (!s || !s.refresh_token) return Promise.reject(new Error("No session"));
    return request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (n) {
      n.expires_at = Date.now() + ((n.expires_in || 3600) - 60) * 1000;
      setSession(n);
      return n;
    }, function (e) { setSession(null); throw e; });
  }

  function ensureSession() {
    var s = getSession();
    if (!s) return Promise.reject(new Error("Not signed in"));
    if (s.expires_at && Date.now() > s.expires_at) return refresh();
    return Promise.resolve(s);
  }

  function signOut() {
    var tok = accessToken();
    setSession(null);
    if (!tok) return Promise.resolve();
    return fetch(URL_ + "/auth/v1/logout", {
      method: "POST",
      headers: { apikey: KEY, Authorization: "Bearer " + tok }
    }).catch(function () {});
  }

  function changePassword(newPassword) {
    return ensureSession().then(function () {
      return request("/auth/v1/user", {
        method: "PUT",
        headers: headers(true),
        body: JSON.stringify({ password: newPassword })
      }, true);
    });
  }

  w.API = {
    configured: configured,
    rpc: rpc, select: select, insert: insert, update: update, remove: remove,
    signIn: signIn, signOut: signOut, refresh: refresh,
    ensureSession: ensureSession, getSession: getSession, changePassword: changePassword
  };
})(window);
