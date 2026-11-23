// Runs inside the Android app. CapacitorHttp makes fetch() go through native HTTP, so there is no CORS limit.
const CG='https://api.coingecko.com/api/v3',YF='https://query1.finance.yahoo.com';
const J=async(u,o)=>{const r=await fetch(u,o);return r.json()};
const YJ=u=>J(u,{headers:{'User-Agent':'Mozilla/5.0'}});
const SP=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.SecureStoragePlugin;
const sec={
  async set(k,v){try{SP?await SP.set({key:k,value:v}):localStorage.setItem('s_'+k,v)}catch(e){}},
  async get(k){try{return SP?(await SP.get({key:k})).value:localStorage.getItem('s_'+k)}catch(e){return null}}
};
let pick=null,RES=[],tm;
const msg=t=>{window.ST=t;const e=$('st');if(e)e.textContent=t};
const run=async f=>{msg('Working…');try{await f();msg('Updated '+new Date().toLocaleTimeString())}catch(e){msg('Error: '+e.message)}};

/* ---------- search + prices ---------- */
function sq(v){clearTimeout(tm);tm=setTimeout(()=>doSearch(v.trim()),350)}
async function doSearch(q){
  if(q.length<2){$('sr').innerHTML='';return}
  const [c,y]=await Promise.allSettled([J(CG+'/search?query='+encodeURIComponent(q)),YJ(YF+'/v1/finance/search?q='+encodeURIComponent(q)+'&quotesCount=6&newsCount=0')]);
  RES=[];
  const yq=(y.value&&y.value.quotes)||[];
  yq.filter(x=>['EQUITY','ETF','FUTURE'].includes(x.quoteType)).slice(0,6).forEach(x=>RES.push({l:x.symbol,s:(x.shortname||'')+' · '+x.exchDisp,src:{t:'yf',sym:x.symbol},c:x.symbol.endsWith('.AT')?'Greek stocks':x.quoteType==='FUTURE'?'Commodities':'US stocks'}));
  ((c.value&&c.value.coins)||[]).slice(0,6).forEach(x=>RES.push({l:x.symbol.toUpperCase(),s:x.name,src:{t:'cg',id:x.id},c:'Crypto'}));
  $('sr').innerHTML=RES.map((x,i)=>`<div class="row" onclick="choose(${i})" style="cursor:pointer"><span><b>${esc(x.l)}</b> <span class="mut">${esc(x.s)}</span></span><span class="mut">${x.src.t==='cg'?'Crypto':'Stock'}</span></div>`).join('')||('<p class="mut">'+(c.status==='rejected'&&y.status==='rejected'?'Search unavailable. Check your internet connection.':'No results')+'</p>');
}
async function yfPrice(s){const m=(await YJ(YF+'/v8/finance/chart/'+encodeURIComponent(s)+'?range=1d&interval=1d')).chart.result[0].meta;return{p:m.regularMarketPrice,cur:m.currency==='USD'?'USD':'EUR'}}
async function choose(i){
  const x=RES[i];pick=x.src;$('hn').value=x.l;$('hc').value=x.c;$('sr').innerHTML='<p class="mut">Fetching price…</p>';
  try{
    const r=x.src.t==='cg'?{p:(await J(CG+'/simple/price?ids='+x.src.id+'&vs_currencies=usd'))[x.src.id].usd,cur:'USD'}:await yfPrice(x.src.sym);
    $('hp').value=r.p;$('hp').readOnly=true;$('hp').placeholder='Live price';$('hu').value=r.cur;$('hq').focus();
    $('sr').innerHTML='<p class="pos">'+esc(x.l)+' at '+sym(r.cur)+r.p+'. Now add quantity and account below.</p>';
  }catch(e){$('sr').innerHTML='<p class="neg">Price unavailable</p>'}
}
async function refresh(){
  const hs=S.h.filter(h=>h.src);
  const ids=[...new Set(hs.filter(h=>h.src.t==='cg').map(h=>h.src.id))];
  if(ids.length){const d=await J(CG+'/simple/price?ids='+ids.join(',')+'&vs_currencies=usd');hs.forEach(h=>{if(h.src.t==='cg'&&d[h.src.id]){h.p=d[h.src.id].usd;h.cur='USD'}})}
  await Promise.all(hs.filter(h=>h.src.t==='yf').map(async h=>{try{const m=await yfPrice(h.src.sym);h.p=m.p;h.cur=m.cur}catch(e){}}));
  save();
}

