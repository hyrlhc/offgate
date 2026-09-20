// Kapinin flash'indan servis edilen sayfalar. Internet yok; disaridan
// hicbir kaynak cekilmez, CDN yoktur, her sey bu dosyanin icinde.

#pragma once
#include <Arduino.h>

// --- Odeme sayfasi ---------------------------------------------------------
// Kullanici bileti BIR KEZ yapistirir; sonraki gecisler tek dokunus.
// Bu sayfa hic kripto yapmaz — fisler zaten online iken imzalandi (karar K-2).

static const char PAGE_PAY[] PROGMEM = R"HTML(<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>OffGate Kapi</title><style>
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#e6edf3;font:16px/1.5 -apple-system,system-ui,sans-serif;
 padding:env(safe-area-inset-top) 16px env(safe-area-inset-bottom)}
.w{max-width:440px;margin:0 auto;padding:22px 0 40px}
h1{font-size:20px;margin:0 0 2px}
.sub{color:#8b95a5;font-size:13px;margin:0 0 20px}
.card{background:#161b22;border:1px solid #2b3440;border-radius:14px;padding:18px;margin-bottom:14px}
textarea{width:100%;height:110px;background:#0d1117;color:#8b95a5;border:1px solid #2b3440;
 border-radius:10px;padding:10px;font:11px/1.35 ui-monospace,Menlo,monospace;word-break:break-all}
button{width:100%;font:inherit;border-radius:12px;border:1px solid #2b3440;background:#1c2430;
 color:#e6edf3;padding:14px;cursor:pointer}
button.go{background:#1f6f33;border-color:#3fb950;color:#fff;font-size:26px;font-weight:700;padding:30px}
button.go:disabled{opacity:.4}
.res{border-radius:12px;padding:18px;text-align:center;font-size:19px;font-weight:600;margin-bottom:14px}
.ok{background:#12261a;border:1px solid #3fb950;color:#3fb950}
.no{background:#2a1215;border:1px solid #f85149;color:#ff7b72}
.kv{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:13px;color:#8b95a5}
.kv b{color:#e6edf3;font-weight:600;text-align:right}
.mut{color:#8b95a5;font-size:12px;margin-top:10px}
</style></head><body><div class="w">
<h1>OffGate</h1><p class="sub">Kapi <b id="gate">-</b> &middot; internet yok</p>
<div id="res"></div>
<div class="card" id="ticket" hidden>
  <div class="kv">
    <span>Kalan gecis</span><b id="left">-</b>
    <span>Gecis ucreti</span><b id="fare">-</b>
    <span>Bilet</span><b id="eh">-</b>
  </div>
</div>
<button class="go" id="go" hidden>GEC</button>
<div class="card" id="paste">
  <b>Bileti yapistir</b>
  <p class="mut">Telefonunda "Kapiya Git" ile kopyaladigin metni buraya yapistir. Bir kez yeter.</p>
  <textarea id="inp" placeholder="offgate bileti..."></textarea>
  <button id="load" style="margin-top:10px">Bileti yukle</button>
</div>
<div class="card" id="carrybox" hidden>
  <b>Yaninda goturecegin veri</b>
  <p class="mut">Bu kapinin imzaladigi <b id="cn">0</b> gecis kaydi. Internete
  cikinca uygulamaya yapistir: <b>para ustun</b> ve <b>hizmet bedelinin %80'i</b>
  cuzdanina geri doner. Kapinin verisini zincire tasidigin icin.</p>
  <textarea id="carry" readonly></textarea>
  <button id="copy" style="margin-top:10px">Kopyala</button>
</div>
<button id="forget" style="margin-top:6px;background:transparent">Bileti unut</button>
<script>
var K='offgate.bundle', C='offgate.carry', B=null;
function $(i){return document.getElementById(i)}
function show(msg,ok){$('res').innerHTML='<div class="res '+(ok?'ok':'no')+'">'+msg+'</div>'}
function fmt(k){return (k/100).toLocaleString('tr-TR',{minimumFractionDigits:2})+' TL'}
/** Kapinin imzaladigi belgeyi sakla — kullanici bunu zincire tasiyacak. */
function keep(rec){
  var a=[];try{a=JSON.parse(localStorage.getItem(C))||[]}catch(e){}
  for(var i=0;i<a.length;i++)if(a[i].ent_hash==rec.ent_hash&&a[i].seq==rec.seq)return;
  a.push(rec);
  try{localStorage.setItem(C,JSON.stringify(a))}catch(e){}
  renderCarry();
}
function renderCarry(){
  var a=[];try{a=JSON.parse(localStorage.getItem(C))||[]}catch(e){}
  if(!a.length){$('carrybox').hidden=true;return}
  $('carrybox').hidden=false;$('cn').textContent=a.length;
  var s=btoa(unescape(encodeURIComponent(JSON.stringify({v:1,receipts:a}))));
  $('carry').value=s.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function render(){
  renderCarry();
  if(!B){$('paste').hidden=false;$('go').hidden=true;$('ticket').hidden=true;$('forget').hidden=true;return}
  $('paste').hidden=true;$('go').hidden=false;$('ticket').hidden=false;$('forget').hidden=false;
  $('gate').textContent=B.gate;$('fare').textContent=fmt(B.fare_try);
  $('eh').textContent=B.ent_hash.slice(0,8)+'...';
  var used=B.used||0;$('left').textContent=(B.max_uses-used)+' / '+B.max_uses;
  $('go').disabled=used>=B.max_uses;
  if(used>=B.max_uses)$('go').textContent='HAK BITTI';
}
function load(text){
  try{
    var s=text.trim().replace(/-/g,'+').replace(/_/g,'/');
    while(s.length%4)s+='=';
    var o=JSON.parse(decodeURIComponent(escape(atob(s))));
    if(!o.receipts||!o.ent_hash)throw 0;
    o.used=0;B=o;localStorage.setItem(K,JSON.stringify(B));render();show('Bilet yuklendi',1);
  }catch(e){show('Bilet okunamadi',0)}
}
$('load').onclick=function(){load($('inp').value)};
$('forget').onclick=function(){localStorage.removeItem(K);B=null;render();$('res').innerHTML=''};
$('copy').onclick=function(){
  var t=$('carry');t.select();t.setSelectionRange(0,99999);
  try{document.execCommand('copy');show('Veri kopyalandi &mdash; internete cikinca uygulamaya yapistir',1)}
  catch(e){show('Metni elle secip kopyala',0)}
};
$('go').onclick=function(){
  var used=B.used||0, r=B.receipts[used];
  if(!r){show('Hak bitti',0);return}
  $('go').disabled=true;$('go').textContent='DOGRULANIYOR...';
  fetch('/pay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    ent:{user_raw:B.user_raw,device_pk:B.device_pk,event:B.event,gate:B.gate,
         fare_try:B.fare_try,rate:B.rate,max_uses:B.max_uses,expires:B.expires},
    operator_sig:B.operator_sig,
    receipt:{ent_hash:r.ent_hash,user:B.user,seq:r.seq,fare_try:Number(r.fare_try),ts:r.ts,sig:r.sig}
  })}).then(function(x){return x.json()}).then(function(j){
    $('go').textContent='GEC';
    if(j.ok){
      B.used=r.seq;localStorage.setItem(K,JSON.stringify(B));
      // Kapinin imzaladigi tahsilat belgesini yanimiza aliyoruz.
      if(j.receipt)keep(j.receipt);
      var m='GECEBILIRSIN';
      if(j.change_try>0)m+=' &middot; ucret '+fmt(j.charged_try)+', para ustu '+fmt(j.change_try);
      show(m,1);
    }
    else{show(j.message||'REDDEDILDI',0); if(j.reason=='already_spent'&&B.used<r.seq){B.used=r.seq;localStorage.setItem(K,JSON.stringify(B))}}
    render();
  }).catch(function(){$('go').textContent='GEC';$('go').disabled=false;show('Kapiya ulasilamadi',0)});
};
try{var v=localStorage.getItem(K);if(v)B=JSON.parse(v)}catch(e){}
render();
</script></div></body></html>)HTML";

// --- Turnike ekrani --------------------------------------------------------
// Odunc telefonda acik durur, saniyede bir yenilenir.

static const char PAGE_SCREEN[] PROGMEM = R"HTML(<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="1">
<title>Kapi Ekrani</title><style>
body{margin:0;background:#0d1117;color:#e6edf3;font:16px -apple-system,system-ui,sans-serif;
 height:100vh;display:grid;place-items:center;text-align:center}
.gate{color:#8b95a5;font-size:14px;letter-spacing:3px;text-transform:uppercase}
.big{font-size:88px;font-weight:800;line-height:1;margin:6px 0 2px;font-variant-numeric:tabular-nums}
.lbl{color:#8b95a5;font-size:13px}
.st{margin-top:26px;font-size:30px;font-weight:700;padding:14px 34px;border-radius:14px;display:inline-block}
.ok{background:#12261a;border:2px solid #3fb950;color:#3fb950}
.no{background:#2a1215;border:2px solid #f85149;color:#ff7b72}
.idle{color:#8b95a5;border:2px solid #2b3440}
.det{color:#8b95a5;font-size:12px;margin-top:12px;font-family:ui-monospace,Menlo,monospace}
.mesh{margin-top:22px;color:#58a6ff;font-size:12px;font-family:ui-monospace,Menlo,monospace}
.mesh b{color:#e6edf3;font-weight:600}
</style></head><body><div>
<div class="gate">%GATE%</div>
<div class="big">%COUNT%</div>
<div class="lbl">gecis</div>
<div class="st %CLS%">%STATUS%</div>
<div class="det">%DETAIL%</div>
<div class="mesh">%MESH%</div>
</div></body></html>)HTML";
