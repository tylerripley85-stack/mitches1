/* =====================================================================
   MITCH'S BARBERSHOP — public website
   ===================================================================== */
(function () {
"use strict";

var CFG = null;                 // whatever public_config() gave us
var ROUTE = "home";
var FLASH = null;               // the confirmation screen after booking
var SLOTS = {};                 // cache: "date|service|barber" -> array
var BUSY = false;
var HASH_LOCK = false;

var BK = { step: 1, serviceId: null, barberId: "any", date: null, time: null,
           slotBarber: null, name: "", email: "", phone: "", notes: "", join: true };

var DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var ROUTES = { home: 1, book: 1, join: 1, find: 1 };

/* ---------------------------------------------------------------- utils */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function $(s, r) { return (r || document).querySelector(s); }
function pad(n) { return (n < 10 ? "0" : "") + n; }
function money(pence) {
  var c = (CFG && CFG.shop.currency) || "£";
  if (!pence) return "Free";
  return c + (pence / 100).toFixed(2).replace(/\.00$/, "");
}
function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function fromYmd(s) { var a = String(s).split("-"); return new Date(+a[0], (+a[1]) - 1, +a[2]); }
function prettyDate(s) {
  var d = fromYmd(s);
  return DOWS[d.getDay()] + " " + d.getDate() + " " + MONS[d.getMonth()];
}
function toMin(hhmm) { var a = String(hhmm || "0:0").split(":"); return (+a[0]) * 60 + (+a[1] || 0); }
function toHHMM(m) { return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
function initials(n) {
  return String(n || "?").trim().split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase();
}
function svcById(id) {
  if (!CFG) return null;
  for (var i = 0; i < CFG.services.length; i++) if (CFG.services[i].id === id) return CFG.services[i];
  return null;
}
function barberById(id) {
  if (!CFG) return null;
  for (var i = 0; i < CFG.barbers.length; i++) if (CFG.barbers[i].id === id) return CFG.barbers[i];
  return null;
}
function hoursFor(dateStr) {
  var dw = fromYmd(dateStr).getDay();
  for (var i = 0; i < CFG.hours.length; i++) if (CFG.hours[i].dow === dw) return CFG.hours[i];
  return null;
}
function todayStr() { return (CFG && CFG.today) || ymd(new Date()); }
function toast(msg, kind) {
  var t = document.createElement("div");
  t.className = "toast " + (kind || "");
  t.setAttribute("role", "status");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(function () {
    t.style.transition = "opacity .3s"; t.style.opacity = "0";
    setTimeout(function () { t.remove(); }, 320);
  }, kind === "bad" ? 6500 : 3800);
}
function contactLine() {
  var p = CFG && CFG.shop.phone, e = CFG && CFG.shop.email;
  if (p) return "Give the shop a ring on " + p + ".";
  if (e) return "Drop us an email at " + e + ".";
  return "Pop in and we will sort it.";
}
function dateRange() {
  var out = [], d = new Date(), n = (CFG.shop.horizon_days || 21);
  d = fromYmd(todayStr());
  for (var i = 0; i < n; i++) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
  return out;
}

/* ------------------------------------------------------------ chrome */
function header() {
  var nav = [["home", "Home"], ["book", "Book"], ["join", "Membership"], ["find", "Find us"]];
  return '<header class="top"><div class="wrap">'
    + '<a class="brand" href="#/home" data-act="go" data-route="home" aria-label="Mitch\'s Barbershop, home">'
    + '<img src="assets/logo.png" alt="Mitch\'s Barbershop" width="440" height="188"><i></i><span>Ramsgate</span></a>'
    + '<button class="burger" data-act="burger" aria-label="Menu" aria-expanded="false"><div></div><div></div><div></div></button>'
    + '<nav class="main" id="nav" aria-label="Main">'
    + nav.map(function (n) {
        return '<a href="#/' + n[0] + '" data-act="go" data-route="' + n[0] + '"'
          + (ROUTE === n[0] ? ' class="on" aria-current="page"' : '') + '>' + n[1] + '</a>';
      }).join("")
    + '<a class="btn sm" style="margin-left:8px" href="#/book" data-act="go" data-route="book">Book a chair</a>'
    + '</nav></div></header>';
}

function footer() {
  var s = CFG.shop;
  return '<footer class="site"><div class="wrap"><div class="fgrid">'
    + '<div><div class="brand big"><img src="assets/logo.png" alt="Mitch\'s Barbershop" width="440" height="188"></div>'
      + '<p class="muted small" style="margin-top:10px;max-width:36ch">' + esc(s.blurb) + '</p>'
      + '<h5 style="margin-top:22px">Join the cut card</h5>'
      + '<form class="sub" data-form="footjoin" novalidate>'
        + '<input type="email" name="email" placeholder="you@email.com" required aria-label="Email address" autocomplete="email">'
        + '<input class="hp" type="text" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true">'
        + '<button class="btn" type="submit">Join</button></form>'
      + '<p class="tiny muted" style="margin-top:8px">' + s.stamps_required + ' cuts, then one on the house. '
      + '<a href="privacy.html" style="text-decoration:underline">How we use your details</a>.</p></div>'
    + '<div><h5>The shop</h5><ul>'
      + '<li>' + esc(s.address_1) + '</li><li>' + esc(s.address_2) + '</li><li>' + esc(s.postcode) + '</li>'
      + (s.phone ? '<li><a href="tel:' + esc(s.phone.replace(/\s/g, "")) + '">' + esc(s.phone) + '</a></li>' : '')
      + (s.email ? '<li><a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a></li>' : '')
      + (s.instagram ? '<li>' + esc(s.instagram) + '</li>' : '')
      + '</ul></div>'
    + '<div><h5>Pages</h5><ul>'
      + '<li><a href="#/book" data-act="go" data-route="book">Book a chair</a></li>'
      + '<li><a href="#/join" data-act="go" data-route="join">Cut card</a></li>'
      + '<li><a href="#/find" data-act="go" data-route="find">Find us</a></li>'
      + '<li><a href="privacy.html">Privacy</a></li>'
      + '<li><a href="terms.html">Booking terms</a></li>'
      + '<li><a href="staff.html">Staff login</a></li>'
      + '</ul></div>'
    + '</div><div class="fbot"><span>&copy; ' + new Date().getFullYear() + ' Mitch\'s Barbershop. All rights reserved.</span>'
    + '<span class="r"><a href="staff.html">Staff</a></span></div></div></footer>';
}

function shell(inner) {
  return header() + '<main id="main">' + inner + '</main>' + footer();
}

/* --------------------------------------------------------- home page */
function hoursList() {
  var today = fromYmd(todayStr()).getDay();
  return '<ul class="hours">' + CFG.hours.map(function (h) {
    return '<li class="' + (h.dow === today ? "today" : "") + '"><b>' + esc(h.label) + '</b>'
      + '<span>' + (h.closed ? "Closed" : esc(h.opens) + " – " + esc(h.closes)) + '</span></li>';
  }).join("") + '</ul>';
}

function openNow() {
  var h = hoursFor(todayStr());
  if (!h || h.closed) return false;
  var n = new Date(), m = n.getHours() * 60 + n.getMinutes();
  return m >= toMin(h.opens) && m < toMin(h.closes);
}

function livePanelShell() {
  return '<aside class="live" id="live">'
    + '<div class="live-head"><span class="dot ' + (openNow() ? "" : "off") + '"></span>'
    + '<b>' + (openNow() ? "Open now" : "Next in the chair") + '</b><span>Live</span></div>'
    + '<div id="liveslots"><div class="loading" style="padding:26px 18px"><span class="spin"></span>Checking the diary…</div></div>'
    + '<div class="live-foot"><a class="btn wide" href="#/book" data-act="go" data-route="book">See the full diary</a></div></aside>';
}

/* The soonest free slots, spread across the team so it does not read
   as the same barber four times over. */
function loadNextOpenings() {
  var box = $("#liveslots");
  if (!box || !CFG.services.length) return;
  var svc = CFG.services.filter(function (s) { return s.price_pence > 0; })[0] || CFG.services[0];

  API.rpc("next_openings", { p_days: 3 }).then(function (rows) {
    if ($("#liveslots") !== box) return;
    if (!rows || !rows.length) {
      box.innerHTML = '<div class="empty">Fully booked for now. ' + esc(contactLine()) + '</div>';
      return;
    }
    // group the free barbers by slot, keeping the server's time order
    var order = [], bySlot = {};
    rows.forEach(function (r) {
      var k = r.slot_date + " " + r.slot_time;
      if (!bySlot[k]) { bySlot[k] = { date: r.slot_date, time: r.slot_time, free: [] }; order.push(k); }
      bySlot[k].free.push({ id: r.barber_id, name: r.barber_name });
    });

    var picked = [], used = {};
    for (var i = 0; i < order.length && picked.length < 4; i++) {
      var slot = bySlot[order[i]];
      // whoever has been named least so far, so the four lines show four faces
      slot.free.sort(function (a, b) { return (used[a.id] || 0) - (used[b.id] || 0); });
      var who = slot.free[0];
      used[who.id] = (used[who.id] || 0) + 1;
      picked.push({ date: slot.date, time: slot.time, id: who.id, name: who.name });
    }

    box.innerHTML = picked.map(function (o) {
      var when = o.date === todayStr() ? "Today" : prettyDate(o.date);
      return '<button class="slotline" data-act="quickslot" data-date="' + o.date + '" data-time="' + o.time
        + '" data-barber="' + esc(o.id) + '" data-service="' + esc(svc.id) + '">'
        + '<time>' + esc(o.time) + '</time>'
        + '<span><span class="who">' + esc(o.name) + '</span><br>'
        + '<span class="when">' + when + '</span></span><span class="go">&rarr;</span></button>';
    }).join("");
  }, function () {
    box.innerHTML = '<div class="empty">' + esc(contactLine()) + '</div>';
  });
}

function viewHome() {
  var s = CFG.shop;
  var paid = CFG.services.filter(function (v) { return v.price_pence > 0; });
  var cheapest = paid.length ? paid.reduce(function (a, b) { return b.price_pence < a.price_pence ? b : a; }) : null;
  var free = CFG.services.filter(function (v) { return v.price_pence === 0; })[0];

  var hero = '<section class="hero"><div class="wrap"><div>'
    + '<p class="eyebrow">' + esc(s.address_1) + ' &middot; ' + esc(s.address_2) + '</p>'
    + '<h1 class="dsp h1">Sharp cuts.<em>No waiting about.</em></h1>'
    + '<p class="lede">' + esc(s.blurb) + '</p>'
    + '<div class="hero-cta"><a class="btn" href="#/book" data-act="go" data-route="book">Book a chair</a>'
    + '<a class="btn ghost" href="#/join" data-act="go" data-route="join">Get your cut card</a></div>'
    + '<div class="hero-facts">'
      + '<div><b>' + CFG.barbers.length + '</b><small>CHAIRS</small></div>'
      + '<div><b>' + s.stamps_required + '</b><small>CUTS &rarr; ONE FREE</small></div>'
      + (cheapest ? '<div><b>' + money(cheapest.price_pence) + '</b><small>FROM</small></div>' : '')
      + (free ? '<div><b>£0</b><small>APPRENTICE CUTS</small></div>' : '')
    + '</div></div>' + livePanelShell() + '</div></section>';

  var services = '<section class="band" id="services"><div class="wrap">'
    + '<div class="sechead"><div><p class="eyebrow">The list</p><h2 class="dsp h2">Services &amp; prices</h2>'
    + '<p>Everything is booked by the chair, so the time you pick is the time you sit down.</p></div>'
    + '<div class="side"><a class="btn ghost" href="#/book" data-act="go" data-route="book">Book any of these</a></div></div>'
    + '<div class="svc">' + CFG.services.map(function (v) {
        return '<article' + (v.price_pence === 0 ? ' class="free"' : '') + '>'
          + '<h4>' + esc(v.name.replace(/ — free$/, "")) + (v.badge ? '<span class="badge">' + esc(v.badge) + '</span>' : '')
          + '<span class="price">' + money(v.price_pence) + '</span></h4>'
          + '<p>' + esc(v.description) + '</p><span class="dur">' + v.mins + ' min</span></article>';
      }).join("") + '</div></div></section>';

  var team = '<section class="band" id="team"><div class="wrap">'
    + '<div class="sechead"><div><p class="eyebrow">Behind the chairs</p><h2 class="dsp h2">The team</h2>'
    + '<p>Pick your barber when you book, or let us put you with whoever is free soonest.</p></div></div>'
    + '<div class="team">' + CFG.barbers.map(function (b) {
        return '<article class="chair"><div class="mono-badge">' + esc(initials(b.name)) + '</div>'
          + '<div><h4>' + esc(b.name) + '</h4><div class="role">' + esc(b.role) + '</div></div>'
          + '<p>' + esc(b.bio) + '</p>'
          + '<a class="btn quiet sm" href="#/book" data-act="go" data-route="book" data-barber="' + esc(b.id) + '">'
          + 'Book with ' + esc(String(b.name).split(" ")[0]) + '</a></article>';
      }).join("") + '</div></div></section>';

  var need = s.stamps_required;
  var membership = '<section class="band" id="membership"><div class="wrap"><div class="memgrid">'
    + '<div>' + cardMarkup({ name: "Your name here", card_number: "6•••  ••••  ••••", stamps: 3, free_cuts: 0 }) + '</div>'
    + '<div><p class="eyebrow">Membership</p><h2 class="dsp h2">' + need + ' cuts.<br>The next one is on us.</h2>'
    + '<p class="lede" style="margin:14px 0 22px">Sign up with your email and we send you a digital card. Every cut you sit through gets stamped at the till. No plastic to lose, nothing to remember.</p>'
    + '<ol class="steps">'
      + '<li><b>01</b><span>Drop your email in — takes ten seconds, no app to download.</span></li>'
      + '<li><b>02</b><span>Book and turn up. Your barber stamps the card when you are done.</span></li>'
      + '<li><b>03</b><span>Stamp ' + need + ' lands and your next cut is free. The card resets and off you go again.</span></li>'
    + '</ol>'
    + '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px">'
      + '<a class="btn" href="#/join" data-act="go" data-route="join">Get my card</a>'
      + '<a class="btn ghost" href="#/join" data-act="go" data-route="join">Send me my card</a></div>'
    + '</div></div></div></section>';

  return shell(hero + services + team + membership + findBlock());
}

function findBlock() {
  var s = CFG.shop;
  var q = encodeURIComponent([s.address_1, s.address_2, s.postcode].filter(Boolean).join(", "));
  return '<section class="band" id="find"><div class="wrap">'
    + '<div class="sechead"><div><p class="eyebrow">Find us</p><h2 class="dsp h2">' + esc(s.address_1) + '</h2></div></div>'
    + '<div class="findgrid"><div>'
      + '<p class="lede">' + esc(s.address_1) + '<br>' + esc(s.address_2) + '<br>' + esc(s.postcode) + '</p>'
      + (s.getting_here ? '<p class="muted" style="margin-top:18px;max-width:46ch">' + esc(s.getting_here) + '</p>' : '')
      + '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px">'
      + '<a class="btn quiet" href="https://www.google.com/maps/search/?api=1&query=' + q + '" target="_blank" rel="noopener">Open in Maps</a>'
      + (s.phone ? '<a class="btn quiet" href="tel:' + esc(s.phone.replace(/\s/g, "")) + '">' + esc(s.phone) + '</a>' : '')
      + '<a class="btn" href="#/book" data-act="go" data-route="book">Book a chair</a></div>'
    + '</div><div><p class="eyebrow mute" style="margin-bottom:12px">Opening hours</p>' + hoursList() + '</div></div></div></section>';
}

function viewFind() { return shell('<div style="height:20px"></div>' + findBlock()); }

/* ------------------------------------------------------------- card */
function cardMarkup(m) {
  var need = CFG.shop.stamps_required;
  var ready = (m.free_cuts || 0) > 0;
  var dots = "";
  for (var i = 1; i <= need; i++) {
    var on = i <= (m.stamps || 0);
    dots += '<span class="stamp ' + (on ? "on" : (i === need ? "free" : "")) + '">'
      + (on ? "&#10003;" : (i === need ? "FREE" : i)) + '</span>';
  }
  return '<div class="card"><div class="ctop"><div>'
    + '<img class="clogo" src="assets/logo.png" alt="Mitch\'s Barbershop" width="440" height="188">'
    + '<div class="ctag">Cut card &middot; ' + esc(CFG.shop.address_1) + '</div></div>'
    + '<div class="cstatus">' + (ready ? "Free cut ready" : (m.stamps || 0) + " / " + need) + '</div></div>'
    + '<div class="stamps">' + dots + '</div>'
    + '<div class="cfoot"><div><div class="cholder">' + esc(m.name || "Member") + '</div>'
    + '<div class="cno">' + esc(m.card_number || "") + '</div></div></div></div>';
}

/* --------------------------------------------------------- booking */
function fetchSlots(date, serviceId, barberId) {
  var key = date + "|" + serviceId + "|" + (barberId || "any");
  if (SLOTS[key]) return Promise.resolve(SLOTS[key]);
  return API.rpc("availability", { p_date: date, p_service: serviceId, p_barber: barberId || null })
    .then(function (rows) { SLOTS[key] = rows || []; return SLOTS[key]; });
}
function clearSlots() { SLOTS = {}; }

function stepper() {
  var labels = ["Service", "Barber", "Time", "Details"];
  return '<div class="stepper">' + labels.map(function (l, i) {
    var n = i + 1, cls = n === BK.step ? "on" : (n < BK.step ? "done" : "");
    return '<button class="' + cls + '" data-act="step" data-step="' + n + '"'
      + (n > maxStep() ? " disabled" : "") + '><i>' + (n < BK.step ? "&#10003;" : n) + '</i><em>' + l + '</em></button>';
  }).join("") + '</div>';
}
function maxStep() {
  if (!BK.serviceId) return 1;
  if (!BK.barberId) return 2;
  if (!BK.date || !BK.time) return 3;
  return 4;
}

function rail() {
  var svc = svcById(BK.serviceId);
  var b = BK.barberId && BK.barberId !== "any" ? barberById(BK.barberId) : null;
  var rows = [
    ["Service", svc ? svc.name.replace(/ — free$/, "") : "—"],
    ["Barber", b ? b.name : (BK.barberId === "any" ? "First free" : "—")],
    ["Date", BK.date ? prettyDate(BK.date) : "—"],
    ["Time", BK.time || "—"],
    ["Length", svc ? svc.mins + " min" : "—"]
  ];
  return '<aside class="rail"><h4>Your booking</h4><dl>'
    + rows.map(function (r) { return '<div><dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join("")
    + '</dl><div class="tot"><span>Pay in shop</span><b>' + (svc ? money(svc.price_pence) : "—") + '</b></div>'
    + '<div class="act"><p class="tiny muted">Nothing to pay online. Cash or card at the till.</p></div></aside>';
}

function allowedBarbers(svc) {
  if (!svc || !svc.barber_ids || !svc.barber_ids.length) return CFG.barbers;
  return CFG.barbers.filter(function (b) { return svc.barber_ids.indexOf(b.id) !== -1; });
}

function stepService() {
  return '<h3 class="dsp h3">What are you having?</h3>'
    + '<p class="muted" style="margin:8px 0 22px">Pick the service and we will hold the right amount of chair time.</p>'
    + '<div class="pickgrid">' + CFG.services.map(function (v) {
      return '<button class="pick ' + (BK.serviceId === v.id ? "on" : "") + '" data-act="svc" data-id="' + v.id + '">'
        + '<span class="nm">' + esc(v.name.replace(/ — free$/, ""))
        + '<span' + (v.price_pence === 0 ? ' class="free-tag"' : '') + '>' + money(v.price_pence) + '</span></span>'
        + '<span class="sub">' + esc(v.description) + '</span>'
        + '<span class="sub mono" style="margin-top:4px">' + v.mins + ' MIN</span></button>';
    }).join("") + '</div>';
}

function stepBarber() {
  var svc = svcById(BK.serviceId);
  var list = allowedBarbers(svc);
  var opts = "";
  if (list.length > 1) {
    opts += '<button class="pick ' + (BK.barberId === "any" ? "on" : "") + '" data-act="barber" data-id="any">'
      + '<span class="nm">First free</span>'
      + '<span class="sub">Whoever can see you soonest. Usually the quickest way in.</span></button>';
  }
  opts += list.map(function (b) {
    return '<button class="pick ' + (BK.barberId === b.id ? "on" : "") + '" data-act="barber" data-id="' + b.id + '">'
      + '<span class="nm">' + esc(b.name) + '</span><span class="sub">' + esc(b.role) + '</span>'
      + '<span class="sub">' + esc(b.bio) + '</span></button>';
  }).join("");
  var note = (svc && svc.price_pence === 0)
    ? '<div class="notice"><b>Free cuts are with the apprentices.</b> They are training under Mitch, so these ones are on the house.</div>'
    : "";
  return '<h3 class="dsp h3">Who is cutting?</h3>'
    + '<p class="muted" style="margin:8px 0 22px">' + esc(svc ? svc.name.replace(/ — free$/, "") : "Your cut")
    + ' takes about ' + (svc ? svc.mins : 30) + ' minutes.</p>' + note
    + '<div class="pickgrid">' + opts + '</div>';
}

function stepTime() {
  var svc = svcById(BK.serviceId);
  var days = dateRange();
  var chips = days.map(function (d) {
    var h = hoursFor(d), shut = !h || h.closed, dt = fromYmd(d);
    return '<button class="dchip ' + (BK.date === d ? "on" : "") + (shut ? " shut" : "") + '" data-act="date" data-date="' + d + '"'
      + (shut ? " disabled" : "") + '><small>' + DOWS[dt.getDay()] + '</small><b>' + dt.getDate()
      + '</b><small>' + MONS[dt.getMonth()] + '</small></button>';
  }).join("");
  return '<h3 class="dsp h3">When suits you?</h3>'
    + '<p class="muted" style="margin:8px 0 18px">Greyed out times are already taken.</p>'
    + '<div class="dates">' + chips + '</div>'
    + '<div id="timegrid"><div class="loading"><span class="spin"></span>Loading the diary…</div></div>'
    + '<p class="tz-note">All times are UK time. ' + esc(svc ? svc.mins + " minutes in the chair." : "") + '</p>';
}

function paintTimes() {
  var box = $("#timegrid");
  if (!box) return;
  var svc = svcById(BK.serviceId);
  var h = hoursFor(BK.date);
  if (!h || h.closed) { box.innerHTML = '<div class="empty">The shop is closed that day. Pick another.</div>'; return; }

  var barber = BK.barberId === "any" ? null : BK.barberId;
  box.innerHTML = '<div class="loading"><span class="spin"></span>Loading the diary…</div>';

  fetchSlots(BK.date, BK.serviceId, barber).then(function (rows) {
    if ($("#timegrid") !== box) return;                 // user moved on
    var free = {}, i;
    for (i = 0; i < rows.length; i++) free[rows[i].slot_time] = rows[i].barber_id;

    var step = CFG.shop.slot_mins || 15;
    var openM = toMin(h.opens), closeM = toMin(h.closes), out = [];
    for (var m = openM; m + svc.mins <= closeM; m += step) out.push(toHHMM(m));

    if (!out.length) { box.innerHTML = '<div class="empty">Nothing left in the diary for that day.</div>'; return; }
    if (!rows.length) {
      box.innerHTML = '<div class="empty">Fully booked that day. Try another date.</div>';
      return;
    }
    box.innerHTML = '<div class="times">' + out.map(function (t) {
      var ok = !!free[t];
      return '<button class="tslot ' + (BK.time === t ? "on" : "") + '" data-act="time" data-time="' + t
        + '" data-barber="' + esc(free[t] || "") + '"' + (ok ? "" : " disabled") + '>' + t + '</button>';
    }).join("") + '</div>';
  }, function (e) {
    box.innerHTML = '<div class="errbox">' + esc(e.message) + '</div>';
  });
}

function stepDetails() {
  var need = CFG.shop.stamps_required;
  return '<h3 class="dsp h3">Last bit</h3>'
    + '<p class="muted" style="margin:8px 0 22px">So we know who is walking through the door.</p>'
    + '<form data-form="booking" novalidate>'
    + '<div class="row2"><div class="field"><label for="bn">Your name</label>'
      + '<input id="bn" name="name" required value="' + esc(BK.name) + '" autocomplete="name" maxlength="80"></div>'
    + '<div class="field"><label for="bp">Mobile</label>'
      + '<input id="bp" name="phone" required value="' + esc(BK.phone) + '" autocomplete="tel" inputmode="tel" maxlength="30"></div></div>'
    + '<div class="field"><label for="be">Email</label>'
      + '<input id="be" name="email" type="email" required value="' + esc(BK.email) + '" autocomplete="email" maxlength="120">'
      + '<span class="hint">Your confirmation goes here, with a link to change or cancel it.</span></div>'
    + '<div class="field"><label for="bnote">Anything we should know</label>'
      + '<textarea id="bnote" name="notes" maxlength="500" placeholder="Number two on the back and sides, longer on top…">' + esc(BK.notes) + '</textarea></div>'
    + '<input class="hp" type="text" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true">'
    + '<label class="checkline"><input type="checkbox" name="join"' + (BK.join ? " checked" : "") + '>'
    + '<div><div class="t">Put me on the cut card</div>'
    + '<div class="muted small">' + need + ' cuts and the next is free. One email a month at most, and you can leave any time. '
    + '<a href="privacy.html" style="text-decoration:underline">Privacy</a>.</div></div></label>'
    + '<button class="btn wide" type="submit" data-submit>Confirm booking</button>'
    + '<p class="tiny muted" style="margin-top:12px;text-align:center">By booking you agree to our '
    + '<a href="terms.html" style="text-decoration:underline">booking terms</a>.</p>'
    + '</form>';
}

function viewBook() {
  var body;
  if (BK.step === 1) body = stepService();
  else if (BK.step === 2) body = stepBarber();
  else if (BK.step === 3) body = stepTime();
  else body = stepDetails();
  return shell('<div class="wrap"><div class="flow"><div>'
    + '<p class="eyebrow">Book a chair</p>' + stepper() + body
    + '</div>' + rail() + '</div></div>');
}

/* ---------------------------------------------------- membership page */
function viewJoin() {
  var need = CFG.shop.stamps_required;
  return shell('<div class="wrap"><section class="band" style="border-top:0">'
    + '<div class="sechead"><div><p class="eyebrow">Membership</p><h2 class="dsp h2">The cut card</h2>'
    + '<p>Free to join, nothing to carry. ' + need + ' cuts and the next one is on the shop.</p></div></div>'
    + '<div class="memgrid" style="align-items:start"><div>'
      + '<div class="panel"><h4>Join the card</h4><p class="ph">One email, that is it. You can leave whenever you like.</p>'
      + '<form data-form="join" novalidate>'
      + '<div class="field"><label for="jn">Name</label><input id="jn" name="name" required autocomplete="name" maxlength="80"></div>'
      + '<div class="field"><label for="je">Email</label><input id="je" name="email" type="email" required autocomplete="email" maxlength="120"></div>'
      + '<div class="field"><label for="jp">Mobile <span class="muted">(optional)</span></label>'
      + '<input id="jp" name="phone" autocomplete="tel" inputmode="tel" maxlength="30"></div>'
      + '<input class="hp" type="text" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true">'
      + '<button class="btn wide" type="submit" data-submit>Give me a card</button>'
      + '<p class="tiny muted" style="margin-top:10px">We keep your name, email and mobile so we can run the card and '
      + 'send you the odd offer. Nothing else, and never sold on. '
      + '<a href="privacy.html" style="text-decoration:underline">Privacy</a>.</p>'
      + '</form></div>'
      + '<div class="panel"><h4>Already signed up?</h4>'
      + '<p class="ph">Pop your email in and we will send your card straight to your inbox.</p>'
      + '<form data-form="lookup" class="sub" style="max-width:none" novalidate>'
      + '<input name="email" type="email" placeholder="you@email.com" required aria-label="Email address" autocomplete="email">'
      + '<button class="btn" type="submit" data-submit>Send it</button></form>'
      + '<p class="tiny muted" style="margin-top:10px">We email the link rather than showing it here, so nobody can look up '
      + 'somebody else&rsquo;s card.</p></div>'
    + '</div><div>' + cardMarkup({ name: "Your name here", card_number: "6•••  ••••  ••••", stamps: 0, free_cuts: 0 })
    + '<div class="panel" style="margin-top:20px"><h4>How the stamps work</h4>'
    + '<p class="ph" style="margin:0">Your barber taps &ldquo;done&rdquo; on the diary when you get out of the chair, and that is your stamp. '
    + 'Free apprentice cuts do not count towards it — only paid cuts do.</p></div>'
    + '</div></div></section></div>');
}

/* ---------------------------------------------------- confirmation */
function viewConfirm(f) {
  var need = CFG.shop.stamps_required;
  var manage = "manage.html?t=" + encodeURIComponent(f.token);
  return shell('<div class="wrap"><div class="conf">'
    + '<div class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="#FF6B18" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></div>'
    + '<p class="eyebrow">Chair booked</p>'
    + '<h2 class="dsp h2" style="margin:10px 0 14px">See you ' + (f.date === todayStr() ? "later" : "then") + ', '
    + esc(String(f.name || "").split(" ")[0]) + '.</h2>'
    + '<p class="lede" style="margin:0 auto">We have written it in the diary and sent a confirmation to '
    + esc(f.email) + '. Turn up a couple of minutes early and grab a seat.</p>'
    + '<div class="refbox"><small>Booking reference</small><b>' + esc(f.ref) + '</b></div>'
    + '<dl class="confdl">'
      + '<div><dt>When</dt><dd>' + prettyDate(f.date) + ' &middot; ' + esc(f.time) + '</dd></div>'
      + '<div><dt>Barber</dt><dd>' + esc(f.barber || "The team") + '</dd></div>'
      + '<div><dt>Service</dt><dd>' + esc(String(f.service || "").replace(/ — free$/, "")) + '</dd></div>'
      + '<div><dt>Pay in shop</dt><dd>' + money(f.price_pence) + '</dd></div>'
    + '</dl>'
    + '<div style="margin-top:30px">' + cardMarkup({
        name: f.name, card_number: f.card_number, stamps: f.stamps, free_cuts: f.free_cuts }) + '</div>'
    + '<p class="small muted" style="margin-top:14px">'
    + ((f.free_cuts > 0) ? 'You have a free cut waiting — mention it at the till.'
        : (need - (f.stamps || 0)) + ' more cuts and one is free.') + '</p>'
    + '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:34px">'
    + '<a class="btn" href="' + manage + '">Change or cancel this booking</a>'
    + '<a class="btn ghost" href="#/home" data-act="go" data-route="home">Back to the shop</a></div>'
    + '<p class="tiny muted" style="margin-top:26px">Need us sooner? ' + esc(contactLine()) + '</p>'
    + '</div></div>');
}

/* --------------------------------------------------------- routing */
function parseHash() {
  var h = String(location.hash || "").replace(/^#\/?/, "").split("?")[0];
  ROUTE = ROUTES[h] ? h : "home";
}
function setRoute(r, keepScroll) {
  FLASH = null;
  ROUTE = ROUTES[r] ? r : "home";
  if (location.hash !== "#/" + ROUTE) {
    HASH_LOCK = true; location.hash = "#/" + ROUTE; HASH_LOCK = false;
  }
  render(keepScroll);
}

function render(keepScroll) {
  var root = $("#root");
  if (!CFG) { root.innerHTML = loadingShell(); return; }
  var html;
  if (FLASH) html = viewConfirm(FLASH);
  else if (ROUTE === "book") html = viewBook();
  else if (ROUTE === "join") html = viewJoin();
  else if (ROUTE === "find") html = viewFind();
  else html = viewHome();
  root.innerHTML = html;
  if (!keepScroll) window.scrollTo({ top: 0, behavior: "auto" });
  if (!FLASH && ROUTE === "home") loadNextOpenings();
  if (!FLASH && ROUTE === "book" && BK.step === 3) paintTimes();
  document.title = (ROUTE === "book" ? "Book a chair — " : "") + "Mitch's Barbershop — Ramsgate";
}

function loadingShell() {
  return '<header class="top"><div class="wrap"><span class="brand">'
    + '<img src="assets/logo.png" alt="Mitch\'s Barbershop" width="440" height="188"></span></div></header>'
    + '<main id="main"><div class="wrap" style="padding:60px 0">'
    + '<div class="skel skel-line" style="width:180px"></div>'
    + '<div class="skel skel-line" style="width:70%;height:44px;margin:18px 0"></div>'
    + '<div class="skel skel-line" style="width:52%;height:44px"></div>'
    + '<div class="skel skel-block" style="margin-top:30px"></div></div></main>';
}

window.addEventListener("hashchange", function () {
  if (HASH_LOCK) return;
  FLASH = null; parseHash(); render();
});

/* ---------------------------------------------------- interactions */
function busy(el, on, label) {
  if (!el) return;
  if (on) {
    el.dataset.label = el.innerHTML;
    el.innerHTML = '<span class="spin"></span>' + (label || "Working…");
    el.disabled = true;
  } else {
    if (el.dataset.label) el.innerHTML = el.dataset.label;
    el.disabled = false;
  }
}

document.addEventListener("click", function (e) {
  var t = e.target.closest ? e.target.closest("[data-act]") : null;
  if (!t) return;
  var act = t.getAttribute("data-act");

  if (act === "go") {
    e.preventDefault();
    var r = t.getAttribute("data-route");
    if (r === "book") {
      var pre = t.getAttribute("data-barber");
      if (pre) { BK.barberId = pre; BK.step = 1; BK.time = null; }
    }
    var nv = $("#nav"); if (nv) nv.classList.remove("open");
    setRoute(r);
    return;
  }
  if (act === "burger") {
    var n = $("#nav");
    if (n) { n.classList.toggle("open"); t.setAttribute("aria-expanded", n.classList.contains("open")); }
    return;
  }
  if (act === "quickslot") {
    e.preventDefault();
    BK.serviceId = t.getAttribute("data-service");
    BK.barberId = t.getAttribute("data-barber") || "any";
    BK.slotBarber = t.getAttribute("data-barber") || null;
    BK.date = t.getAttribute("data-date");
    BK.time = t.getAttribute("data-time");
    BK.step = 4;
    setRoute("book");
    return;
  }
  if (act === "svc") {
    BK.serviceId = t.getAttribute("data-id");
    BK.time = null; BK.slotBarber = null; BK.date = null;
    var s = svcById(BK.serviceId), allowed = allowedBarbers(s);
    BK.barberId = allowed.length === 1 ? allowed[0].id : "any";
    BK.step = 2; render(); return;
  }
  if (act === "barber") {
    BK.barberId = t.getAttribute("data-id");
    BK.time = null; BK.slotBarber = null;
    BK.date = dateRange().filter(function (d) { var h = hoursFor(d); return h && !h.closed; })[0] || null;
    BK.step = 3; render(); return;
  }
  if (act === "date") {
    BK.date = t.getAttribute("data-date"); BK.time = null;
    render(true); return;
  }
  if (act === "time") {
    BK.time = t.getAttribute("data-time");
    BK.slotBarber = t.getAttribute("data-barber") || null;
    BK.step = 4; render(); return;
  }
  if (act === "step") {
    BK.step = +t.getAttribute("data-step");
    if (BK.step === 3 && !BK.date) {
      BK.date = dateRange().filter(function (d) { var h = hoursFor(d); return h && !h.closed; })[0] || null;
    }
    render(); return;
  }
});

document.addEventListener("input", function (e) {
  var f = e.target.form;
  if (!f || f.getAttribute("data-form") !== "booking") return;
  var n = e.target.name;
  if (n === "join") BK.join = e.target.checked;
  else if (n in BK) BK[n] = e.target.value;
});
document.addEventListener("change", function (e) {
  if (e.target.name === "join" && e.target.form && e.target.form.getAttribute("data-form") === "booking") {
    BK.join = e.target.checked;
  }
});

document.addEventListener("submit", function (e) {
  var f = e.target, kind = f.getAttribute("data-form");
  if (!kind) return;
  e.preventDefault();
  if (BUSY) return;
  var d = new FormData(f), g = function (k) { return String(d.get(k) || "").trim(); };
  var btn = f.querySelector("[data-submit], button[type=submit]");

  if (kind === "booking") { submitBooking(d, btn); return; }

  if (kind === "join" || kind === "footjoin") {
    if (!g("email")) return;
    BUSY = true; busy(btn, true, "Sending…");
    API.rpc("join_card", { p_name: g("name"), p_email: g("email"), p_phone: g("phone"), p_hp: g("hp") })
      .then(function (res) {
        BUSY = false; busy(btn, false);
        if (res && res.ok === false) { toast(res.error, "bad"); return; }
        f.reset();
        toast("You are on the card. Check your email for the link.", "good");
      }, function (err) { BUSY = false; busy(btn, false); toast(err.message, "bad"); });
    return;
  }

  if (kind === "lookup") {
    BUSY = true; busy(btn, true, "Sending…");
    API.rpc("request_card_link", { p_email: g("email") })
      .then(function () {
        BUSY = false; busy(btn, false); f.reset();
        toast("If that address is on the card, the link is on its way.", "good");
      }, function (err) { BUSY = false; busy(btn, false); toast(err.message, "bad"); });
    return;
  }
});

function submitBooking(d, btn) {
  var g = function (k) { return String(d.get(k) || "").trim(); };
  var svc = svcById(BK.serviceId);
  if (!svc || !BK.date || !BK.time) { toast("Pick a service and a time first.", "bad"); BK.step = 1; render(); return; }

  BK.name = g("name"); BK.email = g("email"); BK.phone = g("phone"); BK.notes = g("notes");
  BK.join = d.get("join") !== null;

  BUSY = true; busy(btn, true, "Booking your chair…");
  API.rpc("create_booking", {
    p_service: svc.id,
    p_date: BK.date,
    p_time: BK.time,
    p_name: BK.name,
    p_email: BK.email,
    p_phone: BK.phone,
    p_barber: BK.slotBarber || (BK.barberId !== "any" ? BK.barberId : null),
    p_notes: BK.notes,
    p_join: BK.join,
    p_hp: g("hp")
  }).then(function (res) {
    BUSY = false; busy(btn, false);
    if (!res || res.ok === false) {
      toast((res && res.error) || "That did not go through. Try again.", "bad");
      if (res && /slot/i.test(res.error || "")) { clearSlots(); BK.time = null; BK.step = 3; render(); }
      return;
    }
    clearSlots();
    FLASH = { ref: res.ref, date: res.date, time: res.time, barber: res.barber, service: res.service,
              price_pence: res.price_pence, name: BK.name, email: BK.email, token: res.token,
              stamps: res.stamps, free_cuts: res.free_cuts, card_number: res.card_number };
    // start the next booking from a clean sheet, keeping who they are
    var keepName = BK.name, keepEmail = BK.email, keepPhone = BK.phone;
    BK = { step: 1, serviceId: svc.id, barberId: "any", date: null, time: null, slotBarber: null,
           name: keepName, email: keepEmail, phone: keepPhone, notes: "", join: true };
    render();
  }, function (err) {
    BUSY = false; busy(btn, false);
    toast(err.message, "bad");
  });
}

/* -------------------------------------------------------------- boot */
function boot() {
  parseHash();
  render();
  if (!API.configured()) {
    $("#root").innerHTML = '<div class="wrap" style="padding:80px 0"><div class="errbox">'
      + '<b>Not connected yet.</b><br>Open <code>assets/config.js</code> and paste in your Supabase URL and anon key. '
      + 'Step 2 of the README walks through it.</div></div>';
    return;
  }
  API.rpc("public_config").then(function (cfg) {
    CFG = cfg;
    if (CFG.services.length) {
      var paid = CFG.services.filter(function (s) { return s.price_pence > 0; });
      BK.serviceId = BK.serviceId || (paid[0] || CFG.services[0]).id;
    }
    render();
  }, function (err) {
    $("#root").innerHTML = '<div class="wrap" style="padding:80px 0"><div class="errbox">'
      + esc(err.message) + '</div><p class="muted">' + esc(contactLine()) + '</p></div>';
  });
}

window.addEventListener("offline", function () {
  if (!$(".offline")) {
    var d = document.createElement("div");
    d.className = "offline"; d.textContent = "You are offline — bookings will not save until you reconnect.";
    document.body.appendChild(d);
  }
});
window.addEventListener("online", function () { var o = $(".offline"); if (o) o.remove(); });

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
})();