/* ---------- OKX (read-only key) ---------- */
async function okx(path){
  const H=(await sec.get('okx_host'))||'https://www.okx.com',ts=new Date().toISOString();
  const k=await sec.get('okx_key'),s=await sec.get('okx_sec'),p=await sec.get('okx_pass');
  if(!k||!s||!p)throw new Error('OKX key, secret and passphrase are required');
  const ck=await crypto.subtle.importKey('raw',new TextEncoder().encode(s),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',ck,new TextEncoder().encode(ts+'GET'+path)))));
  const r=await J(H+path,{headers:{'OK-ACCESS-KEY':k,'OK-ACCESS-SIGN':sig,'OK-ACCESS-TIMESTAMP':ts,'OK-ACCESS-PASSPHRASE':p}});
  if(r.code!=='0')throw new Error(r.msg||'OKX error '+r.code);
  return r.data;
}
async function syncOkx(){
  for(const [id,key] of [['ok','okx_key'],['os','okx_sec'],['op','okx_pass'],['oh','okx_host']]){const v=$(id).value.trim();if(v)await sec.set(key,v)}
  await run(async()=>{
    const H=(await sec.get('okx_host'))||'https://www.okx.com',m={};
    const add=(c,q,u)=>{m[c]=m[c]||{q:0,u:0};m[c].q+=q;m[c].u+=u};
    const a=await okx('/api/v5/account/balance');(a[0]&&a[0].details||[]).forEach(d=>add(d.ccy,+d.eq,+d.eqUsd));
    for(const d of await okx('/api/v5/asset/balances')){
      const q=+d.bal;if(!q)continue;let px=1;
      if(!['USDT','USDC','USD'].includes(d.ccy)){try{px=+(await J(H+'/api/v5/market/ticker?instId='+d.ccy+'-USDT')).data[0].last}catch(e){continue}}
      add(d.ccy,q,q*px);
    }
    S.h=S.h.filter(h=>h.sync!=='okx');
    Object.entries(m).filter(([,v])=>v.q>0&&v.u>0.01).forEach(([c,v])=>S.h.push({id:uid(),n:c,c:'Crypto',a:'OKX',q:v.q,p:v.u/v.q,cur:'USD',sync:'okx'}));
    save();
  });
}

/* ---------- Phantom / Solana (public address only) ---------- */
async function syncSol(){
  const a=$('sa').value.trim();if(!a)return;
  try{localStorage.setItem('sol_addr',a)}catch(e){}
  await run(async()=>{
    const rpc=(m,p)=>J('https://api.mainnet-beta.solana.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p})}).then(r=>{if(r.error)throw new Error(r.error.message);return r.result});
    const sol=(await rpc('getBalance',[a])).value/1e9;
    const t=await rpc('getTokenAccountsByOwner',[a,{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},{encoding:'jsonParsed'}]);
    const tk=t.value.map(x=>x.account.data.parsed.info).filter(i=>i.tokenAmount.uiAmount>0);
    const sp=(await J(CG+'/simple/price?ids=solana&vs_currencies=usd')).solana.usd;
    const tp=tk.length?await J(CG+'/simple/token_price/solana?contract_addresses='+tk.map(i=>i.mint).join(',')+'&vs_currencies=usd'):{};
    S.h=S.h.filter(h=>h.sync!=='sol');
    S.h.push({id:uid(),n:'SOL',c:'Crypto',a:'Phantom',q:sol,p:sp,cur:'USD',sync:'sol',src:{t:'cg',id:'solana'}});
    tk.forEach(i=>{const p=tp[i.mint]&&tp[i.mint].usd;if(p)S.h.push({id:uid(),n:'Token '+i.mint.slice(0,4)+'…',c:'Crypto',a:'Phantom',q:i.tokenAmount.uiAmount,p,cur:'USD',sync:'sol'})});
    save();
  });
}

/* ---------- UI hooks into the existing app ---------- */
const _add=addH;
addH=function(){const n=S.h.length;_add();if(S.h.length>n&&pick){S.h[S.h.length-1].src=pick;pick=null;save()}};
V.Connect=()=>`<div class="card"><h2>Live prices</h2><p class="mut">Assets added through search update automatically.</p><div style="display:flex;gap:10px;align-items:center"><button class="btn" onclick="run(refresh)">Refresh all prices</button></div></div>
<div class="card"><h2>Phantom (Solana)</h2><p class="mut">Public wallet address only. No keys or signing.</p><div class="f"><input id="sa" class="full" placeholder="Wallet address" value="${esc(localStorage.getItem('sol_addr')||'')}"><button class="btn full" onclick="syncSol()">Sync wallet</button></div></div>
<div class="card"><h2>OKX (read-only key)</h2><p class="mut">Stored encrypted on this phone. Fields stay empty once saved.</p><div class="f"><input id="ok" class="full" placeholder="API key"><input id="os" placeholder="Secret"><input id="op" placeholder="Passphrase"><input id="oh" class="full" placeholder="Host (EEA accounts may need https://eea.okx.com)"><button class="btn full" onclick="syncOkx()">Save &amp; sync OKX</button></div></div>`;
render();
const auto=()=>{if(!S.h.some(h=>h.src))return;refresh().then(()=>msg('● Live · '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))).catch(()=>msg('Offline · prices may be outdated'))};
auto();setInterval(auto,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)auto()});
