/* =====================================================================
   MITCH'S BARBERSHOP — back of house.
   Real login (Supabase Auth). Everything here is gated by the database,
   not by this page, so a copied URL gets you nowhere.
   ===================================================================== */
(function () {
"use strict";

var SIGNED_IN = false, BUSY = false;
var TAB = sessionStorage.getItem("mitchs.tab") || "diary";
var DAY = sessionStorage.getItem("mitchs.day") || null;
var D = { settings:null, services:[], barbers:[], hours:[], bookings:[], customers:[], timeoff:[], failed:0 };
var ADDING = false;

var DOWS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var MONS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function $(s,r){ return (r||document).querySelector(s); }
function $$(s,r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
function pad(n){ return (n<10?"0":"")+n; }
function ymd(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function fromYmd(s){ var a=String(s).split("-"); return new Date(+a[0],(+a[1])-1,+a[2]); }
function prettyDate(s){ var d=fromYmd(s); return DOWS[d.getDay()]+" "+d.getDate()+" "+MONS[d.getMonth()]; }
function today(){ return ymd(new Date()); }
function cur(){ return (D.settings && D.settings.currency) || "£"; }
function money(p){ return p ? cur()+(p/100).toFixed(2).replace(/\.00$/,"") : "Free"; }
function total(p){ return cur()+((p||0)/100).toFixed(2).replace(/\.00$/,""); }
function hhmm(t){ return String(t||"").slice(0,5); }
function toast(msg,kind){
  var t=document.createElement("div"); t.className="toast "+(kind||""); t.setAttribute("role","status");
  t.textContent=msg; $("#toasts").appendChild(t);
  setTimeout(function(){ t.style.transition="opacity .3s"; t.style.opacity="0";
    setTimeout(function(){ t.remove(); },320); }, kind==="bad"?6500:3200);
}
function busy(el,on,label){
  if(!el) return;
  if(on){ el.dataset.label=el.innerHTML; el.innerHTML='<span class="spin"></span>'+(label||"…"); el.disabled=true; }
  else { if(el.dataset.label) el.innerHTML=el.dataset.label; el.disabled=false; }
}
function fail(err){ BUSY=false; toast(err && err.message ? err.message : "Something went wrong.", "bad"); }

/* ------------------------------------------------------------ login */
function viewLogin(msg){
  return '<header class="top"><div class="wrap"><a class="brand" href="index.html">'
    + '<img src="assets/logo.png" alt="Mitch\'s Barbershop" width="440" height="188"></a>'
    + '<nav class="main" style="display:flex"><a href="index.html">Back to the site</a></nav></div></header>'
    + '<main class="wrap"><div class="gate">'
    + '<div class="lock"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'
    + '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>'
    + '<h3 class="dsp h3">Staff only</h3>'
    + '<p class="muted" style="margin:8px 0 22px">Sign in to open the diary.</p>'
    + (msg ? '<div class="errbox">'+esc(msg)+'</div>' : '')
    + '<form data-form="login" novalidate>'
    + '<div class="field"><label for="le">Email</label><input id="le" name="email" type="email" required autocomplete="username"></div>'
    + '<div class="field"><label for="lp">Password</label><input id="lp" name="password" type="password" required autocomplete="current-password"></div>'
    + '<button class="btn wide" type="submit" data-submit>Open the diary</button></form>'
    + '<p class="tiny muted" style="margin-top:18px">Forgotten it? Whoever set the site up can reset it in Supabase.</p>'
    + '</div></main>';
}

/* ------------------------------------------------------------ chrome */
function chrome(body){
  return '<header class="top"><div class="wrap"><a class="brand" href="index.html">'
    + '<img src="assets/logo.png" alt="Mitch\'s Barbershop" width="440" height="188"><i></i><span>Diary</span></a>'
    + '<nav class="main" style="display:flex;margin-left:auto"><a href="index.html" target="_blank" rel="noopener">View the site</a></nav>'
    + '</div></header>'
    + '<main class="wrap"><div class="staffbar">'
    + '<div><p class="eyebrow">Back of house</p><h3 class="dsp h3">'
    + esc((D.settings && D.settings.shop_name) || "The shop") + ' diary</h3></div>'
    + '<div class="tabs" style="margin-left:auto">'
      + tabBtn("diary","Diary") + tabBtn("members","Members") + tabBtn("settings","Settings")
    + '</div><button class="btn ghost sm" data-act="logout">Sign out</button></div>'
    + (D.failed ? '<div class="errbox">'+D.failed+' email'+(D.failed>1?'s':'')
        +' failed to send. Check the Resend key under Settings.</div>' : '')
    + '<div style="padding-bottom:90px">' + body + '</div></main>';
}
function tabBtn(id,label){
  return '<button class="'+(TAB===id?"on":"")+'" data-act="tab" data-tab="'+id+'">'+label+'</button>';
}

/* ------------------------------------------------------------- diary */
function statusPill(s){
  if (s==="done")      return '<span class="pill done">Done</span>';
  if (s==="cancelled") return '<span class="pill gone">Cancelled</span>';
  if (s==="noshow")    return '<span class="pill gone">No show</span>';
  return '<span class="pill book">Booked</span>';
}

function viewDiary(){
  var day = DAY || today();
  var list = D.bookings.slice().sort(function(a,b){ return a.start_time < b.start_time ? -1 : 1; });
  var takings = list.filter(function(b){ return b.status==="done"; })
                    .reduce(function(t,b){ return t + (b.price_pence||0); }, 0);

  var rows = list.length ? list.map(function(b){
    var c = b.customers || {}, need = D.settings.stamps_required;
    var walkin = String(c.email||"").indexOf("@no-email.local") !== -1;
    return '<tr><td class="mono" style="color:var(--orange);font-weight:700">'+esc(hhmm(b.start_time))+'</td>'
      + '<td><b>'+esc(c.name||"—")+'</b>'
        + '<br><span class="tiny muted">'+esc(c.phone||"no number")
        + (walkin ? ' &middot; walk-in' : (c.email ? ' &middot; '+esc(c.email) : ''))+'</span>'
        + (b.notes ? '<br><span class="tiny muted">&ldquo;'+esc(b.notes)+'&rdquo;</span>' : '')+'</td>'
      + '<td>'+esc((b.services&&b.services.name||"—").replace(/ — free$/,""))
        + '<br><span class="tiny muted">'+b.mins+' min &middot; '+money(b.price_pence)+'</span></td>'
      + '<td>'+esc(b.barbers&&b.barbers.name||"—")+'</td>'
      + '<td class="mono tiny">'+esc(b.ref)+'</td>'
      + '<td>'+statusPill(b.status)
        + (c.email && !walkin ? '<br><span class="tiny muted">card '+(c.stamps||0)+'/'+need
            +(c.free_cuts>0?' &middot; FREE READY':'')+'</span>' : '')+'</td>'
      + '<td><div class="acts">'
        + (b.status==="booked"
            ? '<button class="btn sm" data-act="done" data-id="'+b.id+'">Done</button>'
              + '<button class="btn quiet sm" data-act="noshow" data-id="'+b.id+'">No show</button>'
              + '<button class="btn danger sm" data-act="cancelbk" data-id="'+b.id+'">Cancel</button>'
            : '<button class="btn quiet sm" data-act="reopen" data-id="'+b.id+'">Reopen</button>')
      + '</div></td></tr>';
  }).join("") : '<tr><td colspan="7"><div class="empty">Nothing in the diary for this day.</div></td></tr>';

  var upcoming = 0;
  return '<div class="kpis">'
    + '<div class="kpi"><b>'+list.filter(function(b){return b.status==="booked";}).length+'</b><small>Still to come</small></div>'
    + '<div class="kpi"><b>'+list.filter(function(b){return b.status==="done";}).length+'</b><small>Cut today</small></div>'
    + '<div class="kpi"><b>'+total(takings)+'</b><small>Taken today</small></div>'
    + '<div class="kpi"><b>'+D.customers.length+'</b><small>On the card</small></div>'
    + '<div class="kpi"><b>'+D.customers.filter(function(c){return c.free_cuts>0;}).length+'</b><small>Free cuts owed</small></div></div>'

    + '<div class="staffbar" style="border-bottom:0;padding-top:0">'
      + '<button class="btn quiet sm" data-act="day" data-delta="-1">&larr; Previous</button>'
      + '<input type="date" value="'+day+'" data-act="pickday" aria-label="Diary date" '
      + 'style="background:var(--ink-3);border:1px solid var(--line);border-radius:4px;padding:9px 12px;font-family:var(--mono)">'
      + '<button class="btn quiet sm" data-act="day" data-delta="1">Next &rarr;</button>'
      + '<button class="btn quiet sm" data-act="day" data-delta="0">Today</button>'
      + '<button class="btn sm" data-act="addbooking" style="margin-left:auto">+ Add booking</button></div>'

    + (ADDING ? addBookingForm(day) : "")

    + '<div class="tablewrap"><table class="data"><thead><tr>'
    + '<th>Time</th><th>Customer</th><th>Service</th><th>Barber</th><th>Ref</th><th>Status</th><th></th>'
    + '</tr></thead><tbody>'+rows+'</tbody></table></div>'

    + '<div class="panel" style="margin-top:22px"><h4>Block out time</h4>'
    + '<p class="ph">Lunch, training, a day off — anything that should stop the diary offering that chair.</p>'
    + '<form data-form="timeoff">'
      + '<div class="row2"><div class="field"><label>Who</label><select name="barber_id">'
      + '<option value="">Whole shop</option>'
      + D.barbers.map(function(b){ return '<option value="'+b.id+'">'+esc(b.name)+'</option>'; }).join("")
      + '</select></div><div class="field"><label>Note</label><input name="note" placeholder="Lunch, holiday, training…"></div></div>'
      + '<div class="row2"><div class="field"><label>From</label><input type="datetime-local" name="starts_at" required></div>'
      + '<div class="field"><label>Until</label><input type="datetime-local" name="ends_at" required></div></div>'
      + '<button class="btn" type="submit" data-submit>Block it out</button></form>'
    + (D.timeoff.length ? '<div class="tablewrap" style="margin-top:18px"><table class="data"><tbody>'
        + D.timeoff.map(function(t){
            return '<tr><td>'+esc(t.barber_id ? (D.barbers.filter(function(b){return b.id===t.barber_id;})[0]||{}).name || "—" : "Whole shop")+'</td>'
              + '<td class="tiny">'+esc(String(t.starts_at).replace("T"," ").slice(0,16))+'</td>'
              + '<td class="tiny">'+esc(String(t.ends_at).replace("T"," ").slice(0,16))+'</td>'
              + '<td class="tiny muted">'+esc(t.note||"")+'</td>'
              + '<td style="text-align:right"><button class="iconbtn" data-act="deltimeoff" data-id="'+t.id+'" title="Remove">&times;</button></td></tr>';
          }).join("") + '</tbody></table></div>' : '')
    + '</div>';
}

function addBookingForm(day){
  return '<div class="panel"><h4>Add a booking</h4>'
    + '<p class="ph">For walk-ins and anyone who rings up. This one ignores the hour&rsquo;s notice rule.</p>'
    + '<form data-form="addbooking">'
    + '<div class="row2"><div class="field"><label>Service</label><select name="service" required>'
      + D.services.map(function(s){ return '<option value="'+s.id+'">'+esc(s.name)+' — '+money(s.price_pence)+'</option>'; }).join("")
    + '</select></div><div class="field"><label>Barber</label><select name="barber" required>'
      + D.barbers.map(function(b){ return '<option value="'+b.id+'">'+esc(b.name)+'</option>'; }).join("")
    + '</select></div></div>'
    + '<div class="row2"><div class="field"><label>Date</label><input type="date" name="date" value="'+day+'" required></div>'
    + '<div class="field"><label>Time</label><input type="time" name="time" required></div></div>'
    + '<div class="row2"><div class="field"><label>Name</label><input name="name" required></div>'
    + '<div class="field"><label>Mobile</label><input name="phone" inputmode="tel"></div></div>'
    + '<div class="field"><label>Email <span class="muted">(optional — needed for the card and confirmation)</span></label>'
    + '<input name="email" type="email"></div>'
    + '<div class="field"><label>Notes</label><input name="notes"></div>'
    + '<label class="checkline"><input type="checkbox" name="free">'
    + '<div><div class="t">Free cut</div><div class="muted small">Charges nothing and does not stamp their card.</div></div></label>'
    + '<div style="display:flex;gap:10px"><button class="btn" type="submit" data-submit>Add to the diary</button>'
    + '<button class="btn ghost" type="button" data-act="canceladd">Cancel</button></div></form></div>';
}

/* ----------------------------------------------------------- members */
function viewMembers(){
  var need = D.settings.stamps_required;
  var q = ($("#msearch") && $("#msearch").value || "").toLowerCase();
  var list = D.customers.filter(function(c){
    if (String(c.email).indexOf("@no-email.local") !== -1 && !q) return true;
    if (!q) return true;
    return (c.name+" "+c.email+" "+(c.phone||"")).toLowerCase().indexOf(q) !== -1;
  });
  var rows = list.length ? list.map(function(m){
    var walkin = String(m.email).indexOf("@no-email.local") !== -1;
    return '<tr><td><b>'+esc(m.name||"—")+'</b></td>'
      + '<td class="tiny">'+(walkin ? '<span class="muted">walk-in, no email</span>' : esc(m.email))
        + '<br><span class="muted">'+esc(m.phone||"")+'</span></td>'
      + '<td class="mono tiny">'+esc(m.card_number)+'</td>'
      + '<td class="mono">'+m.stamps+' / '+need+'</td>'
      + '<td>'+(m.free_cuts>0
          ? '<span class="pill done">'+m.free_cuts+' free cut'+(m.free_cuts>1?'s':'')+'</span>'
          : '<span class="pill">'+(need-m.stamps)+' to go</span>')
        + (m.marketing_opt_in ? ' <span class="pill">mailing list</span>' : '')+'</td>'
      + '<td class="tiny muted">'+esc(String(m.created_at||"").slice(0,10))+'</td>'
      + '<td><div class="acts">'
        + '<button class="btn quiet sm" data-act="stamp" data-id="'+m.id+'" data-delta="1">+ Stamp</button>'
        + '<button class="btn quiet sm" data-act="stamp" data-id="'+m.id+'" data-delta="-1" title="Undo a stamp">&minus;</button>'
        + (m.free_cuts>0 ? '<button class="btn sm" data-act="redeem" data-id="'+m.id+'">Redeem</button>' : '')
        + (walkin ? '' : '<button class="btn quiet sm" data-act="sendcard" data-id="'+m.id+'">Email card</button>')
        + '<button class="iconbtn" data-act="delmember" data-id="'+m.id+'" title="Delete this person and their history">&times;</button>'
      + '</div></td></tr>';
  }).join("") : '<tr><td colspan="7"><div class="empty">Nobody matches that.</div></td></tr>';

  return '<div class="staffbar" style="border-bottom:0;padding-top:0">'
    + '<input id="msearch" data-act="msearch" placeholder="Search name, email or number" '
    + 'style="background:var(--ink-3);border:1px solid var(--line);border-radius:4px;padding:10px 13px;min-width:240px" value="'+esc(q)+'">'
    + '<button class="btn quiet sm" data-act="export">Export mailing list</button>'
    + '<span class="muted small" style="margin-left:auto">'+D.customers.length+' people &middot; '
    + D.customers.filter(function(c){return c.marketing_opt_in;}).length+' on the mailing list &middot; '
    + D.customers.filter(function(c){return c.free_cuts>0;}).length+' owed a free cut</span></div>'
    + '<div class="tablewrap"><table class="data"><thead><tr>'
    + '<th>Name</th><th>Contact</th><th>Card no.</th><th>Stamps</th><th>Status</th><th>Joined</th><th></th>'
    + '</tr></thead><tbody>'+rows+'</tbody></table></div>'
    + '<p class="tiny muted" style="margin-top:14px">Only email people who are on the mailing list. '
    + 'Deleting somebody wipes their bookings and their card for good — that is what to do if they ask to be forgotten.</p>';
}

/* ---------------------------------------------------------- settings */
function viewSettings(){
  var s = D.settings;
  var shop = '<div class="panel"><h4>Shop details</h4><p class="ph">These show across the site, in emails, and on the card.</p>'
    + '<form data-form="set-shop">'
    + '<div class="row2"><div class="field"><label>Shop name</label><input name="shop_name" value="'+esc(s.shop_name)+'" required></div>'
    + '<div class="field"><label>Strapline</label><input name="strapline" value="'+esc(s.strapline)+'"></div></div>'
    + '<div class="row2"><div class="field"><label>Street</label><input name="address_1" value="'+esc(s.address_1)+'"></div>'
    + '<div class="field"><label>Town</label><input name="address_2" value="'+esc(s.address_2)+'"></div></div>'
    + '<div class="row2"><div class="field"><label>Postcode</label><input name="postcode" value="'+esc(s.postcode)+'"></div>'
    + '<div class="field"><label>Phone</label><input name="phone" value="'+esc(s.phone||"")+'" placeholder="01843 000000"></div></div>'
    + '<div class="row2"><div class="field"><label>Email</label><input name="email" value="'+esc(s.email||"")+'" placeholder="hello@mitchsbarbershop.co.uk"></div>'
    + '<div class="field"><label>Instagram</label><input name="instagram" value="'+esc(s.instagram||"")+'" placeholder="@mitchgeorgejohn_"></div></div>'
    + '<div class="field"><label>About the shop</label><textarea name="blurb">'+esc(s.blurb||"")+'</textarea></div>'
    + '<div class="field"><label>Getting here</label><textarea name="getting_here" placeholder="Parking, buses, which end of the road…">'+esc(s.getting_here||"")+'</textarea></div>'
    + '<button class="btn" type="submit" data-submit>Save shop details</button></form></div>';

  var hours = '<div class="panel"><h4>Opening hours</h4><p class="ph">The diary only offers times inside these.</p>'
    + '<form data-form="set-hours">'
    + D.hours.map(function(h){
        return '<div class="hoursrow"><span>'+esc(h.label)+'</span>'
          + '<input type="time" name="open_'+h.dow+'" value="'+hhmm(h.opens)+'">'
          + '<input type="time" name="close_'+h.dow+'" value="'+hhmm(h.closes)+'">'
          + '<label><input type="checkbox" name="closed_'+h.dow+'"'+(h.closed?" checked":"")+'> Closed</label></div>';
      }).join("")
    + '<button class="btn" type="submit" data-submit style="margin-top:10px">Save hours</button></form></div>';

  var svcs = '<div class="panel"><h4>Services &amp; prices</h4>'
    + '<p class="ph">Price in pounds. Minutes is how much chair time it books out.</p>'
    + '<form data-form="set-services">'
    + '<div class="editrow" style="border:0;margin-bottom:6px"><span class="tiny muted">Service</span>'
    + '<span class="tiny muted">Price</span><span class="tiny muted">Minutes</span><span></span></div>'
    + D.services.map(function(v){
        return '<div class="editrow">'
          + '<input name="n_'+v.id+'" value="'+esc(v.name)+'" required>'
          + '<input name="p_'+v.id+'" type="number" min="0" step="0.5" value="'+(v.price_pence/100)+'" required>'
          + '<input name="m_'+v.id+'" type="number" min="5" step="5" value="'+v.mins+'" required>'
          + '<button type="button" class="iconbtn" data-act="delsvc" data-id="'+v.id+'" title="Remove">&times;</button>'
          + '<input name="d_'+v.id+'" value="'+esc(v.description||"")+'" placeholder="One line description" style="grid-column:1/-1">'
          + '<label class="tiny muted" style="grid-column:1/-1;display:flex;gap:8px;align-items:center">'
          + '<input type="checkbox" name="s_'+v.id+'"'+(v.earns_stamp?" checked":"")+' style="accent-color:var(--orange)"> '
          + 'Counts towards the cut card</label>'
          + '</div>';
      }).join("")
    + '<div style="display:flex;gap:10px;margin-top:14px"><button class="btn" type="submit" data-submit>Save services</button>'
    + '<button class="btn quiet" type="button" data-act="addsvc">+ Add service</button></div></form></div>';

  var team = '<div class="panel"><h4>The team</h4><p class="ph">Each barber gets their own column in the diary.</p>'
    + '<form data-form="set-staff">'
    + D.barbers.map(function(b){
        return '<div class="editrow" style="grid-template-columns:1fr 1fr 34px">'
          + '<input name="n_'+b.id+'" value="'+esc(b.name)+'" required placeholder="Name">'
          + '<input name="r_'+b.id+'" value="'+esc(b.role||"")+'" placeholder="Role">'
          + '<button type="button" class="iconbtn" data-act="delstaff" data-id="'+b.id+'" title="Remove">&times;</button>'
          + '<input name="b_'+b.id+'" value="'+esc(b.bio||"")+'" placeholder="One line about them" style="grid-column:1/-1">'
          + '</div>';
      }).join("")
    + '<div style="display:flex;gap:10px;margin-top:14px"><button class="btn" type="submit" data-submit>Save team</button>'
    + '<button class="btn quiet" type="button" data-act="addstaff">+ Add barber</button></div></form></div>';

  var rules = '<div class="panel"><h4>Card &amp; diary rules</h4><p class="ph">How the loyalty card and the booking grid behave.</p>'
    + '<form data-form="set-rules">'
    + '<div class="row2"><div class="field"><label>Paid cuts before a free one</label>'
      + '<input name="stamps_required" type="number" min="2" max="30" value="'+s.stamps_required+'"></div>'
    + '<div class="field"><label>Slot spacing (minutes)</label>'
      + '<input name="slot_mins" type="number" min="5" max="60" step="5" value="'+s.slot_mins+'"></div></div>'
    + '<div class="row2"><div class="field"><label>Earliest booking (minutes ahead)</label>'
      + '<input name="lead_mins" type="number" min="0" max="1440" step="15" value="'+s.lead_mins+'"></div>'
    + '<div class="field"><label>Diary opens this far ahead (days)</label>'
      + '<input name="horizon_days" type="number" min="1" max="180" value="'+s.horizon_days+'"></div></div>'
    + '<div class="row2"><div class="field"><label>Customers can cancel up to (hours before)</label>'
      + '<input name="cancel_hours" type="number" min="0" max="168" value="'+s.cancel_hours+'"></div>'
    + '<div class="field"><label>Website address</label><input name="site_url" value="'+esc(s.site_url)+'"></div></div>'
    + '<label class="checkline"><input type="checkbox" name="reminders_enabled"'+(s.reminders_enabled?" checked":"")+'>'
    + '<div><div class="t">Email a reminder the evening before</div>'
    + '<div class="muted small">Biggest thing you can do about no-shows.</div></div></label>'
    + '<div class="row2"><div class="field"><label>Emails come from (name)</label><input name="from_name" value="'+esc(s.from_name)+'"></div>'
    + '<div class="field"><label>Emails come from (address)</label><input name="from_email" value="'+esc(s.from_email)+'"></div></div>'
    + '<button class="btn" type="submit" data-submit>Save rules</button></form></div>';

  var pw = '<div class="panel"><h4>Your password</h4><p class="ph">Changes the login for the account you are signed in with.</p>'
    + '<form data-form="set-password"><div class="field"><label>New password</label>'
    + '<input name="password" type="password" minlength="8" required autocomplete="new-password"></div>'
    + '<button class="btn" type="submit" data-submit>Change password</button></form></div>';

  return shop + hours + svcs + team + rules + pw;
}

/* ------------------------------------------------------------ render */
function render(){
  var root = $("#root");
  if (!SIGNED_IN){ root.innerHTML = viewLogin(); return; }
  if (!D.settings){ root.innerHTML = chrome('<div class="loading"><span class="spin"></span>Opening the diary…</div>'); return; }
  var body = TAB === "members" ? viewMembers() : (TAB === "settings" ? viewSettings() : viewDiary());
  root.innerHTML = chrome(body);
}

/* -------------------------------------------------------- data loads */
function loadCore(){
  return Promise.all([
    API.select("settings", "id=eq.1&select=*", true),
    API.select("services", "select=*&order=sort,name", true),
    API.select("barbers", "select=*&order=sort,name", true),
    API.select("opening_hours", "select=*&order=dow", true),
    API.select("mail_outbox", "status=eq.failed&select=id", true)
  ]).then(function (r) {
    D.settings = r[0][0]; D.services = r[1]; D.barbers = r[2]; D.hours = r[3];
    D.failed = (r[4] || []).length;
  });
}

function loadDay(){
  var day = DAY || today();
  return Promise.all([
    API.select("bookings",
      "booking_date=eq." + day
      + "&select=id,ref,start_time,mins,price_pence,status,notes,free_cut,"
      + "customers(id,name,email,phone,stamps,free_cuts),barbers(name),services(name)"
      + "&order=start_time", true),
    API.select("time_off", "ends_at=gte." + new Date().toISOString() + "&select=*&order=starts_at", true)
  ]).then(function (r) { D.bookings = r[0]; D.timeoff = r[1]; });
}

function loadCustomers(){
  return API.select("customers", "select=*&order=created_at.desc&limit=2000", true)
    .then(function (r) { D.customers = r; });
}

function refresh(){
  return API.ensureSession()
    .then(function(){ return Promise.all([loadCore(), loadDay(), loadCustomers()]); })
    .then(function(){ render(); })
    .catch(function(err){
      if (String(err.message).indexOf("Not signed in") !== -1 || err.status === 401){
        SIGNED_IN = false; render();
      } else fail(err);
    });
}

/* ------------------------------------------------------------ actions */
function after(msg){ return function(){ if (msg) toast(msg, "good"); BUSY = false; return refresh(); }; }

document.addEventListener("click", function(e){
  var t = e.target.closest ? e.target.closest("[data-act]") : null;
  if (!t) return;
  var act = t.getAttribute("data-act"), id = t.getAttribute("data-id");
  if (act === "pickday" || act === "msearch") return;

  if (act === "tab"){ TAB = t.getAttribute("data-tab"); sessionStorage.setItem("mitchs.tab", TAB); render(); return; }
  if (act === "logout"){ API.signOut().then(function(){ SIGNED_IN = false; render(); }); return; }

  if (act === "day"){
    var delta = +t.getAttribute("data-delta");
    if (delta === 0) DAY = today();
    else { var c = fromYmd(DAY || today()); c.setDate(c.getDate() + delta); DAY = ymd(c); }
    sessionStorage.setItem("mitchs.day", DAY);
    loadDay().then(render, fail); return;
  }
  if (act === "addbooking"){ ADDING = true; render(); return; }
  if (act === "canceladd"){ ADDING = false; render(); return; }

  if (BUSY) return;

  if (act === "done"){
    BUSY = true; busy(t, true, "…");
    API.rpc("complete_booking", { p_booking: id }, true).then(function(res){
      BUSY = false;
      if (res && res.ok === false) { toast(res.error, "bad"); return refresh(); }
      toast(res.stamped
        ? "Cut logged. Card stamped — " + res.stamps + "/" + res.stamps_required
          + (res.free_cuts > 0 ? " · FREE CUT UNLOCKED" : "")
        : "Cut logged. No stamp on a free cut.", "good");
      return refresh();
    }, fail);
    return;
  }
  if (act === "noshow" || act === "cancelbk" || act === "reopen"){
    var st = act === "noshow" ? "noshow" : (act === "cancelbk" ? "cancelled" : "booked");
    if (act === "cancelbk" && !confirm("Cancel this booking?")) return;
    BUSY = true; busy(t, true, "…");
    API.rpc("set_booking_status", { p_booking: id, p_status: st }, true)
      .then(after(st === "booked" ? "Back in the diary." : (st === "noshow" ? "Marked as a no show." : "Cancelled.")), fail);
    return;
  }
  if (act === "stamp"){
    BUSY = true; busy(t, true, "…");
    API.rpc("adjust_stamps", { p_customer: id, p_delta: +t.getAttribute("data-delta") }, true)
      .then(function(res){
        BUSY = false;
        if (res && res.ok === false) { toast(res.error, "bad"); return refresh(); }
        toast(res.free_cuts > 0 ? "Stamped — free cut unlocked." : "Stamped.", "good");
        return refresh();
      }, fail);
    return;
  }
  if (act === "redeem"){
    BUSY = true; busy(t, true, "…");
    API.rpc("redeem_free_cut", { p_customer: id }, true).then(after("Free cut redeemed."), fail);
    return;
  }
  if (act === "sendcard"){
    BUSY = true; busy(t, true, "…");
    API.rpc("staff_send_card", { p_customer: id }, true).then(after("Card emailed."), fail);
    return;
  }
  if (act === "delmember"){
    if (!confirm("Delete this person, their bookings and their card? This cannot be undone.")) return;
    BUSY = true;
    API.remove("customers", "id=eq." + id, true).then(after("Deleted."), fail);
    return;
  }
  if (act === "deltimeoff"){
    BUSY = true;
    API.remove("time_off", "id=eq." + id, true).then(after("Unblocked."), fail);
    return;
  }
  if (act === "export"){ exportCsv(); return; }

  if (act === "addsvc"){
    BUSY = true;
    API.insert("services", [{ name: "New service " + Date.now().toString().slice(-4),
                              description: "Describe it in one line.", price_pence: 1500,
                              mins: 30, sort: D.services.length + 1 }], true)
      .then(after("Service added."), fail);
    return;
  }
  if (act === "delsvc"){
    if (D.services.length <= 1) { toast("Keep at least one service.", "bad"); return; }
    if (!confirm("Remove this service? Past bookings keep it on record.")) return;
    BUSY = true;
    API.update("services", "id=eq." + id, { active: false }, true).then(after("Service removed."), fail);
    return;
  }
  if (act === "addstaff"){
    BUSY = true;
    API.insert("barbers", [{ name: "New barber " + Date.now().toString().slice(-4),
                             role: "Barber", bio: "", sort: D.barbers.length + 1 }], true)
      .then(after("Barber added."), fail);
    return;
  }
  if (act === "delstaff"){
    if (D.barbers.length <= 1) { toast("You need at least one barber.", "bad"); return; }
    if (!confirm("Remove this barber from the diary?")) return;
    BUSY = true;
    API.update("barbers", "id=eq." + id, { active: false }, true).then(after("Barber removed."), fail);
    return;
  }
});

document.addEventListener("change", function(e){
  if (e.target.getAttribute && e.target.getAttribute("data-act") === "pickday"){
    DAY = e.target.value || today();
    sessionStorage.setItem("mitchs.day", DAY);
    loadDay().then(render, fail);
  }
});
document.addEventListener("input", function(e){
  if (e.target.id === "msearch"){
    var v = e.target.value, pos = e.target.selectionStart;
    render();
    var box = $("#msearch");
    if (box){ box.value = v; box.focus(); try { box.setSelectionRange(pos, pos); } catch(err){} }
  }
});

/* -------------------------------------------------------------- forms */
document.addEventListener("submit", function(e){
  var f = e.target, kind = f.getAttribute("data-form");
  if (!kind) return;
  e.preventDefault();
  var d = new FormData(f), g = function(k){ return String(d.get(k) || "").trim(); };
  var btn = f.querySelector("[data-submit]");

  if (kind === "login"){
    busy(btn, true, "Signing in…");
    API.signIn(g("email"), g("password")).then(function(){
      SIGNED_IN = true; render(); return refresh();
    }, function(err){
      busy(btn, false);
      $("#root").innerHTML = viewLogin(
        /Invalid login/i.test(err.message) ? "That email and password do not match." : err.message);
    });
    return;
  }

  if (BUSY) return;
  BUSY = true; busy(btn, true, "Saving…");

  if (kind === "addbooking"){
    API.rpc("staff_create_booking", {
      p_service: g("service"), p_barber: g("barber"), p_date: g("date"), p_time: g("time"),
      p_name: g("name"), p_email: g("email"), p_phone: g("phone"), p_notes: g("notes"),
      p_free: d.get("free") !== null
    }, true).then(function(res){
      BUSY = false;
      if (!res.ok){ busy(btn, false); toast(res.error, "bad"); return; }
      ADDING = false; toast("Added — " + res.ref, "good"); return refresh();
    }, fail);
    return;
  }

  if (kind === "timeoff"){
    API.insert("time_off", [{
      barber_id: g("barber_id") || null,
      starts_at: new Date(g("starts_at")).toISOString(),
      ends_at: new Date(g("ends_at")).toISOString(),
      note: g("note")
    }], true).then(after("Blocked out."), fail);
    return;
  }

  if (kind === "set-shop"){
    var patch = {};
    ["shop_name","strapline","address_1","address_2","postcode","phone","email","instagram","blurb","getting_here"]
      .forEach(function(k){ patch[k] = g(k); });
    API.update("settings", "id=eq.1", patch, true).then(after("Shop details saved."), fail);
    return;
  }

  if (kind === "set-hours"){
    Promise.all(D.hours.map(function(h){
      return API.update("opening_hours", "dow=eq." + h.dow, {
        opens: g("open_" + h.dow) || h.opens,
        closes: g("close_" + h.dow) || h.closes,
        closed: d.get("closed_" + h.dow) !== null
      }, true);
    })).then(after("Opening hours saved."), fail);
    return;
  }

  if (kind === "set-services"){
    Promise.all(D.services.map(function(v){
      return API.update("services", "id=eq." + v.id, {
        name: g("n_" + v.id) || v.name,
        price_pence: Math.round((parseFloat(g("p_" + v.id)) || 0) * 100),
        mins: parseInt(g("m_" + v.id), 10) || v.mins,
        description: g("d_" + v.id),
        earns_stamp: d.get("s_" + v.id) !== null
      }, true);
    })).then(after("Services saved."), fail);
    return;
  }

  if (kind === "set-staff"){
    Promise.all(D.barbers.map(function(b){
      return API.update("barbers", "id=eq." + b.id, {
        name: g("n_" + b.id) || b.name, role: g("r_" + b.id), bio: g("b_" + b.id)
      }, true);
    })).then(after("Team saved."), fail);
    return;
  }

  if (kind === "set-rules"){
    API.update("settings", "id=eq.1", {
      stamps_required: parseInt(g("stamps_required"), 10) || 8,
      slot_mins: parseInt(g("slot_mins"), 10) || 15,
      lead_mins: parseInt(g("lead_mins"), 10) || 0,
      horizon_days: parseInt(g("horizon_days"), 10) || 21,
      cancel_hours: parseInt(g("cancel_hours"), 10) || 0,
      site_url: g("site_url"),
      from_name: g("from_name"),
      from_email: g("from_email"),
      reminders_enabled: d.get("reminders_enabled") !== null
    }, true).then(after("Rules saved."), fail);
    return;
  }

  if (kind === "set-password"){
    API.changePassword(g("password")).then(function(){
      BUSY = false; busy(btn, false); f.reset(); toast("Password changed.", "good");
    }, fail);
    return;
  }
});

/* -------------------------------------------------------------- export */
function exportCsv(){
  var need = D.settings.stamps_required;
  var people = D.customers.filter(function(c){
    return c.marketing_opt_in && String(c.email).indexOf("@no-email.local") === -1;
  });
  if (!people.length){ toast("Nobody has opted in to the mailing list yet.", "bad"); return; }
  var q = function(v){ return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
  var lines = [["Name","Email","Phone","Card number","Stamps","Out of","Free cuts waiting","Redeemed","Joined"].map(q).join(",")];
  people.forEach(function(m){
    lines.push([m.name, m.email, m.phone, m.card_number, m.stamps, need, m.free_cuts, m.redeemed,
                String(m.created_at || "").slice(0, 10)].map(q).join(","));
  });
  var blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mitchs-mailing-list-" + today() + ".csv";
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(people.length + " opted-in contacts exported.", "good");
}

/* --------------------------------------------------------------- boot */
function boot(){
  if (!API.configured()){
    $("#root").innerHTML = '<div class="wrap" style="padding:80px 0"><div class="errbox">'
      + 'Not connected yet — see README step 2.</div></div>';
    return;
  }
  if (API.getSession()){
    SIGNED_IN = true; render();
    refresh();
  } else {
    render();
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
})();
