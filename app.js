/* Northpoint Team — clock in/out, hours, time off and an hours export for the tips dashboard.
   Demo build: all data lives in this browser (see `store`). The same calls will later go to Supabase. */
(() => {
'use strict';
const ART = !!window.NP_ARTIFACT;                 // true inside the Claude preview, false for the real files
const KEY = 'np-team-demo-v1';
const CFG = window.NP_CONFIG || {};
const DEMO = ART || !CFG.supabaseUrl || !window.supabase || new URLSearchParams(location.search).has('demo');   // demo keeps everything in this browser
let sb = null;
const HOUR = 36e5, DAY = 864e5;
const STALE = 14 * HOUR;                          // an open shift older than this is flagged as a forgotten clock-out

function h(tag, attrs, ...kids){
  const el = document.createElement(tag); let val;
  for (const [k,v] of Object.entries(attrs||{})){
    if (v==null || v===false) continue;
    if (k==='html') el.innerHTML = v; else if (k==='value') val = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k==='class') el.className = v; else el.setAttribute(k, v===true? '' : v);
  }
  const add = c => { if (c==null || c===false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c.nodeType? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  if (val!=null) el.value = val;
  return el;
}
const svg = d => '<svg viewBox="0 0 24 24" aria-hidden="true">'+d+'</svg>';
const I = {
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  hours: svg('<path d="M4 6h16M4 12h16M4 18h10"/>'),
  team: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.700 6 6"/><path d="M16 5.200a3.200 3.200 0 0 1 0 5.600M18 14.500c1.800.9 3 2.900 3 5.500"/>'),
  leave: svg('<rect x="3.500" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.500 10h17"/>'),
  bell: svg('<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  admin: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
  left: svg('<path d="M15 6l-6 6 6 6"/>'), right: svg('<path d="M9 6l6 6-6 6"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'), plus: svg('<path d="M12 5v14M5 12h14"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.500 1.500M17.500 17.500L19 19M5 19l1.500-1.500M17.500 6.500L19 5"/>'),
  moon: svg('<path d="M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500z"/>'),
  warn: svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.500v.01"/>'),
  down: svg('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>'), copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>')
};

const DEMO_VENUES = [{id:'v1',name:'Miracles'},{id:'v2',name:'Bay Square'},{id:'v3',name:'Victoria'},{id:'v4',name:'Merak'},{id:'v5',name:'Tramonto'},{id:'v6',name:'Ammos'},{id:'v7',name:'Kush Hooch'},{id:'xmusti0bzrmndx',name:'Zorbas'}];
const V = () => (db && db.venues) || [];
const vName = id => (V().find(v=>v.id===id)||{}).name || 'Unknown venue';
const LOGOS = new Set(['v1','v2','v3','v4','v5','v6','v7','v8','xmusti0bzrmndx']);      // keyed by venue id, same files as Operations
const logoSrc = id => ART ? 'data:image/png;base64,'+window.NP_LOGOS[id] : 'logos/'+id+'.png';
const vLogo = (id, cls) => LOGOS.has(id) ? h('img',{class:'vlogo'+(cls? ' '+cls : ''),src:logoSrc(id),alt:vName(id)}) : h('b',{class:'vtext'},vName(id));
const ROLES = {employee:'Employee', manager:'Manager', admin:'Admin'};
const OPS = {maintenance:'Maintenance', manager:'Manager', admin:'Admin', owner:'Owner'};      // roles in the Operations app
const LEAVE = {holiday:'Holiday', sick:'Sick leave', unpaid:'Unpaid leave', other:'Other'};

/* ---------- dates ---------- */
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WDL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'], MOL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const pad = n => String(n).padStart(2,'0');
const fmtT = t => { const d = new Date(t); return pad(d.getHours())+':'+pad(d.getMinutes()); };
const fmtD = t => { const d = new Date(t); return WD[d.getDay()]+' '+d.getDate()+' '+MO[d.getMonth()]; };
const iso = t => { const d = new Date(t); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };
const fromIso = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d).getTime(); };
const day0 = t => { const d = new Date(t); d.setHours(0,0,0,0); return d.getTime(); };
const addDays = (t,n) => { const d = new Date(t); d.setDate(d.getDate()+n); return d.getTime(); };
const weekStart = t => addDays(day0(t), -((new Date(t).getDay()+6)%7));       // weeks run Monday to Sunday
const dur = ms => { const m = Math.max(0, Math.round(ms/6e4)); return Math.floor(m/60)+'h '+pad(m%60)+'m'; };
const hrs = ms => (ms/HOUR).toFixed(2);
const ago = t => { const m = Math.round((Date.now()-t)/6e4); return m<1? 'now' : m<60? m+'m ago' : m<1440? Math.floor(m/60)+'h ago' : fmtD(t); };
const rangeText = (a,b) => a===b ? fmtD(fromIso(a)) : fmtD(fromIso(a))+' – '+fmtD(fromIso(b));
const dayCount = (a,b) => Math.round((fromIso(b)-fromIso(a))/DAY)+1;

/* ---------- store (this browser only) ---------- */
let mem = null;
const store = {
  load(){ try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch {} return mem; },
  save(db){ mem = db; try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} }
};
const uid = () => 'x'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);

function seed(){
  const now = Date.now(), today = day0(now);
  let a = 20261004; const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a>>>15, 1|a); t = t + Math.imul(t ^ t>>>7, 61|t) ^ t; return ((t ^ t>>>14)>>>0)/4294967296; };
  const people = [
    {id:'p1',name:'Mili',job:'General Manager',role:'admin',venues:DEMO_VENUES.map(v=>v.id)},
    {id:'p2',name:'Dario Kovač',job:'Venue manager',role:'manager',venues:['v3','v4']},
    {id:'p3',name:'Elena Rossi',job:'Venue manager',role:'manager',venues:['v1','v6']},
    {id:'p4',name:'Luka Petrović',job:'Bartender',role:'employee',venues:['v3']},
    {id:'p5',name:'Amara Okafor',job:'Waiter',role:'employee',venues:['v3','v4']},
    {id:'p6',name:'Tomás Silva',job:'Chef',role:'employee',venues:['v4']},
    {id:'p7',name:'Hana Suzuki',job:'Bartender',role:'employee',venues:['v1']},
    {id:'p8',name:'Yusuf Demir',job:'Waiter',role:'employee',venues:['v6','v1']},
    {id:'p9',name:'Sofia Marin',job:'Pizza chef',role:'employee',venues:['v5']},
    {id:'p10',name:'Nikos Pappas',job:'Grill chef',role:'employee',venues:['xmusti0bzrmndx']}
  ];
  const shifts = []; let n = 0;
  const onNow = {p4:3*HOUR+10*6e4, p7:HOUR+25*6e4, p6:5*HOUR+2*6e4};
  for (let d = 13; d >= 1; d--) for (const p of people){
    if (p.role==='admin') continue;
    const work = rnd() < 0.68, hour = 8+Math.floor(rnd()*9), min = Math.floor(rnd()*60), len = 6*HOUR + rnd()*3.2*HOUR;
    if (!work || (d===1 && (onNow[p.id] || p.id==='p5'))) continue;
    const t = addDays(today, -d) + hour*HOUR + min*6e4;
    shifts.push({id:'s'+(++n), person:p.id, venue:p.venues[d % p.venues.length], in:t, out:Math.round((t+len)/6e4)*6e4, edited:null});
  }
  shifts.push({id:'s'+(++n), person:'p5', venue:'v4', in:addDays(today,-1)+16*HOUR+4*6e4, out:null, edited:null});   // forgot to clock out
  for (const [pid,back] of Object.entries(onNow)) shifts.push({id:'s'+(++n), person:pid, venue:people.find(p=>p.id===pid).venues[0], in:Math.floor((now-back)/6e4)*6e4, out:null, edited:null});
  const fixed = shifts.filter(s=>s.person==='p4' && s.out).pop();
  if (fixed) fixed.edited = {by:'p2', at:fixed.out+2*HOUR, reason:'Forgot to clock out', was:{in:fixed.in, out:null}};
  const D = k => iso(addDays(today,k));
  const leave = [
    {id:'l1',person:'p4',type:'holiday',from:D(10),to:D(14),note:'Family trip',status:'pending',createdAt:now-5*HOUR},
    {id:'l2',person:'p7',type:'sick',from:D(-1),to:D(0),note:'Flu, doctor\'s note to follow',status:'pending',createdAt:now-20*HOUR},
    {id:'l3',person:'p5',type:'holiday',from:D(20),to:D(22),note:'',status:'approved',decidedBy:'p2',decidedAt:now-2*DAY,createdAt:now-3*DAY},
    {id:'l4',person:'p6',type:'unpaid',from:D(6),to:D(6),note:'Moving flat',status:'rejected',decidedBy:'p2',decidedAt:now-DAY,reason:'Two chefs are already off that day',createdAt:now-2*DAY},
    {id:'l5',person:'p2',type:'holiday',from:D(30),to:D(36),note:'',status:'pending',createdAt:now-8*HOUR},
    {id:'l6',person:'p9',type:'holiday',from:D(5),to:D(6),note:'Wedding',status:'pending',createdAt:now-3*HOUR}
  ];
  const inbox = [
    {id:'i1',to:'p2',kind:'leave',text:'Luka Petrović asked for Holiday, '+rangeText(D(10),D(14)),tab:'leave',at:now-5*HOUR,read:false},
    {id:'i2',to:'p2',kind:'clock',text:'Amara Okafor has been clocked in at Merak since yesterday. Forgot to clock out?',tab:'team',at:now-2*HOUR,read:false},
    {id:'i3',to:'p3',kind:'leave',text:'Hana Suzuki asked for Sick leave, '+rangeText(D(-1),D(0)),tab:'leave',at:now-20*HOUR,read:false},
    {id:'i4',to:'p1',kind:'leave',text:'Dario Kovač asked for Holiday, '+rangeText(D(30),D(36)),tab:'leave',at:now-8*HOUR,read:false},
    {id:'i5',to:'p1',kind:'leave',text:'Sofia Marin asked for Holiday, '+rangeText(D(5),D(6)),tab:'leave',at:now-3*HOUR,read:false},
    {id:'i6',to:'p5',kind:'decision',text:'Dario Kovač approved your Holiday, '+rangeText(D(20),D(22)),tab:'leave',at:now-2*DAY,read:true},
    {id:'i7',to:'p6',kind:'decision',text:'Dario Kovač rejected your Unpaid leave, '+rangeText(D(6),D(6))+': Two chefs are already off that day',tab:'leave',at:now-DAY,read:false}
  ];
  if (fixed) inbox.push({id:'i8',to:'p4',kind:'shift',text:'Dario Kovač changed your shift on '+fmtD(fixed.in)+': Forgot to clock out',tab:'hours',at:fixed.edited.at,read:false});
  return {seededOn:iso(now), touched:false, venues:DEMO_VENUES, people, shifts, leave, inbox, push:{}};
}

