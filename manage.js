/* =====================================================================
   MITCH'S BARBERSHOP — the customer's own page.
   Reached from the link in their confirmation email: manage.html?t=<token>
   ===================================================================== */
(function () {
"use strict";

var TOKEN = new URLSearchParams(location.search).get("t") || "";
var CFG = null, DATA = null, BUSY = false;
var MOVE = null;              // { booking, date, time, slotBarber }
var SLOTS = {};

var DOWS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var MONS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function $(s,r){ return (r||document).querySelector(s); }
function pad(n){ return (n<10?"0":"")+n; }
function ymd(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function fromYmd(s){ var a=String(s).split("-"); return new Date(+a[0],(+a[1])-1,+a[2]); }
function prettyDate(s){ var d=fromYmd(s); return DOWS[d.getDay()]+" "+d.getDate()+" "+MONS[d.getMonth()]; }
function toMin(h){ var a=String(h||"0:0").split(":"); return (+a[0])*60+(+a[1]||0); }
function toHHMM(m){ return pad(Math.floor(m/60))+":"+pad(m%60); }
function money(p){ var c=(CFG&&CFG.shop.currency)||"£"; return p ? c+(p/100).toFixed(2).replace(/\.00$/,"") : "Free"; }
function todayStr(){ return (CFG&&CFG.today)||ymd(new Date()); }
function hoursFor(d){ var dw=fromYmd(d).getDay(); for(var i=0;i<CFG.hours.length;i++) if(CFG.hours[i].dow===dw) return CFG.hours[i]; return null; }
function toast(msg,kind){
  var t=document.createElement("div"); t.className="toast "+(kind||""); t.setAttribute("role","status");
  t.textContent=msg; $("#toasts").appendChild(t);
  setTimeout(function(){ t.style.transition="opacity .3s"; t.style.opacity="0";
    setTimeout(function(){ t.remove(); },320); }, kind==="bad"?6500:3800);
}
function busy(el,on,label){
  if(!el) return;
  if(on){ el.dataset.label=el.innerHTML; el.innerHTML='<span class="spin"></span>'+(label||"Working…"); el.disabled=true; }
  else { if(el.dataset.label) el.innerHTML=el.dataset.label; el.disabled=false; }
}

function header(){
  return '<header class="top"><div class="wrap">'
    + '<a class="brand" href="index.html" aria-label="Mitch\'s Barbershop, home">'
    + '<img src="assets/logo.png" alt="Mitch\'s Barbershop" width="440" height="188"><i></i><span>Ramsgate</span></a>'
    + '<nav class="main" style="display:flex"><a class="btn sm" href="index.html#/book">Book another</a></nav>'
    + '</div></header>';
}

function cardMarkup(m){
  var need = CFG.shop.stamps_required, ready = (m.free_cuts||0)>0, dots="";
  for (var i=1;i<=need;i++){
    var on = i <= (m.stamps||0);
    dots += '<span class="stamp '+(on?"on":(i===need?"free":""))+'">'+(on?"&#10003;":(i===need?"FREE":i))+'</span>';
  }
  return '<div class="card"><div class="ctop"><div>'
    + '<img class="clogo" src="assets/logo.png" alt="Mitch\'s Barbershop" width="440" height="188">'
    + '<div class="ctag">Cut card &middot; '+esc(CFG.shop.address_1)+'</div></div>'
    + '<div class="cstatus">'+(ready?"Free cut ready":(m.stamps||0)+" / "+need)+'</div></div>'
    + '<div class="stamps">'+dots+'</div>'
    + '<div class="cfoot"><div><div class="cholder">'+esc(m.name||"Member")+'</div>'
    + '<div class="cno">'+esc(m.card_number||"")+'</div></div></div></div>';
}

function statusPill(s){
  if (s==="done")      return '<span class="pill done">Done</span>';
  if (s==="cancelled") return '<span class="pill gone">Cancelled</span>';
  if (s==="noshow")    return '<span class="pill gone">Missed</span>';
  return '<span class="pill book">Booked</span>';
}

function bookingRow(b){
  var upcoming = b.status === "booked";
  return '<div class="panel" style="margin-bottom:12px">'
    + '<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">'
      + '<div style="flex:1;min-width:200px">'
        + '<h4 style="margin-bottom:2px">'+prettyDate(b.date)+' &middot; '+esc(b.time)+'</h4>'
        + '<p class="ph" style="margin-bottom:8px">'+esc(String(b.service).replace(/ — free$/,""))
        + ' with '+esc(b.barber)+' &middot; '+b.mins+' min &middot; '+money(b.price_pence)+'</p>'
        + statusPill(b.status)
        + ' <span class="mono tiny muted" style="margin-left:8px">'+esc(b.ref)+'</span>'
      + '</div>'
      + (upcoming ? '<div class="acts" style="justify-content:flex-start">'
          + (b.locked
              ? '<span class="tiny muted">Too close to change online — ring the shop</span>'
              : '<button class="btn quiet sm" data-act="move" data-id="'+b.id+'">Move it</button>'
                + '<button class="btn danger sm" data-act="cancel" data-id="'+b.id+'">Cancel</button>')
        + '</div>' : '')
    + '</div>'
    + (MOVE && MOVE.booking.id === b.id ? moveBox(b) : '')
    + '</div>';
}

function moveBox(b){
  var days = [], d = fromYmd(todayStr());
  for (var i=0;i<(CFG.shop.horizon_days||21);i++){ days.push(ymd(d)); d.setDate(d.getDate()+1); }
  var chips = days.map(function(x){
    var h = hoursFor(x), shut = !h || h.closed, dt = fromYmd(x);
    return '<button class="dchip '+(MOVE.date===x?"on":"")+(shut?" shut":"")+'" data-act="mdate" data-date="'+x+'"'
      + (shut?" disabled":"")+'><small>'+DOWS[dt.getDay()]+'</small><b>'+dt.getDate()+'</b><small>'+MONS[dt.getMonth()]+'</small></button>';
  }).join("");
  return '<div style="border-top:1px solid var(--line);margin-top:16px;padding-top:16px">'
    + '<p class="eyebrow" style="margin-bottom:10px">Pick a new time</p>'
    + '<div class="dates">'+chips+'</div>'
    + '<div id="mtimes"><div class="loading"><span class="spin"></span>Loading the diary…</div></div>'
    + '<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">'
    + '<button class="btn" data-act="confirmmove" data-id="'+b.id+'"'+(MOVE.time?"":" disabled")+'>'
    + (MOVE.time ? 'Move to '+prettyDate(MOVE.date)+' at '+MOVE.time : 'Pick a time above')+'</button>'
    + '<button class="btn ghost" data-act="cancelmove">Never mind</button></div></div>';
}

function paintMoveTimes(){
  var box = $("#mtimes");
  if (!box || !MOVE) return;
  var b = MOVE.booking;
  var h = hoursFor(MOVE.date);
  if (!h || h.closed){ box.innerHTML = '<div class="empty">Shop is closed that day.</div>'; return; }
  var key = MOVE.date+"|"+b.service_id;
  var done = function(rows){
    if ($("#mtimes") !== box) return;
    var free = {}, i;
    for (i=0;i<rows.length;i++) free[rows[i].slot_time] = rows[i].barber_id;
    var step = CFG.shop.slot_mins || 15, out = [];
    for (var m = toMin(h.opens); m + b.mins <= toMin(h.closes); m += step) out.push(toHHMM(m));
    if (!rows.length){ box.innerHTML = '<div class="empty">Nothing free that day.</div>'; return; }
    box.innerHTML = '<div class="times">' + out.map(function(t){
      var ok = !!free[t];
      return '<button class="tslot '+(MOVE.time===t?"on":"")+'" data-act="mtime" data-time="'+t+'"'+(ok?"":" disabled")+'>'+t+'</button>';
    }).join("") + '</div>';
  };
  if (SLOTS[key]) return done(SLOTS[key]);
  box.innerHTML = '<div class="loading"><span class="spin"></span>Loading the diary…</div>';
  API.rpc("availability", { p_date: MOVE.date, p_service: b.service_id, p_barber: null })
    .then(function(rows){ SLOTS[key] = rows||[]; done(SLOTS[key]); },
          function(e){ box.innerHTML = '<div class="errbox">'+esc(e.message)+'</div>'; });
}

function render(){
  var root = $("#root");
  if (!DATA){ root.innerHTML = header() + '<main class="wrap" style="padding:70px 0">'
    + '<div class="skel skel-line" style="width:200px"></div><div class="skel skel-block" style="margin-top:20px"></div></main>';
    return; }

  if (DATA.ok === false){
    root.innerHTML = header() + '<main class="wrap"><div class="gate">'
      + '<h3 class="dsp h3">This link has expired</h3>'
      + '<p class="muted" style="margin:10px 0 22px">'+esc(DATA.error)+'</p>'
      + '<p class="muted small">Ask us to send a fresh one and it will land in your inbox.</p>'
      + '<form data-form="resend" class="sub" style="margin:18px auto 0;max-width:360px">'
      + '<input name="email" type="email" placeholder="you@email.com" required aria-label="Email address">'
      + '<button class="btn" type="submit" data-submit>Send it</button></form>'
      + '<p style="margin-top:24px"><a class="btn ghost" href="index.html">Back to the shop</a></p>'
      + '</div></main>';
    return;
  }

  var upcoming = DATA.bookings.filter(function(b){ return b.status === "booked"; });
  var past = DATA.bookings.filter(function(b){ return b.status !== "booked"; });

  root.innerHTML = header() + '<main class="wrap"><section class="band" style="border-top:0;padding-top:40px">'
    + '<div class="sechead"><div><p class="eyebrow">Your page</p>'
    + '<h2 class="dsp h2">Alright, '+esc(String(DATA.name||"there").split(" ")[0])+'.</h2>'
    + '<p>Everything booked in your name, and where your cut card is at.</p></div></div>'

    + '<div class="memgrid" style="align-items:start"><div>'
      + '<h3 class="dsp h3" style="margin-bottom:14px">Coming up</h3>'
      + (upcoming.length ? upcoming.map(bookingRow).join("")
          : '<div class="panel"><p class="ph" style="margin:0">Nothing booked at the moment. '
            + '<a href="index.html#/book" style="color:var(--orange);text-decoration:underline">Book a chair</a>.</p></div>')
      + (past.length ? '<h3 class="dsp h3" style="margin:30px 0 14px">Been and gone</h3>'
          + '<div class="tablewrap"><table class="data"><tbody>'
          + past.slice(0,12).map(function(b){
              return '<tr><td class="mono tiny">'+prettyDate(b.date)+'</td><td class="tiny">'+esc(b.time)+'</td>'
                + '<td>'+esc(String(b.service).replace(/ — free$/,""))+'</td>'
                + '<td>'+esc(b.barber)+'</td><td>'+statusPill(b.status)+'</td></tr>';
            }).join("")
          + '</tbody></table></div>' : '')
    + '</div><div>'
      + cardMarkup(DATA)
      + '<div class="panel" style="margin-top:20px"><h4>'
      + (DATA.free_cuts > 0 ? "Your next cut is free"
          : (DATA.stamps_required - DATA.stamps) + " to go")+'</h4>'
      + '<p class="ph">'+(DATA.free_cuts > 0
          ? "Mention it at the till and they will take it off."
          : "Sit through "+(DATA.stamps_required - DATA.stamps)+" more paid cuts and the one after is on the house.")+'</p>'
      + '<div class="kpis" style="margin:0">'
      + '<div class="kpi"><b>'+DATA.stamps+'</b><small>Stamps now</small></div>'
      + '<div class="kpi"><b>'+DATA.free_cuts+'</b><small>Free cuts waiting</small></div>'
      + '<div class="kpi"><b>'+(DATA.redeemed||0)+'</b><small>Claimed so far</small></div></div></div>'
      + '<div class="panel"><h4>Your details</h4>'
      + '<p class="ph" style="margin-bottom:14px">'+esc(DATA.email)+(DATA.phone?' &middot; '+esc(DATA.phone):'')+'</p>'
      + (DATA.marketing_opt_in
          ? '<button class="btn ghost sm" data-act="unsub">Stop the offer emails</button>'
          : '<p class="tiny muted" style="margin:0">You are not on the mailing list. Booking confirmations still come through.</p>')
      + '<p class="tiny muted" style="margin-top:14px">Want your details removed altogether? Email '
      + esc(CFG.shop.email || "the shop") + ' and we will wipe them.</p></div>'
    + '</div></div></section></main>';

  if (MOVE) paintMoveTimes();
}

function load(){
  return API.rpc("card_by_token", { p_token: TOKEN }).then(function(res){
    DATA = res; render();
  }, function(err){ DATA = { ok:false, error: err.message }; render(); });
}

document.addEventListener("click", function(e){
  var t = e.target.closest ? e.target.closest("[data-act]") : null;
  if (!t) return;
  var act = t.getAttribute("data-act"), id = t.getAttribute("data-id");

  if (act === "move"){
    var b = DATA.bookings.filter(function(x){ return x.id === id; })[0];
    if (!b) return;
    var first = null, d = fromYmd(todayStr());
    for (var i=0;i<(CFG.shop.horizon_days||21) && !first;i++){
      var s = ymd(d), h = hoursFor(s);
      if (h && !h.closed) first = s;
      d.setDate(d.getDate()+1);
    }
    MOVE = { booking: b, date: first, time: null };
    SLOTS = {}; render(); return;
  }
  if (act === "cancelmove"){ MOVE = null; render(); return; }
  if (act === "mdate"){ MOVE.date = t.getAttribute("data-date"); MOVE.time = null; render(); return; }
  if (act === "mtime"){ MOVE.time = t.getAttribute("data-time"); render(); return; }

  if (act === "confirmmove"){
    if (!MOVE || !MOVE.time || BUSY) return;
    BUSY = true; busy(t, true, "Moving…");
    API.rpc("reschedule_booking", { p_token: TOKEN, p_booking: MOVE.booking.id,
                                    p_date: MOVE.date, p_time: MOVE.time })
      .then(function(res){
        BUSY = false;
        if (!res.ok){ busy(t,false); toast(res.error, "bad"); SLOTS = {}; paintMoveTimes(); return; }
        toast("Moved. We have emailed you the new details.", "good");
        MOVE = null; SLOTS = {}; load();
      }, function(err){ BUSY = false; busy(t,false); toast(err.message, "bad"); });
    return;
  }

  if (act === "cancel"){
    if (BUSY) return;
    if (!confirm("Cancel this booking? The slot goes back in the diary.")) return;
    BUSY = true; busy(t, true, "Cancelling…");
    API.rpc("cancel_booking", { p_token: TOKEN, p_booking: id })
      .then(function(res){
        BUSY = false;
        if (!res.ok){ busy(t,false); toast(res.error, "bad"); return; }
        toast("Cancelled. No hard feelings.", "good");
        SLOTS = {}; load();
      }, function(err){ BUSY = false; busy(t,false); toast(err.message, "bad"); });
    return;
  }

  if (act === "unsub"){
    if (BUSY) return;
    BUSY = true; busy(t, true, "Updating…");
    API.rpc("unsubscribe", { p_token: TOKEN }).then(function(){
      BUSY = false; toast("Done — no more offer emails.", "good"); load();
    }, function(err){ BUSY = false; busy(t,false); toast(err.message, "bad"); });
    return;
  }
});

document.addEventListener("submit", function(e){
  var f = e.target;
  if (f.getAttribute("data-form") !== "resend") return;
  e.preventDefault();
  var btn = f.querySelector("[data-submit]");
  var email = String(new FormData(f).get("email") || "").trim();
  busy(btn, true, "Sending…");
  API.rpc("request_card_link", { p_email: email }).then(function(){
    busy(btn, false); f.reset();
    toast("If that address is on the card, a fresh link is on its way.", "good");
  }, function(err){ busy(btn, false); toast(err.message, "bad"); });
});

function boot(){
  if (!API.configured()){
    $("#root").innerHTML = '<div class="wrap" style="padding:80px 0"><div class="errbox">'
      + 'Not connected yet — see README step 2.</div></div>';
    return;
  }
  if (!TOKEN){
    CFG = { shop: { stamps_required: 8, address_1: "", currency: "£", horizon_days: 21, slot_mins: 15, email: "" },
            hours: [], today: ymd(new Date()) };
    DATA = { ok: false, error: "This page needs the link from your confirmation email." };
    render();
    return;
  }
  render();
  API.rpc("public_config").then(function(cfg){ CFG = cfg; return load(); },
    function(err){
      $("#root").innerHTML = '<div class="wrap" style="padding:80px 0"><div class="errbox">'+esc(err.message)+'</div></div>';
    });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
})();