let db = null;
if (DEMO){ db = store.load(); if (!db || !db.venues || (!db.touched && db.seededOn !== iso(Date.now()))) { db = seed(); store.save(db); } }

const S = {ready:false, push:false, opsOwner:false, me:'p4', tab:null, seg:{team:'now', leave:'mine'}, week:weekStart(Date.now()), open:null, pickVenue:null,
           exp:{range:'thisWeek', venue:'all', format:'shifts'}};
if (DEMO) try { const u = localStorage.getItem(KEY+'-me'); if (u && db.people.some(p=>p.id===u)) S.me = u; } catch {}

/* ---------- who can do what ---------- */
const person = id => db.people.find(p=>p.id===id) || {id, name:'Former colleague', role:'employee', venues:[], job:''};
const me = () => person(S.me);
const initials = n => n.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
const shares = (a,b) => a.venues.some(v=>b.venues.includes(v));
const myVenues = () => me().role==='admin' ? V().map(v=>v.id) : me().venues;
const active = () => db.people.filter(p=>p.active!==false);
const team = () => me().role==='admin' ? active().filter(p=>p.role!=='admin') : active().filter(p=>p.role==='employee' && shares(p, me()));
const canEditShift = s => me().role==='admin' || (me().role==='manager' && person(s.person).role==='employee' && me().venues.includes(s.venue));
const canDecide = r => r.status==='pending' && (me().role==='admin' || (me().role==='manager' && person(r.person).role==='employee' && shares(person(r.person), me())));
function approversFor(p){
  const mgrs = p.role==='employee' ? active().filter(m=>m.role==='manager' && shares(m,p)) : [];
  return (mgrs.length ? mgrs : active().filter(m=>m.role==='admin')).filter(m=>m.id!==p.id);
}
const notify = (to, kind, text, tab) => { if (to!==S.me) db.inbox.push({id:uid(), to, kind, text, tab, at:Date.now(), read:false}); };
const openShift = pid => db.shifts.find(s=>s.person===pid && !s.out);
const sdur = s => (s.out || Date.now()) - s.in;
const unread = () => db.inbox.filter(m=>m.to===S.me && !m.read).length;
const toApprove = () => db.leave.filter(canDecide);

/* ---------- actions: the demo changes the local copy, the real app asks the database ---------- */
async function run(demoFn, call, ok){
  try {
    if (DEMO){ demoFn(); db.touched = true; store.save(db); }
    else { const {error} = await call(); if (error) throw error; await loadAll(); }
    if (ok) toast(ok);
  } catch (e){ toast((e && e.message) || 'That did not work. Try again.'); }
  render();
}
const rpc = (fn, args) => () => sb.rpc(fn, args);
const ts = t => t? new Date(t).toISOString() : null;
function clockIn(venue){
  if (openShift(S.me)) return;
  return run(()=>db.shifts.push({id:uid(), person:S.me, venue, in:Date.now(), out:null, edited:null}), rpc('hr_clock_in',{p_venue:venue}), 'Clocked in at '+vName(venue));
}
function clockOut(){
  const s = openShift(S.me); if (!s) return;
  const t = Date.now();
  return run(()=>{ s.out = t; }, rpc('hr_clock_out',{}), 'Clocked out · '+dur(t-s.in));
}
function saveShift(s, v, reason){
  return run(()=>{
    const who = me().name;
    if (!s){
      db.shifts.push({id:uid(), person:v.person, venue:v.venue, in:v.in, out:v.out, edited:{by:S.me, at:Date.now(), reason, was:null}});
      notify(v.person,'shift', who+' added a shift for you on '+fmtD(v.in)+': '+reason,'hours');
    } else {
      s.edited = {by:S.me, at:Date.now(), reason, was:(s.edited && s.edited.was) || {in:s.in, out:s.out}};
      Object.assign(s, {venue:v.venue, in:v.in, out:v.out});
      notify(s.person,'shift', who+' changed your shift on '+fmtD(v.in)+': '+reason,'hours');
    }
  }, rpc('hr_save_shift',{p_id:s? s.id : null, p_person:v.person, p_venue:v.venue, p_in:ts(v.in), p_out:ts(v.out), p_reason:reason}), 'Shift saved');
}
function deleteShift(s, reason){
  return run(()=>{
    db.shifts = db.shifts.filter(x=>x.id!==s.id);
    notify(s.person,'shift', me().name+' removed your shift on '+fmtD(s.in)+': '+reason,'hours');
  }, rpc('hr_delete_shift',{p_id:s.id, p_reason:reason}), 'Shift removed');
}
function requestLeave(v){
  return run(()=>{
    const r = {id:uid(), person:S.me, status:'pending', createdAt:Date.now(), ...v};
    db.leave.push(r);
    for (const a of approversFor(me())) notify(a.id,'leave', me().name+' asked for '+LEAVE[r.type]+', '+rangeText(r.from,r.to),'leave');
  }, rpc('hr_request_leave',{p_type:v.type, p_from:v.from, p_to:v.to, p_note:v.note}), 'Request sent');
}
function decide(r, ok, reason){
  return run(()=>{
    Object.assign(r, {status: ok? 'approved' : 'rejected', decidedBy:S.me, decidedAt:Date.now(), reason: reason||''});
    notify(r.person,'decision', me().name+(ok? ' approved' : ' rejected')+' your '+LEAVE[r.type]+', '+rangeText(r.from,r.to)+(reason? ': '+reason : ''),'leave');
  }, rpc('hr_decide_leave',{p_id:r.id, p_ok:ok, p_reason:reason||''}), ok? 'Approved' : 'Rejected');
}
const cancelLeave = r => run(()=>{ db.leave = db.leave.filter(x=>x.id!==r.id); }, rpc('hr_cancel_leave',{p_id:r.id}), 'Request cancelled');
function markRead(list){
  const ids = list.filter(m=>!m.read).map(m=>m.id); if (!ids.length) return;
  list.forEach(m=>{ m.read = true; });
  if (DEMO) store.save(db); else sb.from('hr_inbox').update({read_at:new Date().toISOString()}).in('id',ids).then(()=>{});
}
const savePerson = (p, v) => run(()=>{
    const on = v.role!=='none', row = {name:v.name, job:v.job, venues:v.venues, role: on? v.role : (p? p.role : 'employee'), active:on};
    if (p) Object.assign(p, row); else db.people.push({id:uid(), ...row});
  }, rpc('hr_save_person',{p_email:v.email, p_name:v.name, p_job:v.job, p_hr_role:v.role==='none'? null : v.role, p_ops_role:v.ops==='none'? null : v.ops, p_venues:v.venues}), 'Saved');
const disablePerson = p => run(()=>{ p.active = false; }, rpc('hr_disable_person',{p_email:p.id}), 'Disabled');
const deletePerson = p => run(()=>{
    db.people = db.people.filter(x=>x.id!==p.id); db.shifts = db.shifts.filter(x=>x.person!==p.id); db.leave = db.leave.filter(x=>x.person!==p.id);
  }, rpc('hr_delete_person',{p_email:p.id}), 'Deleted');

/* ---------- loading from the database ---------- */
// The database hands out at most 1000 rows per request, so long lists are fetched page by page.
async function pages(build){
  let data = [];
  for (let from = 0; ; from += 1000){
    const r = await build().range(from, from+999);
    if (r.error) return r;
    data = data.concat(r.data);
    if (r.data.length < 1000) return {data};
  }
}
async function loadAll(){
  const since = new Date(Date.now()-120*DAY).toISOString(), T = t => t? new Date(t).getTime() : null, hide = CFG.hiddenVenues || [];
  const [pe, ve, sh, le, ib] = await Promise.all([
    pages(()=>sb.from('hr_people').select('*').order('email')),
    sb.from('venues').select('id,name,ord').order('ord'),
    pages(()=>sb.from('hr_shifts').select('*').is('deleted_at',null).gte('clock_in',since).order('clock_in').order('id')),
    pages(()=>sb.from('hr_leave').select('*').neq('status','cancelled').order('created_at').order('id')),
    sb.from('hr_inbox').select('*').eq('recipient',S.me).order('id',{ascending:false}).limit(100)]);
  const bad = [pe,ve,sh,le,ib].find(r=>r.error); if (bad) throw bad.error;
  db = {
    venues: ve.data.filter(v=>!hide.includes(v.id)),
    people: pe.data.map(p=>({id:p.email, name:p.name||p.email, job:p.job||'', role:p.role, venues:p.venue_ids||[], active:p.active})),
    shifts: sh.data.map(s=>({id:s.id, person:s.person, venue:s.venue_id, in:T(s.clock_in), out:T(s.clock_out),
      edited: s.edited_at? {by:s.edited_by, at:T(s.edited_at), reason:s.edit_reason||'', was: s.added? null : {in:T(s.orig_in)||T(s.clock_in), out:T(s.orig_out)}} : null})),
    leave: le.data.map(l=>({id:l.id, person:l.person, type:l.type, from:l.from_date, to:l.to_date, note:l.note, status:l.status, decidedBy:l.decided_by, decidedAt:T(l.decided_at), reason:l.reason, createdAt:T(l.created_at)})),
    inbox: ib.data.map(m=>({id:m.id, to:m.recipient, kind:m.kind, text:m.body, tab:m.tab, at:T(m.created_at), read:!!m.read_at})),
    push: {}
  };
  // Admins see one list for both apps: add each person's Operations role, and the people who only use Operations.
  const mine = db.people.find(p=>p.id===S.me); S.opsOwner = false;
  if (mine && mine.active!==false && mine.role==='admin'){
    const dir = await sb.rpc('hr_directory'); if (dir.error) throw dir.error;
    const known = new Set(db.venues.map(v=>v.id));
    for (const d of dir.data){
      const p = db.people.find(x=>x.id===d.email);
      if (p) p.ops = d.ops_role || null;
      else db.people.push({id:d.email, name:d.name||d.email, job:d.job||'', role:'employee', venues:(d.venue_ids||[]).filter(v=>known.has(v)), active:false, ops:d.ops_role});
      if (d.email===S.me) S.opsOwner = d.ops_role==='owner';
    }
  }
}
async function refresh(){
  if (document.querySelector('.scrim') || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement||{}).tagName||'')) return;   // never redraw under someone typing
  try { await loadAll(); render(); } catch {}
}

/* ---------- small UI pieces ---------- */
let toastT;
function toast(t){ document.querySelector('.toast')?.remove(); const el = h('div',{class:'toast',role:'status'},t); document.body.append(el); clearTimeout(toastT); toastT = setTimeout(()=>el.remove(), 2600); }
function closeSheet(){ document.querySelector('.scrim')?.remove(); }
function sheet(title, ...body){
  closeSheet();
  const sc = h('div',{class:'scrim',onclick:e=>{ if (e.target===sc) closeSheet(); }},
    h('div',{class:'sheet',role:'dialog','aria-label':title},
      h('div',{class:'sh'}, h('h2',{},title), h('button',{class:'icon-btn','aria-label':'Close',html:I.x,onclick:closeSheet})), body));
  document.body.append(sc);
}
const seg = (key, opts) => h('div',{class:'seg',role:'tablist'}, opts.map(([k,label])=>
  h('button',{role:'tab','aria-selected':String(S.seg[key]===k),onclick:()=>{ S.seg[key]=k; render(); }},label)));
function pills(opts, cur, on){
  const el = h('div',{class:'pills'}); let val = cur;
  const draw = () => el.replaceChildren(...opts.map(([k,label])=>h('button',{class:'pill',type:'button','aria-pressed':String(Array.isArray(val)? val.includes(k) : val===k),onclick:()=>{
    if (Array.isArray(val)) val = val.includes(k)? val.filter(x=>x!==k) : [...val,k]; else val = k;
    draw(); on && on(val); }},label)));
  draw(); el.value = () => val; return el;
}
const field = (label, input) => h(/^(INPUT|SELECT|TEXTAREA)$/.test(input.tagName)? 'label' : 'div',{class:'f'}, label, input);
function armed(label, fn){
  const b = h('button',{class:'btn danger',type:'button',onclick:()=>{ if (b.classList.contains('armed')) fn(); else { b.classList.add('armed'); b.textContent = 'Tap again to '+label.toLowerCase(); } }},label);
  return b;
}
const avatar = p => h('span',{class:'av','aria-hidden':'true'},initials(p.name));
function weekNav(){
  const end = addDays(S.week,6), thisWeek = S.week===weekStart(Date.now());
  return h('div',{class:'weeknav'},
    h('button',{class:'icon-btn','aria-label':'Previous week',html:I.left,onclick:()=>{ S.week = addDays(S.week,-7); render(); }}),
    h('b',{class:'num'}, thisWeek? 'This week' : new Date(S.week).getDate()+' '+MO[new Date(S.week).getMonth()]+' – '+new Date(end).getDate()+' '+MO[new Date(end).getMonth()]),
    h('button',{class:'icon-btn','aria-label':'Next week',html:I.right,disabled:thisWeek,onclick:()=>{ S.week = addDays(S.week,7); render(); }}));
}
const inWeek = (s, ws) => s.in>=ws && s.in<addDays(ws,7);
function shiftRow(s, withName){
  const edit = canEditShift(s), p = person(s.person);
  const main = h('span',{class:'main'},
    h('b',{}, withName? p.name : fmtD(s.in)),
    h('small',{class:'num'}, (withName? fmtD(s.in)+' · ' : '')+vName(s.venue)+' · '+fmtT(s.in)+' – '+(s.out? fmtT(s.out) : 'now')),
    s.edited? h('small',{}, (s.edited.was? 'Changed by ' : 'Added by ')+person(s.edited.by).name+': '+s.edited.reason) : null);
  const end = h('span',{class:'end'}, s.out? dur(s.out-s.in) : h('span',{class:'tag on'},'On shift'), !s.out? h('small',{'data-since':s.in},dur(sdur(s))) : null);
  return edit ? h('button',{class:'row',onclick:()=>shiftSheet(s, s.person)}, main, end, h('span',{html:I.right.replace('<svg','<svg class="chev"')}))
              : h('div',{class:'row'}, main, end);
}

/* ---------- screens ---------- */
function viewClock(){
  const p = me(), s = openShift(S.me), now = Date.now(), d = new Date(now);
  if (!S.pickVenue || !p.venues.includes(S.pickVenue)) S.pickVenue = p.venues[0];
  const card = h('div',{class:'clock'+(s? ' on' : '')},
    h('div',{class:'day'}, WDL[d.getDay()]+' '+d.getDate()+' '+MOL[d.getMonth()]),
    h('div',{class:'time',id:'now-time'}, fmtT(now), h('small',{}, pad(d.getSeconds()))),
    s ? h('div',{class:'state'}, h('span',{class:'dot on'}), h('span',{}, 'At '+vName(s.venue)+' since '+fmtT(s.in)+(day0(s.in)!==day0(now)? ' ('+fmtD(s.in)+')' : '')), h('span',{class:'elapsed','data-since':s.in}, dur(now-s.in)))
      : h('div',{class:'state'}, h('span',{class:'dot'}), h('span',{class:'muted'}, p.venues.length? 'Not clocked in' : 'No venue yet. Ask your manager to add you to one.')),
    !s && p.venues.length>1 ? h('div',{class:'vpick',role:'group','aria-label':'Venue'}, p.venues.map(v=>
      h('button',{class:'vtile','aria-pressed':String(S.pickVenue===v),'aria-label':vName(v),onclick:()=>{ S.pickVenue = v; render(); }}, vLogo(v)))) : null,
    !s && p.venues.length===1 ? h('div',{class:'vtile',style:'align-self:flex-start;min-width:150px'}, vLogo(p.venues[0])) : null,
    s ? h('button',{class:'btn big out',onclick:clockOut},'Clock out')
      : h('button',{class:'btn big primary',disabled:!p.venues.length,onclick:()=>clockIn(S.pickVenue)},'Clock in'+(p.venues.length>1? ' at '+vName(S.pickVenue) : '')));
  const ws = weekStart(now), mine = db.shifts.filter(x=>x.person===S.me);
  const perDay = Array.from({length:7}, (_,i)=> mine.filter(x=>day0(x.in)===addDays(ws,i)).reduce((t,x)=>t+sdur(x),0));
  const max = Math.max(8*HOUR, ...perDay), total = perDay.reduce((a,b)=>a+b,0);
  const week = h('div',{class:'week'},
    h('div',{class:'tot'}, h('b',{},dur(total)), h('span',{class:'muted small'},'this week')),
    h('div',{class:'bars',role:'img','aria-label':'Hours per day this week'}, perDay.map((ms,i)=>
      h('div',{class:'bar'+(ms? '' : ' zero')+(addDays(ws,i)===day0(now)? ' today' : '')},
        h('span',{}, ms? (ms/HOUR).toFixed(1) : ''), h('div',{class:'track'}, h('i',{style:'height:'+Math.round(ms/max*64)+'px'})), h('span',{},'MTWTFSS'[i])))));
  const recent = mine.filter(x=>x.out).sort((a,b)=>b.in-a.in).slice(0,4);
  return [card, week, h('div',{class:'block'},
    h('div',{class:'sec-h'}, h('h2',{},'Recent shifts'), h('button',{onclick:()=>go(p.role==='manager'? 'team' : 'hours', 'mine')},'All hours')),
    h('div',{class:'list'}, recent.length? recent.map(x=>shiftRow(x,false)) : h('div',{class:'empty'},'No shifts yet.')))];
}
function hoursList(pid){
  const list = db.shifts.filter(s=>s.person===pid && inWeek(s,S.week)).sort((a,b)=>b.in-a.in);
  const total = list.reduce((t,s)=>t+sdur(s),0);
  return [weekNav(), h('div',{class:'week'}, h('div',{class:'tot'}, h('b',{},dur(total)), h('span',{class:'muted small'}, list.length+(list.length===1? ' shift' : ' shifts')))),
    h('div',{class:'list'}, list.length? list.map(s=>shiftRow(s,false)) : h('div',{class:'empty'},'No shifts this week.'))];
}
function viewHours(){
  return [h('h1',{},'My hours'), hoursList(S.me), h('p',{class:'note'},'Something wrong with a shift? Your manager can correct it, and you get a message when they do.')];
}
function viewTeam(){
  const mgr = me().role==='manager', people = team(), ids = people.map(p=>p.id), vs = myVenues();
  const scope = s => ids.includes(s.person) && vs.includes(s.venue);
  const head = [h('h1',{},'Team'), seg('team', [['now','Now'],['week','Week']].concat(mgr? [['mine','My hours']] : []))];
  if (S.seg.team==='mine' && mgr) return [...head, hoursList(S.me)];
  if (S.seg.team==='week'){
    const rows = people.map(p=>{ const list = db.shifts.filter(s=>s.person===p.id && scope(s) && inWeek(s,S.week)).sort((a,b)=>b.in-a.in);
      return {p, list, total:list.reduce((t,s)=>t+sdur(s),0)}; }).sort((a,b)=>b.total-a.total);
    return [...head, weekNav(), h('div',{class:'block'}, rows.map(({p,list,total})=>{
      const open = S.open===p.id;
      return h('div',{class:'list'},
        h('button',{class:'row','aria-expanded':String(open),onclick:()=>{ S.open = open? null : p.id; render(); }}, avatar(p),
          h('span',{class:'main'}, h('b',{},p.name), h('small',{}, p.job+' · '+p.venues.map(vName).join(', '))),
          h('span',{class:'end'}, dur(total), h('small',{}, list.length+(list.length===1? ' shift' : ' shifts')))),
        open? [list.map(s=>shiftRow(s,false)), h('button',{class:'row link',onclick:()=>shiftSheet(null,p.id)}, h('span',{html:I.plus}), 'Add a shift')] : null);
    }), people.length? null : h('div',{class:'empty'},'Nobody in your venues yet.'))];
  }
  const open = db.shifts.filter(s=>!s.out && scope(s)), stale = open.filter(s=>Date.now()-s.in > STALE);
  return [...head,
    stale.map(s=>h('div',{class:'alert'}, h('span',{html:I.warn}),
      h('div',{class:'main'}, h('b',{}, person(s.person).name+' · '+vName(s.venue)), h('small',{class:'num'}, 'Clocked in since '+fmtD(s.in)+' '+fmtT(s.in)+'. Forgot to clock out?')),
      h('button',{class:'btn sm',onclick:()=>shiftSheet(s,s.person)},'Fix'))),
    h('div',{class:'block',style:'gap:16px'}, vs.map(v=>{ const here = open.filter(s=>s.venue===v).sort((a,b)=>a.in-b.in);
      return h('div',{class:'block'}, h('div',{class:'vhead'}, vLogo(v,'sm'), h('small',{}, here.length? here.length+' in' : 'Nobody in')),
        here.length? h('div',{class:'list'}, here.map(s=>shiftRow(s,true))) : null); }))];
}
function leaveCard(r, deciding){
  const p = person(r.person), n = dayCount(r.from,r.to);
  const card = h('div',{class:'card'},
    h('div',{class:'hd'}, deciding? avatar(p) : null,
      h('div',{class:'main'}, h('b',{}, deciding? p.name : LEAVE[r.type]), h('small',{}, deciding? LEAVE[r.type]+' · '+p.venues.map(vName).join(', ') : 'Asked '+ago(r.createdAt))),
      h('span',{class:'tag '+r.status}, r.status[0].toUpperCase()+r.status.slice(1))),
    h('div',{class:'when num'}, rangeText(r.from,r.to)+' · '+n+(n===1? ' day' : ' days')),
    r.note? h('div',{class:'q'}, '“'+r.note+'”') : null,
    r.status!=='pending'? h('div',{class:'small muted'}, (r.status==='approved'? 'Approved by ' : 'Rejected by ')+person(r.decidedBy).name) : null,
    r.status==='rejected' && r.reason? h('div',{class:'reason'}, 'Reason: '+r.reason) : null);
  if (deciding && canDecide(r)){
    const why = h('textarea',{id:'why-'+r.id,placeholder:'Reason for rejecting (the employee will see it)',hidden:true});
    const err = h('div',{class:'err',hidden:true},'Write a reason so they know why.');
    const no = h('button',{class:'btn danger',onclick:()=>{
      if (why.hidden){ why.hidden = false; no.textContent = 'Confirm reject'; why.focus(); return; }
      if (!why.value.trim()){ err.hidden = false; return; }
      decide(r, false, why.value.trim()); }},'Reject');
    card.append(why, err, h('div',{class:'btns'}, no, h('button',{class:'btn primary',onclick:()=>decide(r,true)},'Approve')));
  } else if (!deciding && r.status==='pending'){
    card.append(armed('Cancel request', ()=>cancelLeave(r)));
  }
  return card;
}
function leaveSheet(){
  const type = pills(Object.entries(LEAVE), 'holiday'), t = iso(Date.now());
  const from = h('input',{type:'date',id:'lv-from',value:t,min:iso(addDays(Date.now(),-30))}), to = h('input',{type:'date',id:'lv-to',value:t});
  from.addEventListener('change',()=>{ if (to.value<from.value) to.value = from.value; });
  const note = h('textarea',{id:'lv-note',placeholder:'Note for your manager (optional)'}), err = h('div',{class:'err',hidden:true});
  const who = approversFor(me()).map(a=>a.name).join(', ');
  sheet('Request time off', type, h('div',{class:'two'}, field('First day',from), field('Last day',to)), note, err,
    h('p',{class:'small muted'}, who? 'Goes to '+who+' to approve.' : 'There is nobody set up to approve this yet.'),
    h('button',{class:'btn primary',onclick:()=>{
      if (!from.value || !to.value || to.value<from.value){ err.textContent = 'The last day must be on or after the first day.'; err.hidden = false; return; }
      closeSheet(); requestLeave({type:type.value(), from:from.value, to:to.value, note:note.value.trim()}); }},'Send request'));
}
function viewLeave(){
  const approver = me().role!=='employee', pending = toApprove(), today = iso(Date.now());
  const mine = db.leave.filter(r=>r.person===S.me).sort((a,b)=>b.createdAt-a.createdAt);
  const out = [h('h1',{},'Time off'), h('button',{class:'btn primary',onclick:leaveSheet}, h('span',{html:I.plus}), 'Request time off')];
  if (approver) out.push(seg('leave', [['mine','Mine'],['approve','To approve'+(pending.length? ' · '+pending.length : '')],['up','Who\'s off']]));
  const tab = approver? S.seg.leave : 'mine';
  if (tab==='approve') out.push(pending.length? pending.sort((a,b)=>a.createdAt-b.createdAt).map(r=>leaveCard(r,true)) : h('div',{class:'list'}, h('div',{class:'empty'},'Nothing waiting for you.')));
  else if (tab==='up'){
    const ids = me().role==='admin'? db.people.map(p=>p.id) : team().map(p=>p.id);
    const up = db.leave.filter(r=>r.status==='approved' && r.to>=today && ids.includes(r.person)).sort((a,b)=>a.from.localeCompare(b.from));
    out.push(h('div',{class:'list'}, up.length? up.map(r=>h('div',{class:'row'}, avatar(person(r.person)),
      h('span',{class:'main'}, h('b',{},person(r.person).name), h('small',{class:'num'}, LEAVE[r.type]+' · '+rangeText(r.from,r.to))),
      h('span',{class:'end'}, dayCount(r.from,r.to)+'d'))) : h('div',{class:'empty'},'No approved time off coming up.')));
  } else out.push(mine.length? mine.map(r=>leaveCard(r,false)) : h('div',{class:'list'}, h('div',{class:'empty'},'You have not asked for time off yet.')));
  return out;
}
function viewInbox(){
  const list = db.inbox.filter(m=>m.to===S.me).sort((a,b)=>b.at-a.at), on = !!db.push[S.me];
  return [h('div',{class:'sec-h'}, h('h1',{},'Inbox'), list.some(m=>!m.read)? h('button',{onclick:()=>{ markRead(list); render(); }},'Mark all read') : null),
    !DEMO? pushCard() : h('div',{class:'card'}, h('div',{class:'switch'},
      h('div',{class:'main'}, h('b',{},'Notifications on this phone'), h('small',{}, on? 'On. You get a notification for each new message here.' : 'Off. Messages still arrive here in the inbox.')),
      h('button',{class:'tog',role:'switch','aria-checked':String(on),'aria-label':'Notifications on this phone',onclick:()=>{ db.push[S.me] = !on; store.save(db); render(); }})),
      h('p',{class:'small muted'},'Demo: in the real app this switch turns on phone notifications, the same way as in Operations.')),
    h('div',{class:'list'}, list.length? list.map(m=>h('button',{class:'row msg'+(m.read? ' read' : ''),onclick:()=>{ markRead([m]); go(tabs().some(t=>t[0]===m.tab)? m.tab : (m.tab==='hours'? 'team' : 'inbox'), m.tab==='hours'? 'mine' : (m.kind==='leave'? 'approve' : m.kind==='decision'? 'mine' : null)); }},
      h('span',{class:'un'}), h('span',{class:'main'}, h('b',{},m.text), h('small',{},ago(m.at))))) : h('div',{class:'empty'},'Nothing yet. Requests, decisions and shift changes show up here.'))];
}
/* export */
function exportRange(){
  const now = Date.now(), d = new Date(now), k = S.exp.range;
  if (k==='thisWeek') return [weekStart(now), addDays(weekStart(now),7)];
  if (k==='lastWeek') return [addDays(weekStart(now),-7), weekStart(now)];
  if (k==='thisMonth') return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), new Date(d.getFullYear(), d.getMonth()+1, 1).getTime()];
  return [new Date(d.getFullYear(), d.getMonth()-1, 1).getTime(), new Date(d.getFullYear(), d.getMonth(), 1).getTime()];
}
function exportData(){
  const [a,b] = exportRange();
  const all = db.shifts.filter(s=>s.in>=a && s.in<b && (S.exp.venue==='all' || s.venue===S.exp.venue));
  const done = all.filter(s=>s.out).sort((x,y)=>x.in-y.in);
  let head, rows;
  if (S.exp.format==='shifts'){
    head = ['date','venue','employee','job','clock_in','clock_out','hours','corrected'];
    rows = done.map(s=>[iso(s.in), vName(s.venue), person(s.person).name, person(s.person).job, fmtT(s.in), fmtT(s.out), hrs(s.out-s.in), s.edited? 'yes' : 'no']);
  } else {
    head = ['date','venue','employee','hours'];
    const m = new Map();
    for (const s of done){ const key = iso(s.in)+'|'+s.venue+'|'+s.person; m.set(key, (m.get(key)||0)+(s.out-s.in)); }
    rows = [...m].map(([key,ms])=>{ const [dt,v,p] = key.split('|'); return [dt, vName(v), person(p).name, hrs(ms)]; });
  }
  const esc = c => /[",\n]/.test(c)? '"'+String(c).replace(/"/g,'""')+'"' : c;
  return {head, rows, csv:[head, ...rows].map(r=>r.map(esc).join(',')).join('\n'), a, b,
    hours:done.reduce((t,s)=>t+(s.out-s.in),0), people:new Set(done.map(s=>s.person)).size, shifts:done.length, open:all.length-done.length};
}
async function saveFile(name, text){
  if (window.claude && window.claude.use){
    try { const dl = await window.claude.use('downloads'); if (!dl){ toast('Saving a file is not available here. Use Copy.'); return; }
      await dl.save({filename:name, data:text}); toast('File saved'); }
    catch (e){ if (!e || e.code!=='declined') toast('Could not save the file. Use Copy instead.'); }
    return;
  }
  try {                                                         // on a phone, hand the file to the share sheet (Files, Mail, AirDrop)
    const f = new File([text], name, {type:'text/csv'});
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({files:[f]})){ await navigator.share({files:[f]}); return; }
  } catch (e){ if (e && e.name==='AbortError') return; }
  const a = h('a',{href:URL.createObjectURL(new Blob([text],{type:'text/csv'})),download:name}); document.body.append(a); a.click(); a.remove();
}
function copyText(text){
  const fallback = () => sheet('Copy the export', h('p',{class:'small muted'},'Select everything in the box and copy it.'), h('textarea',{id:'csv-out',readonly:true,style:'min-height:220px;font-size:12px',value:text}));
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(()=>toast('Copied'), fallback); else fallback();
}
function personSheet(p){
  const self = p && p.id===S.me, hasHr = !p || p.active!==false;
  const email = h('input',{id:'pp-email',type:'email',autocomplete:'off',placeholder:'name@example.com'});
  const name = h('input',{id:'pp-name',value:p? p.name : '',placeholder:'Full name'}), job = h('input',{id:'pp-job',value:p? p.job : '',placeholder:'Job, for example Bartender'});
  const venues = pills(V().map(v=>[v.id,v.name]), p? [...p.venues] : []);
  const role = pills([['none','No access']].concat(Object.entries(ROLES)), p? (hasHr? p.role : 'none') : 'employee');
  const ops = pills([['none','No access']].concat(Object.entries(OPS)), (p && p.ops) || 'none'), err = h('div',{class:'err',hidden:true});
  sheet(p? 'Edit person' : 'Add person',
    DEMO? null : p? h('p',{class:'small muted'},p.id) : field('Email they sign in with',email),
    field('Name',name), field('Job',job),
    self? null : field(DEMO? 'Role' : 'This app (Team)',role),
    DEMO? null : S.opsOwner && !self? field('Operations app',ops)
      : h('p',{class:'small muted'}, 'Operations app: '+(p && p.ops? OPS[p.ops] : 'no access')+(self? '' : '. Only an Operations owner can change this.')),
    field('Works at',venues), err,
    h('p',{class:'small muted'},'Employees clock in and ask for time off. Managers also correct hours and approve time off for their venues. Admins see everything.'
      +(DEMO || p? '' : ' One login works in both apps: their Operations password if they have one, otherwise they tap Create account.')),
    p && !self? h('details',{class:'fold'}, h('summary',{},'Disable or delete'),
      hasHr || p.ops? h('p',{class:'small muted'},'Disable: '+p.name.split(' ')[0]+' can no longer open '+(DEMO || !p.ops? 'the app' : S.opsOwner? 'either app' : 'this app (Operations access stays; only an Operations owner can remove it)')+'. Hours and time off are kept, and you can switch them back on later.') : null,
      h('p',{class:'small muted'},'Delete: removes the person and their login for good, with all their recorded hours and time off requests. This cannot be undone.'),
      h('div',{class:'btns'},
        hasHr || p.ops? armed('Disable', ()=>{ closeSheet(); disablePerson(p); }) : null,
        armed('Delete for good', ()=>{ closeSheet(); deletePerson(p); }))) : null,
    h('div',{class:'btns'},
      h('button',{class:'btn primary',onclick:()=>{
        const em = p? p.id : email.value.trim().toLowerCase();
        if (!DEMO && !p && !/^\S+@\S+\.\S+$/.test(em)){ err.textContent = 'Add their email address.'; err.hidden = false; return; }
        if (!name.value.trim()){ err.textContent = 'Add a name.'; err.hidden = false; return; }
        const v = {email:em, name:name.value.trim(), job:job.value.trim(), role: self? p.role : role.value(), ops: DEMO? undefined : ops.value(), venues:venues.value()};
        if (!DEMO && v.role==='none' && v.ops==='none' && !p){ err.textContent = 'Give them access to at least one app.'; err.hidden = false; return; }
        closeSheet(); savePerson(p, v); }},'Save')));
}
const byRole = (a,b) => Object.keys(ROLES).indexOf(b.role)-Object.keys(ROLES).indexOf(a.role) || a.name.localeCompare(b.name);
const personRow = p => h('button',{class:'row',onclick:()=>personSheet(p)}, avatar(p),
  h('span',{class:'main'}, h('b',{},p.name), h('small',{}, (p.job? p.job+' · ' : '')+(p.role==='admin' && p.active!==false? 'All venues' : p.venues.map(vName).join(', ')||'No venue'))),
  h('span',{class:'end'}, h('span',{class:'tag'}, p.active===false? (p.ops? 'Not in Team' : 'Disabled') : ROLES[p.role]), p.ops? h('span',{class:'tag'},'Operations · '+OPS[p.ops]) : null));
function viewAdmin(){
  const off = db.people.filter(p=>p.active===false && !p.ops);
  const x = exportData(), E = S.exp;
  const set = (k,v) => { E[k] = v; render(); };
  const file = 'northpoint-hours-'+iso(x.a)+'-to-'+iso(addDays(x.b,-1))+'.csv';
  return [h('h1',{},'Admin'),
    h('div',{class:'block'}, h('div',{class:'sec-h'}, h('h2',{},'Export hours')),
      h('div',{class:'card'},
        pills([['thisWeek','This week'],['lastWeek','Last week'],['thisMonth','This month'],['lastMonth','Last month']], E.range, v=>set('range',v)),
        field('Venue', h('select',{id:'ex-venue',value:E.venue,onchange:e=>set('venue',e.target.value)}, h('option',{value:'all'},'All venues'), V().map(v=>h('option',{value:v.id},v.name)))),
        h('div',{class:'seg'}, [['shifts','Every shift'],['daily','Totals per day']].map(([k,l])=>h('button',{'aria-selected':String(E.format===k),onclick:()=>set('format',k)},l))),
        h('div',{class:'when num'}, hrs(x.hours)+' hours · '+x.shifts+' shifts · '+x.people+' people'),
        h('div',{class:'small muted num'}, fmtD(x.a)+' – '+fmtD(addDays(x.b,-1))+(x.open? '. '+x.open+' shift'+(x.open>1? 's' : '')+' still open, left out.' : '.')),
        x.rows.length? h('div',{class:'tablewrap'}, h('table',{}, h('thead',{}, h('tr',{}, x.head.map(c=>h('th',{},c)))),
          h('tbody',{}, x.rows.slice(0,4).map(r=>h('tr',{}, r.map(c=>h('td',{},c))))))) : h('div',{class:'empty'},'No finished shifts in this period.'),
        h('div',{class:'btns'}, h('button',{class:'btn',disabled:!x.rows.length,onclick:()=>copyText(x.csv)}, h('span',{html:I.copy}),'Copy'),
          h('button',{class:'btn primary',disabled:!x.rows.length,onclick:()=>saveFile(file, x.csv)}, h('span',{html:I.down}),'Download')))),
    h('div',{class:'block'}, h('div',{class:'sec-h'}, h('h2',{},'Tips dashboard')),
      h('div',{class:'card'}, h('div',{class:'hd'}, h('div',{class:'main'}, h('b',{},'Not connected yet')), h('span',{class:'tag pending'},'Manual')),
        h('p',{class:'q'},'For now, download the hours above and import the file into the tips dashboard. Once we know what the dashboard accepts, this can send the hours across on its own.'))),
    h('div',{class:'block'}, h('div',{class:'sec-h'}, h('h2',{},'People'), h('button',{onclick:()=>personSheet(null)},'Add person')),
      h('div',{class:'list'}, db.people.filter(p=>p.active!==false || p.ops).sort(byRole).map(personRow)),
      off.length? h('details',{class:'fold'}, h('summary',{},'Disabled · '+off.length), h('div',{class:'list'}, off.sort(byRole).map(personRow))) : null),
    DEMO? h('button',{class:'btn',onclick:()=>{ db = seed(); store.save(db); S.me = 'p1'; toast('Demo data reset'); render(); }},'Reset the demo data') : null];
}
function shiftSheet(s, pid){
  const p = person(pid), base = s? s.in : Date.now()-8*HOUR;
  const vs = me().role==='admin'? V().map(v=>v.id) : me().venues.filter(v=>p.venues.includes(v) || (s && s.venue===v));
  const venue = h('select',{id:'sh-venue',value:s? s.venue : vs[0]}, vs.map(v=>h('option',{value:v},vName(v))));
  const date = h('input',{type:'date',id:'sh-date',value:iso(base)}), tin = h('input',{type:'time',id:'sh-in',value:fmtT(base)});
  const tout = h('input',{type:'time',id:'sh-out',value:s? (s.out? fmtT(s.out) : '') : fmtT(Date.now())});
  const reason = h('input',{id:'sh-reason',placeholder:'For example: forgot to clock out'}), err = h('div',{class:'err',hidden:true});
  const hint = h('p',{class:'small muted num'});
  const read = () => { if (!date.value || !tin.value) return null;
    const a = fromIso(date.value) + Number(tin.value.slice(0,2))*HOUR + Number(tin.value.slice(3))*6e4;
    let b = tout.value? fromIso(date.value) + Number(tout.value.slice(0,2))*HOUR + Number(tout.value.slice(3))*6e4 : null;
    if (b!=null && b<=a) b = addDays(b,1);                      // past midnight: the shift ends the next day
    return {person:pid, venue:venue.value, in:a, out:b}; };
  const upd = () => { const v = read(); hint.textContent = !v? '' : v.out==null? 'No clock-out time: the shift stays open.' : dur(v.out-v.in)+(day0(v.out)!==day0(v.in)? ', ends the next day' : ''); };
  [date,tin,tout].forEach(i=>i.addEventListener('input',upd)); upd();
  const need = () => { if (!reason.value.trim()){ err.textContent = 'Add a short reason. '+p.name.split(' ')[0]+' will see it.'; err.hidden = false; return false; } return true; };
  sheet((s? 'Correct shift' : 'Add a shift')+' · '+p.name, field('Venue',venue), field('Date',date),
    h('div',{class:'two'}, field('Clock in',tin), field('Clock out',tout)), hint, field('Reason',reason), err,
    s && s.edited && s.edited.was? h('p',{class:'small muted num'}, 'First recorded as '+fmtT(s.edited.was.in)+' – '+(s.edited.was.out? fmtT(s.edited.was.out) : 'no clock-out')+'.') : null,
    h('div',{class:'btns'},
      s? armed('Remove shift', ()=>{ if (need()){ closeSheet(); deleteShift(s, reason.value.trim()); } }) : null,
      h('button',{class:'btn primary',onclick:()=>{ const v = read();
        if (!v){ err.textContent = 'Fill in the date and the clock-in time.'; err.hidden = false; return; }
        if (v.in>Date.now() || (v.out && v.out>Date.now()+6e4)){ err.textContent = 'A shift cannot be in the future.'; err.hidden = false; return; }
        if (v.out && v.out-v.in>20*HOUR){ err.textContent = 'That is more than 20 hours. Check the times.'; err.hidden = false; return; }
        if (!need()) return;
        closeSheet(); saveShift(s, v, reason.value.trim()); }},'Save')));
}
function whoSheet(){
  sheet('View the demo as', h('p',{class:'small muted'},'Everyone here except Mili is an example person. Switch to see what each role can do.'),
    Object.keys(ROLES).reverse().map(r=>h('div',{class:'block'}, h('div',{class:'small muted'},ROLES[r]+(r==='admin'? '' : 's')),
      h('div',{class:'list'}, db.people.filter(p=>p.role===r).map(p=>h('button',{class:'row',onclick:()=>{ S.me = p.id; S.tab = null; S.open = null; try { localStorage.setItem(KEY+'-me', p.id); } catch {} closeSheet(); render(); }},
        avatar(p), h('span',{class:'main'}, h('b',{},p.name), h('small',{}, p.job+(r==='admin'? '' : ' · '+p.venues.map(vName).join(', ')))), p.id===S.me? h('span',{class:'tag approved'},'You') : null))))));
}

function accountSheet(){
  const p = me();
  sheet('Your account', h('div',{class:'card'}, h('div',{class:'hd'}, avatar(p), h('div',{class:'main'}, h('b',{},p.name), h('small',{},S.me)), h('span',{class:'tag'},ROLES[p.role])),
      p.role==='admin'? null : h('div',{class:'q'}, p.venues.length? 'Works at '+p.venues.map(vName).join(', ') : 'No venue yet')),
    h('button',{class:'btn danger',onclick:async()=>{ closeSheet(); S.ready = false; if (S.push) await pushOff().catch(()=>{}); S.push = false; await sb.auth.signOut(); authScreen('signin'); }},'Sign out'));
}

/* ---------- shell ---------- */
const tabs = () => me().role==='admin' ? [['team','Team',I.team],['leave','Time off',I.leave],['inbox','Inbox',I.bell],['admin','Admin',I.admin]]
  : me().role==='manager' ? [['clock','Clock',I.clock],['team','Team',I.team],['leave','Time off',I.leave],['inbox','Inbox',I.bell]]
  : [['clock','Clock',I.clock],['hours','Hours',I.hours],['leave','Time off',I.leave],['inbox','Inbox',I.bell]];
function go(tab, sub){ S.tab = tab; if (sub && S.seg[tab]!==undefined) S.seg[tab] = sub; window.scrollTo(0,0); render(); }
function theme(){
  const root = document.documentElement, cur = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches? 'light' : 'dark');
  const next = cur==='dark'? 'light' : 'dark'; root.setAttribute('data-theme', next); try { localStorage.setItem(KEY+'-theme', next); } catch {} render();
}
function render(){
  if (!S.ready) return;
  const app = document.getElementById('app'), t = tabs(), p = me();
  if (!t.some(x=>x[0]===S.tab)) S.tab = t[0][0];
  const light = (document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: light)').matches? 'light' : 'dark'))==='light';
  const view = {clock:viewClock, hours:viewHours, team:viewTeam, leave:viewLeave, inbox:viewInbox, admin:viewAdmin}[S.tab]();
  const badge = {inbox:unread(), leave:p.role==='employee'? 0 : toApprove().length};
  app.replaceChildren(
    h('div',{class:'wrap'},
      h('div',{class:'top'}, h('img',{class:'brand',src:logoSrc('v8'),alt:'Northpoint'}), DEMO? h('span',{class:'demo'},'Demo') : null, h('span',{class:'sp'}),
        h('button',{class:'icon-btn','aria-label':light? 'Switch to dark' : 'Switch to light',html:light? I.moon : I.sun,onclick:theme}),
        h('button',{class:'who','aria-label':DEMO? 'Switch person' : 'Your account',onclick:DEMO? whoSheet : accountSheet}, avatar(p), h('span',{class:'n'}, h('b',{},p.name.split(' ')[0]), h('small',{},ROLES[p.role])))),
      view),
    h('nav',{class:'nav','aria-label':'Sections'}, h('div',{class:'in'}, t.map(([k,label,icon])=>
      h('button',{'aria-current':S.tab===k? 'page' : null,onclick:()=>go(k)}, h('span',{html:icon}), label, badge[k]? h('span',{class:'badge'},badge[k]) : null)))));
}
setInterval(()=>{
  const now = Date.now(), el = document.getElementById('now-time');
  if (el){ el.firstChild.nodeValue = fmtT(now); el.lastChild.textContent = pad(new Date(now).getSeconds()); }
  document.querySelectorAll('[data-since]').forEach(e=>{ e.textContent = dur(now-Number(e.dataset.since)); });
}, 1000);

{ let th = 'dark'; try { th = localStorage.getItem(KEY+'-theme') || th; } catch {} document.documentElement.setAttribute('data-theme', th); }   // dark unless this phone chose light

/* ---------- phone notifications (real app only): time off requests and decisions ---------- */
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
const pushOK = () => !DEMO && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!CFG.vapidPublicKey;
const keyBytes = k => Uint8Array.from(atob((k+'='.repeat((4-k.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
async function registerPhone(sub){
  const j = sub.toJSON();
  const {error} = await sb.rpc('hr_save_push',{p_endpoint:j.endpoint, p_p256dh:j.keys.p256dh, p_auth:j.keys.auth, p_user_agent:navigator.userAgent});
  if (error) throw error;
}
async function pushOn(){
  if (await Notification.requestPermission()!=='granted'){ toast('Notifications are blocked for this app in the phone settings.'); return false; }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:keyBytes(CFG.vapidPublicKey)});
  await registerPhone(sub); return true;
}
async function pushOff(){
  const reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription();
  if (sub){ await sb.rpc('hr_remove_push',{p_endpoint:sub.endpoint}); await sub.unsubscribe(); }
}
async function checkPush(){                                     // on opening: if this phone is switched on, make sure the database still knows it
  if (!pushOK()) return;
  try {
    const reg = await navigator.serviceWorker.ready, sub = Notification.permission==='granted'? await reg.pushManager.getSubscription() : null;
    S.push = !!sub; if (sub) await registerPhone(sub);
    if (S.ready && S.tab==='inbox') render();
  } catch {}
}
async function togglePush(){
  try { if (S.push){ await pushOff(); S.push = false; } else { S.push = await pushOn(); if (S.push) toast('Notifications are on'); } }
  catch (e){ toast('Could not change notifications. '+((e && e.message) || 'Try again.')); }
  render();
}
function pushCard(){
  if (!pushOK()) return null;
  const blocked = isIOS && !installed();
  const what = me().role==='employee'? 'when your time off is approved or rejected' : 'when someone asks for time off, and when yours is approved or rejected';
  return h('div',{class:'card'}, h('div',{class:'switch'},
    h('div',{class:'main'}, h('b',{},'Notifications on this phone'),
      h('small',{}, blocked? 'On iPhone, first add this app to your home screen (Share, then Add to Home Screen) and open it from there.' : (S.push? 'On. You get one ' : 'Off. Switch on to get one ')+what+'.')),
    h('button',{class:'tog',role:'switch','aria-checked':String(!!S.push),'aria-label':'Notifications on this phone',disabled:blocked,onclick:togglePush})));
}
function fromHash(){                                            // a tapped notification opens the app at #leave
  const k = location.hash.slice(1); if (!k) return;
  history.replaceState(null,'',location.pathname+location.search);
  if (!tabs().some(t=>t[0]===k)) return;
  S.tab = k; if (k==='leave' && me().role!=='employee') S.seg.leave = toApprove().length? 'approve' : 'mine';
}

/* ---------- sign-in (real app only) ---------- */
const root = () => document.getElementById('app');
function authScreen(mode, note){
  S.ready = false;
  const email = h('input',{id:'email',type:'email',autocomplete:'email',placeholder:'Email','aria-label':'Email'});
  const pass = h('input',{id:'password',type:'password',autocomplete:mode==='signup'? 'new-password' : 'current-password',placeholder:'Password','aria-label':'Password'});
  const msg = h('p',{class:'small muted',style:'min-height:1.4em'}, note||'');
  const label = mode==='signup'? 'Create account' : mode==='reset'? 'Send reset link' : 'Sign in';
  const submit = h('button',{type:'submit',class:'btn primary big'},label);
  const busy = on => { submit.disabled = on; submit.textContent = on? 'One moment…' : label; };
  const here = location.origin+location.pathname;
  root().replaceChildren(h('form',{class:'auth',onsubmit:async e=>{
    e.preventDefault(); busy(true);
    const em = email.value.trim().toLowerCase(); let error;
    if (mode==='signin') ({error} = await sb.auth.signInWithPassword({email:em, password:pass.value}));
    else if (mode==='signup'){
      const r = await sb.auth.signUp({email:em, password:pass.value, options:{emailRedirectTo:here}}); error = r.error;
      if (!error && !r.data.session){ busy(false); msg.textContent = 'Check your email to confirm, then sign in here.'; return; }
    } else {
      ({error} = await sb.auth.resetPasswordForEmail(em, {redirectTo:here}));
      if (!error){ busy(false); msg.textContent = 'Reset link sent. Open it on this phone.'; return; }
    }
    busy(false);
    if (error) msg.textContent = /invalid login/i.test(error.message)? 'Wrong email or password.' : error.message;
  }},
    h('img',{class:'brand',style:'height:64px;align-self:center',src:logoSrc('v8'),alt:'Northpoint'}),
    h('h1',{style:'text-align:center'},'Team'),
    h('p',{class:'small muted',style:'text-align:center'}, mode==='signin'? 'Same email and password as Operations, if you have one.' : mode==='signup'? 'Use the email your manager added for you.' : 'We send a link to set a new password.'),
    email, mode==='reset'? null : pass, submit, msg,
    h('div',{class:'btns',style:'justify-content:center'},
      mode!=='signin'? h('button',{type:'button',class:'link',onclick:()=>authScreen('signin')},'Sign in') : h('button',{type:'button',class:'link',onclick:()=>authScreen('signup')},'Create account'),
      mode!=='reset'? h('button',{type:'button',class:'link',style:'color:var(--muted)',onclick:()=>authScreen('reset')},'Forgot password') : null)));
}
function newPasswordScreen(){
  S.ready = false;
  const pass = h('input',{id:'new-password',type:'password',autocomplete:'new-password',placeholder:'New password','aria-label':'New password'}), msg = h('p',{class:'err'});
  root().replaceChildren(h('form',{class:'auth',onsubmit:async e=>{
    e.preventDefault();
    const {error} = await sb.auth.updateUser({password:pass.value});
    if (error) msg.textContent = error.message; else { toast('Password changed'); start(); }
  }}, h('h1',{},'New password'), pass, h('button',{type:'submit',class:'btn primary big'},'Save'), msg));
}
function plainScreen(title, text, again){
  S.ready = false;
  root().replaceChildren(h('div',{class:'auth'}, h('h1',{},title), h('p',{class:'muted'},text),
    h('button',{class:'btn',onclick:start},'Try again'), again? h('button',{class:'link',style:'align-self:center',onclick:async()=>{ await sb.auth.signOut(); authScreen('signin'); }},'Sign out') : null));
}
async function start(){
  const {data:{session}} = await sb.auth.getSession();
  if (!session){ authScreen('signin'); return; }
  S.me = (session.user.email||'').toLowerCase();
  try { await loadAll(); } catch { plainScreen('No connection', 'Open the app again when you have signal.'); return; }
  const p = db.people.find(x=>x.id===S.me);
  if (!p || p.active===false){ plainScreen('Almost there', 'This account ('+S.me+') is not on the team yet. Ask your manager to add this email, then try again.', true); return; }
  S.ready = true; fromHash(); render(); checkPush();
}

if (DEMO){
  const q = new URLSearchParams(location.search);               // local testing only: ?demo&as=p2&tab=team&seg=week&theme=light
  if (q.get('as') && db.people.some(p=>p.id===q.get('as'))) S.me = q.get('as');
  if (q.get('tab')) S.tab = q.get('tab');
  if (q.get('seg') && S.seg[S.tab]!==undefined) S.seg[S.tab] = q.get('seg');
  if (q.get('open')) S.open = q.get('open');
  if (q.get('theme')) document.documentElement.setAttribute('data-theme', q.get('theme'));
  S.ready = true; render();
} else {
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
  sb.auth.onAuthStateChange(ev=>{                                // deferred: awaiting Supabase calls inside this callback can stall the client
    if (ev==='PASSWORD_RECOVERY') setTimeout(newPasswordScreen,0);
    else if (ev==='SIGNED_IN' && !S.ready) setTimeout(start,0);
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  addEventListener('hashchange', async()=>{ if (!S.ready || location.hash.length<2) return; closeSheet(); try { await loadAll(); } catch {} fromHash(); render(); });
  document.addEventListener('visibilitychange',()=>{ if (!document.hidden && S.ready) refresh(); });
  setInterval(()=>{ if (!document.hidden && S.ready) refresh(); }, 60000);
  start();
}
})();
