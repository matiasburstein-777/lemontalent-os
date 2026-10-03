"use strict";
// ---------- constants ----------
const ETAPAS = ["Sourcing","Contactado","Entrevista LT","Presentado","Entrevista cliente","Oferta","Contratado","Descartado"];
const ESTADOS_B = ["Activa","En pausa","Cerrada","Cancelada"];
const ETAPAS_LEAD = ["Identificado","Contactado","En conversación","Propuesta enviada","Ganado","Perdido"];
const ORIGENES_LEAD = ["Conocido","Referido de cliente","Referido","Cliente anterior","Inbound (nos escribió)","Evento","Prospección en frío"];
const CANALES_LEAD = ["LinkedIn","WhatsApp","Mail","Llamada","Reunión","Evento"];
const MOTIVOS_PERDIDA = ["No interesado","Sin búsquedas por ahora","Precio","Eligió a otro","Sin respuesta","Propuesta no avanzó"];
const MOTIVOS_DESC = ["No califica","Pretensión salarial","Declinó el candidato","Rechazado por el cliente","No respondió","Aceptó otra oferta","Otro"];
const CATEGORIAS_GASTO = ["Sueldos y honorarios","Software y herramientas","Oficina","Impuestos","Contador y legales","Marketing","Bancos y comisiones","Otros"];
const TIPOS_FC = ["Inicio y avance","Cierre","50% anticipo","Cancelación"];
const EMISORES = ["MATI","PAU","Invoice"];
const PRIORIDADES = ["","1 (Alta)","2 (Media)","3 (Estable)"];
const DEF_OBJ = {facturacionMensualARS:11000000,ticketPromedioARS:2800000,feeMinimoARS:1850000,timeToFillDias:35,busquedasActivas:8,propuestasMes:2,nuevosClientesMes:2};

// ---------- state ----------
const S = {busquedas:{},candidatos:{},postulaciones:{},equipo:null,facturas:{},fin:{},meses:{},clientes:{},leads:{},objetivos:null,feedback:{},users:[],propuestas:{},digest:null,cliDocs:null,gastos:{},gastosRec:{}};
const loaded = {};
let me = {id:null}, isAdmin = false, canFin = false, isAdm = false; // isAdmin = socio; canFin = socio o administradora
let view = "panel";
const UI = {bEstado:"Activa",bRec:"",bCli:"",bQ:"",bMode:"cards",cTab:"base",cBusq:"",cQ:"",crmTab:"leads",lQ:"",fTab:"pendientes",ecoYear:new Date().getFullYear()};
let names = {};

// ---------- utils ----------
const $ = (s,el=document)=>el.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today = () => { const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }; // fecha local (antes usaba UTC y después de las 21 h marcaba el día siguiente)
const ym = iso => (iso||"").slice(0,7);
const curYM = () => today().slice(0,7);
const nf0 = new Intl.NumberFormat("es-AR",{maximumFractionDigits:0});
const nf1 = new Intl.NumberFormat("es-AR",{maximumFractionDigits:1});
// Espacio no separable: el signo y el número nunca quedan en líneas distintas
const ars = v => v==null||isNaN(v) ? "—" : "$\u00a0" + nf0.format(v);
const usd = v => v==null||isNaN(v) ? "—" : "US$\u00a0" + nf0.format(v);
const money = (v,m) => m==="USD" ? usd(v) : ars(v);
const short = v => { if(v==null||isNaN(v)) return "—"; const a=Math.abs(v); return a>=1e6 ? nf1.format(v/1e6)+" M" : a>=1e3 ? nf1.format(v/1e3)+" k" : nf0.format(v); };
const pct = v => v==null||!isFinite(v) ? "—" : nf0.format(v*100)+"%";
const MES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
// Espacios no separables: una fecha nunca se parte en dos líneas
const fd = iso => { if(!iso) return "—"; const [y,m,d]=iso.split("-"); return `${+d}\u00a0${MES[+m-1]}\u00a0${y.slice(2)}`; };
const fm = k => { const [y,m]=k.split("-"); return `${MES[+m-1]}\u00a0${y.slice(2)}`; };
const days = (a,b=today()) => (!a) ? null : Math.round((new Date(b)-new Date(a))/864e5);
const finGar = f => { const [y,m,d]=f.split("-").map(Number); const t=new Date(Date.UTC(y,m+2,1)); t.setUTCDate(Math.min(d,new Date(Date.UTC(y,m+3,0)).getUTCDate())); return t.toISOString().slice(0,10); }; // garantía: 3 meses desde el ingreso
const addDays = (iso,n) => { const d=new Date(iso); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };
const uniq = a => [...new Set(a.filter(Boolean))];
const sortBy = (a,f,dir=1) => [...a].sort((x,y)=>{const p=f(x),q=f(y); return (p>q?1:p<q?-1:0)*dir;});
const vals = o => Object.values(o||{});
const keyN = s => String(s||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");

function toast(msg,err){ const h=$("#toastHost"); h.innerHTML=`<div class="toast${err?" err":""}">${esc(msg)}</div>`; clearTimeout(toast.t); toast.t=setTimeout(()=>h.innerHTML="",2600); }
// Aviso con botón para deshacer la última acción (queda 6 segundos)
let undoFn=null;
function toastUndo(msg,fn){ undoFn=fn; const h=$("#toastHost"); h.innerHTML=`<div class="toast">${esc(msg)} <button class="toast-undo" data-act="undo">Deshacer</button></div>`; clearTimeout(toast.t); toast.t=setTimeout(()=>{h.innerHTML="";undoFn=null;},6000); }

// ---------- money helpers ----------
const hist = () => Object.fromEntries(vals(S.meses).filter(m=>m.historico).map(m=>[m.id,m]));
const mesDoc = k => { const m=S.meses[k]; return m&&!m.historico ? m : null; };
function tcFor(k){
  const h=hist(); if(h[k]&&h[k].tc) return h[k].tc;
  const m=mesDoc(k); if(m&&m.tc) return m.tc;
  const all=[...Object.keys(h).filter(x=>h[x].tc).map(x=>[x,h[x].tc]), ...vals(S.meses).filter(d=>!d.historico&&d.tc).map(d=>[d.id,d.tc])].sort((a,b)=>a[0]<b[0]?-1:1);
  let last=null; for(const [mk,t] of all){ if(mk<=k) last=t; } return last || (all.length?all[all.length-1][1]:1500);
}
const toUSD = (v,mon,k) => !v ? 0 : mon==="USD" ? v : v/tcFor(k);
const toARS = (v,mon,k) => !v ? 0 : mon==="USD" ? v*tcFor(k) : v;
const fcUSD = f => toUSD(f.monto,f.moneda,ym(f.fechaEmision)||curYM());
const fcARS = f => toARS(f.monto,f.moneda,ym(f.fechaEmision)||curYM());

// P&L for a month
function pnl(k){
  const h=hist()[k]; const tc=tcFor(k);
  let ingARS, ingUSD, gastos, source;
  if(h && k>=CORTE_FACTURAS){
    // Ingresos y comisiones salen de las facturas (por fecha de emisión); de la planilla solo quedan los gastos fijos.
    const fs=vals(S.facturas).filter(f=>!f.historico && ym(f.fechaEmision)===k);
    ingARS=fs.filter(f=>f.moneda!=="USD").reduce((s,f)=>s+(f.monto||0),0); ingUSD=fs.filter(f=>f.moneda==="USD").reduce((s,f)=>s+(f.monto||0),0);
    gastos=(h.gastos||[]).filter(g=>!/recruiters? freelance/i.test(g.concepto||"")).map(g=>({...g}));
    const comARS=fs.filter(f=>f.monedaComision!=="USD").reduce((s,f)=>s+(f.comision||0),0), comUSD=fs.filter(f=>f.monedaComision==="USD").reduce((s,f)=>s+(f.comision||0),0);
    if(comARS) gastos.push({concepto:"Comisiones recruiters (auto)",moneda:"ARS",monto:comARS,auto:true});
    if(comUSD) gastos.push({concepto:"Comisiones recruiters USD (auto)",moneda:"USD",monto:comUSD,auto:true});
    source="facturas";
  }
  else if(h){ ingARS=h.ingresosARS||0; ingUSD=h.ingresosUSD||0; gastos=(h.gastos||[]).map(g=>({...g})); source="planilla"; }
  else{
    const fs=vals(S.facturas).filter(f=>!f.historico && ym(f.fechaEmision)===k);
    ingARS=fs.filter(f=>f.moneda!=="USD").reduce((s,f)=>s+(f.monto||0),0);
    ingUSD=fs.filter(f=>f.moneda==="USD").reduce((s,f)=>s+(f.monto||0),0);
    const m=mesDoc(k); gastos=[...((m&&m.gastos)||[]).map(g=>({...g})), ...gastosDelMes(k).map(g=>({concepto:g.concepto,moneda:g.moneda,monto:g.monto||0,categoria:g.categoria||"Otros",id:g.id}))];
    const comARS=fs.filter(f=>f.monedaComision!=="USD").reduce((s,f)=>s+(f.comision||0),0);
    const comUSD=fs.filter(f=>f.monedaComision==="USD").reduce((s,f)=>s+(f.comision||0),0);
    if(comARS) gastos.push({concepto:"Comisiones recruiters (auto)",moneda:"ARS",monto:comARS,auto:true,categoria:"Comisiones recruiters"});
    if(comUSD) gastos.push({concepto:"Comisiones recruiters USD (auto)",moneda:"USD",monto:comUSD,auto:true,categoria:"Comisiones recruiters"});
    source="sistema";
  }
  const ingTot=ingARS/tc+ingUSD;
  const gasTot=gastos.reduce((s,g)=>s+(g.moneda==="USD"?g.monto:g.monto/tc),0);
  return {k,tc,ingARS,ingUSD,ingTot,gastos,gasTot,res:ingTot-gasTot,margen:ingTot?(ingTot-gasTot)/ingTot:null,source};
}
// Gastos cargados en la tabla de gastos (solo meses que no vienen de la planilla Economics)
const gastosDelMes = k => vals(S.gastos).filter(g=>g.mes===k&&!g.omitido);
const sigMes = k => { const [y,m]=k.split("-").map(Number); return m===12?`${y+1}-01`:`${y}-${String(m+1).padStart(2,"0")}`; };
const antMes = k => { const [y,m]=k.split("-").map(Number); return m===1?`${y-1}-12`:`${y}-${String(m-1).padStart(2,"0")}`; };
const primerMesSistema = () => { const hs=Object.keys(hist()).sort(); return hs.length?sigMes(hs[hs.length-1]):"2000-01"; };
function monthsOfYear(y){ const out=[]; const cur=curYM(); for(let m=1;m<=12;m++){ const k=`${y}-${String(m).padStart(2,"0")}`; if(k<=cur) out.push(k);} return out; }
function lastMonths(n){ const out=[]; const d=new Date(); d.setDate(1); for(let i=n-1;i>=0;i--){ const x=new Date(d.getFullYear(),d.getMonth()-i,1); out.push(`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}`);} return out; }

// ---------- derived ----------
const B = () => vals(S.busquedas);
const activas = () => B().filter(b=>b.estado==="Activa");
const recruiters = () => { const eq=(S.equipo&&S.equipo.recruiters)||[]; return eq.length?eq:uniq(B().map(b=>b.recruiter)).map(n=>({nombre:n,activa:true,capacidad:4,comisionPct:20})); };
const recActivos = () => recruiters().filter(r=>r.activa);
const obj = () => ({...DEF_OBJ,...(S.objetivos||{})});
const postsOf = bid => vals(S.postulaciones).filter(p=>p.busquedaId===bid);
const postsOfCand = cid => vals(S.postulaciones).filter(p=>p.candidatoId===cid);
const lastTouch = b => { const l=(b.bitacora||[]).map(x=>x.fecha).sort().pop(); return [l,b.actualizado,b.fechaInicio].filter(Boolean).sort().pop(); };
const ttf = b => (b.fechaInicio&&b.fechaCierre)? days(b.fechaInicio,b.fechaCierre) : null;
// Etapas por las que pasó una postulación (el servidor las guarda en cada cambio; las viejas solo tienen la actual)
const trayecto = p => (p.etapas&&p.etapas.length) ? p.etapas : [{etapa:p.etapa,fecha:p.fecha}];
// Etapa más avanzada a la que llegó (índice en ETAPAS, sin contar Descartado): base del funnel real
const alcance = p => Math.max(0,...[...trayecto(p),{etapa:p.etapa}].map(x=>ETAPAS.indexOf(x.etapa)).filter(i=>i>=0&&i<7));
const ultimoMov = (b,ps=postsOf(b.id)) => [lastTouch(b),...ps.flatMap(p=>[p.fecha,...trayecto(p).map(x=>x.fecha)])].filter(Boolean).sort().pop();
// Semáforo de una búsqueda activa. Las reglas de cantidad de candidatos esperan 7 días desde el inicio.
function salud(b){
  if(b.estado!=="Activa") return {nivel:"",motivos:[]};
  const ps=postsOf(b.id), vivos=ps.filter(p=>p.etapa!=="Descartado").length, sm=days(ultimoMov(b,ps)), dIni=days(b.fechaInicio);
  const terna=b.fechaPrimeraTerna||ps.some(p=>alcance(p)>=3), rojo=[], amar=[];
  if(sm!=null&&sm>7) rojo.push(`sin movimiento hace ${sm} días`); else if(sm!=null&&sm>4) amar.push(`sin movimiento hace ${sm} días`);
  if(!terna&&dIni!=null&&dIni>21) rojo.push(`sin terna a los ${dIni} días`);
  if(dIni==null||dIni>7){ if(!vivos) rojo.push("sin candidatos vivos"); else if(vivos<3) amar.push(`solo ${vivos} candidato${vivos>1?"s":""} vivo${vivos>1?"s":""}`); }
  return rojo.length?{nivel:"crit",motivos:[...rojo,...amar]}:amar.length?{nivel:"warn",motivos:amar}:{nivel:"ok",motivos:[]};
}
const SALUD_LAB = {crit:"En riesgo",warn:"Atención",ok:"En marcha"};
const pillSalud = sa => sa.nivel ? `<span class="pill ${sa.nivel}" title="${esc(sa.motivos.join(" · ")||"Todo en orden")}">${SALUD_LAB[sa.nivel]}</span>` : "";
const SALUD_ORD = {crit:0,warn:1,ok:2,"":3};
const hace = d => d==null ? "—" : d<=0 ? "hoy" : `hace ${d} d`;
function ageSev(d){ if(d==null) return ""; return d>60?"crit":d>35?"warn":"ok"; }
function clientNames(){ return uniq([...vals(S.clientes).map(c=>c.nombre), ...B().map(b=>b.cliente)]).sort((a,b)=>a.localeCompare(b,"es")); }

function clienteStats(){
  const map={};
  const get=n=>{ const k=keyN(n); return map[k] ||= {k,nombre:n,doc:null,bus:[],fcs:[]}; };
  vals(S.clientes).forEach(c=>get(c.nombre).doc=c);
  B().forEach(b=>b.cliente&&get(b.cliente).bus.push(b));
  vals(S.facturas).forEach(f=>f.cliente&&get(f.cliente).fcs.push(f));
  return vals(map).map(c=>{
    const act=c.bus.filter(b=>b.estado==="Activa").length;
    const last=c.bus.map(b=>b.fechaInicio).filter(Boolean).sort().pop()||"";
    const first=c.bus.map(b=>b.fechaInicio).filter(Boolean).sort()[0]||"";
    const fact=c.fcs.reduce((s,f)=>s+fcUSD(f),0);
    const d=days(last);
    const estado= act? "Activo" : (d!=null&&d<=180)? "Reciente" : "Dormido";
    return {...c,act,last,first,fact,estado,cerradas:c.bus.filter(b=>b.estado==="Cerrada").length,total:c.bus.length,ticket:c.fcs.length?fact/c.fcs.length:null};
  });
}

// ---------- rendering shell ----------
const VIEWS = [
  {sep:"Día a día"},
  {id:"panel",label:"Inicio"},
  {id:"propuestas",label:"Bandeja de propuestas",admin:true,cnt:()=>vals(S.propuestas).filter(p=>p.estado==="Pendiente").length},
  {sep:"Operación"},
  {id:"busquedas",label:"Búsquedas",cnt:()=>activas().length},
  {id:"candidatos",label:"Candidatos",cnt:()=>vals(S.candidatos).length},
  {id:"recruiters",label:()=>canFin?"Equipo":"Mi panel"},
  {sep:"Negocio",admin:true},
  {id:"crm",label:"Clientes y leads",admin:true,cnt:()=>vals(S.leads).filter(l=>!["Ganado","Perdido"].includes(l.etapa)).length},
  {id:"cobros",label:"Finanzas",admin:true,cnt:()=>vals(S.facturas).filter(f=>!f.cobrada).length},
  {sep:"Sistema"},
  {id:"config",label:"Configuración",cnt:()=>(canFin?calidadDatos().length:0)+vals(S.feedback).filter(f=>f.estado==="Pendiente"||f.estado==="En curso").length},
];
const labOf = v => typeof v.label==="function" ? v.label() : v.label;
function renderNav(){
  $("#nav").innerHTML = VIEWS.filter(v=>!v.admin||canFin).map(v=> v.sep ? `<div class="nav-sep">${v.sep}</div>` :
    `<a href="#${v.id}" data-view="${v.id}" ${view===v.id||(v.id==="recruiters"&&view==="recruiter")||(v.id==="config"&&CONFIG_VIEWS.includes(view))?'aria-current="page"':""}>${labOf(v)}${v.cnt?`<span class="cnt">${v.cnt()}</span>`:""}</a>`).join("");
  $("#role").textContent = isAdmin ? "Socio · acceso completo" : isAdm ? "Administradora · operación y facturación" : "Recruiter · operación"; $("#who").textContent = me.nombre||"";
}
let raf=0;
function schedule(){ if(raf) return; raf=requestAnimationFrame(()=>{raf=0; render();}); }
function render(){
  renderNav();
  const m=$("#main");
  if((["crm","cobros","economics","propuestas"].includes(view)) && !canFin){ view="panel"; }
  const fn = {panel:vInicio,weekly:vInicio,config:vConfig,recruiters:vRecruiters,recruiter:vRecruiter,ficha:vFicha,busquedas:vBusquedas,candidatos:vCandidatos,crm:vCrm,cobros:vCobros,economics:vEconomics,mejoras:vMejoras,propuestas:vPropuestas,conexiones:vConexiones,historial:vHistorial,calidad:vCalidad}[view] || vInicio;
  const sx=window.scrollX, sy=window.scrollY;
  const active=document.activeElement; const aid=active&&active.id; const sel=aid&&active.selectionStart;
  m.innerHTML = fn();
  if(aid && aid.startsWith("q-")){ const el=document.getElementById(aid); if(el){ el.focus(); try{el.setSelectionRange(sel,sel);}catch(e){} } }
  window.scrollTo(sx,sy);
  afterRender();
}
const afterHooks=[]; function afterRender(){ while(afterHooks.length) afterHooks.shift()(); }

// ---------- components ----------
function kpi(label,value,sub,meter){ return `<div class="kpi"><span class="label">${label}</span><span class="v">${value}</span>${meter!=null?`<div class="meter${meter>1?" over":""}"><i style="width:${Math.min(100,Math.max(2,meter*100))}%"></i></div>`:""}${sub?`<span class="s">${sub}</span>`:""}</div>`; }
function pillEstado(e){ const c={Activa:"lemon","En pausa":"info",Cerrada:"ok",Cancelada:"crit"}[e]||""; return `<span class="pill ${c}">${esc(e||"—")}</span>`; }
function pillEtapa(e){ const c={Contratado:"ok",Descartado:"crit",Oferta:"lemon",Presentado:"info","Entrevista cliente":"info"}[e]||""; return `<span class="pill ${c}">${esc(e)}</span>`; }
function pillLead(e){ const c={Ganado:"ok",Perdido:"crit","Propuesta enviada":"lemon","En conversación":"info"}[e]||""; return `<span class="pill ${c}">${esc(e)}</span>`; }
const opt = (list,cur) => list.map(o=>{ const v=typeof o==="object"?o.v:o, l=typeof o==="object"?o.l:o; return `<option value="${esc(v)}"${String(v)===String(cur??"")?" selected":""}>${esc(l||"—")}</option>`; }).join("");
const field = (label,id,value,type="text",extra="") => `<div class="f ${extra}"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value??"")}"${type==="number"?' step="any"':""}></div>`;
const fsel = (label,id,list,cur,extra="") => `<div class="f ${extra}"><label for="${id}">${label}</label><select id="${id}">${opt(list,cur)}</select></div>`;
const farea = (label,id,value,extra="full") => `<div class="f ${extra}"><label for="${id}">${label}</label><textarea id="${id}">${esc(value??"")}</textarea></div>`;
const fdl = (label,id,value,listId,extra="") => `<div class="f ${extra}"><label for="${id}">${label}</label><input id="${id}" type="text" list="${listId}" value="${esc(value??"")}"></div>`;
const gv = id => { const el=document.getElementById(id); return el ? (el.type==="checkbox"?el.checked:el.value.trim()) : undefined; };
const gn = id => { const el=document.getElementById(id); if(el&&el.type==="number"){ return el.value===""?null:(isNaN(Number(el.value))?null:Number(el.value)); } const v=gv(id); if(v===""||v==null) return null; const n=Number(String(v).replace(/\./g,"").replace(",",".")); return isNaN(n)?null:n; };
const datalist = (id,list) => `<datalist id="${id}">${list.map(x=>`<option value="${esc(x)}"></option>`).join("")}</datalist>`;

function barChart(rows,{h=220,onlyA=false,la="Ingresos (US$ eq.)",lb="Gastos (US$ eq.)",fmt=usd}={}){
  // rows: [{label, a, b}] a = ingresos, b = gastos (USD)
  if(!rows.length) return "";
  const W=760, H=h, padL=48, padB=26, padT=10, padR=8;
  if(onlyA) rows=rows.map(r=>({...r,b:0}));
  const max=Math.max(1,...rows.map(r=>Math.max(r.a,r.b)));
  const step=Math.pow(10,Math.floor(Math.log10(max))); const nice=[1,2,2.5,5,10].map(x=>x*step).find(x=>max/x<=5)||step*10;
  const top=Math.ceil(max/nice)*nice;
  const y=v=>padT+(H-padT-padB)*(1-v/top);
  const bw=(W-padL-padR)/rows.length;
  let g=""; for(let t=0;t<=top+1e-9;t+=nice){ g+=`<line x1="${padL}" x2="${W-padR}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)"/><text x="${padL-6}" y="${y(t)+4}" text-anchor="end">${short(t)}</text>`; }
  const bars=rows.map((r,i)=>{ const x=padL+i*bw; const w=Math.max(4,bw*0.32);
    return `<g${r.k?` class="click" data-act="openMes" data-id="${r.k}"`:""}><rect x="${x}" y="${padT}" width="${bw}" height="${H-padT-padB}" fill="transparent"/><title>${esc(r.label)} · ${esc(la)}: ${fmt(r.a)}${onlyA?"":` · ${esc(lb)}: ${fmt(r.b)}`}</title>
      <rect x="${x+bw*0.16}" y="${y(r.a)}" width="${w}" height="${Math.max(0,H-padB-y(r.a))}" rx="2" fill="var(--lemon)"/>
      <rect x="${x+bw*0.16+w+2}" y="${y(r.b)}" width="${w}" height="${Math.max(0,H-padB-y(r.b))}" rx="2" fill="var(--muted)" opacity=".55"/>
      <text x="${x+bw/2}" y="${H-8}" text-anchor="middle">${esc(r.label)}</text></g>`; }).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(la)} por mes">${g}${bars}</svg></div>
  <div class="legend"><span><i style="background:var(--lemon)"></i>${esc(la)}</span>${onlyA?"":`<span><i style="background:var(--muted);opacity:.55"></i>${esc(lb)}</span>`}</div>`;
}

// ================= PANEL =================
function vPanel(){
  const o=obj(); const act=activas(); const recs=recActivos();
  const capTot=recs.reduce((s,r)=>s+(+r.capacidad||0),0);
  const pausa=B().filter(b=>b.estado==="En pausa").length;
  const sinAv=act.filter(b=>(days(lastTouch(b))??99)>7);
  let h=propBanner();
  let k=`${kpi("Búsquedas activas",act.length,`capacidad del equipo ${capTot} · objetivo ${o.busquedasActivas}${pausa?` · ${pausa} en pausa`:""}`,capTot?act.length/capTot:null)}
    ${kpi("Sin actualizar",sinAv.length,sinAv.length?"activas sin novedades hace más de 7 días":"todas las activas están al día")}`;
  if(canFin){
    const pend=vals(S.facturas).filter(f=>!f.cobrada); const venc=pend.filter(f=>days(f.fechaEmision)>30);
    const com=vals(S.facturas).filter(f=>!f.comisionPagada&&f.comision>0);
    k+=`${kpi("Por cobrar",ars(pend.reduce((s,f)=>s+fcARS(f),0)),`${pend.length} facturas · ${venc.length} con más de 30 días`)}
      ${kpi("Comisiones a pagar",ars(com.reduce((s,f)=>s+toARS(f.comision,f.monedaComision,ym(f.fechaEmision)),0)),`${com.length} facturas con comisión pendiente`)}`;
  }
  h+=`<div class="kpis">${k}</div>`;
  // carga por recruiter
  const load=recs.map(r=>({r,n:act.filter(b=>b.recruiter===r.nombre).length}));
  const sinAsignar=act.filter(b=>!b.recruiter||!recs.some(r=>r.nombre===b.recruiter)).length;
  let bars=load.map(({r,n})=>`<div class="bar"><span>${canFin?`<a href="#recruiter/${encodeURIComponent(r.nombre)}">${esc(r.nombre)}</a>`:esc(r.nombre)}</span><div class="track${n>(+r.capacidad||4)?" over":""}"><i style="width:${Math.min(100,n/Math.max(1,+r.capacidad||4)*100)}%"></i></div><span class="num muted">${n} / ${r.capacidad||4}</span></div>`).join("");
  if(sinAsignar) bars+=`<div class="bar"><span class="muted">Otras / sin asignar</span><div class="track"><i style="width:${Math.min(100,sinAsignar*20)}%;background:var(--muted)"></i></div><span class="num muted">${sinAsignar}</span></div>`;
  // atención
  const att=[];
  act.forEach(b=>{ const lt=days(lastTouch(b)), d=days(b.fechaInicio); const mot=[]; let sev=null;
    if(lt!=null&&lt>7){ mot.push(lt===d?`sin novedades desde que se abrió hace ${d} días`:`sin actualizar hace ${lt} días`); sev=lt>14?"crit":"warn"; }
    if(d>60&&lt!==d){ mot.push(`abierta hace ${d} días`); sev="crit"; }
    if(mot.length){ const t=mot.join(" · "); att.push({sev,g:"Búsquedas",t:`${b.puesto} · ${b.cliente}`,d:t[0].toUpperCase()+t.slice(1)+(b.recruiter?` · ${b.recruiter}`:""),act:"openBusqueda",id:b.id}); } });
  B().filter(b=>b.finGarantia&&days(today(),b.finGarantia)>=0&&days(today(),b.finGarantia)<=30).forEach(b=>att.push({sev:"info",g:"Garantías",t:`${b.candidatoFinal||b.puesto} · ${b.cliente}`,d:`Garantía vence ${fd(b.finGarantia)}`,act:"openBusqueda",id:b.id}));
  if(canFin){
    vals(S.facturas).filter(f=>!f.cobrada&&days(f.fechaEmision)>30).forEach(f=>att.push({sev:"crit",g:"Cobros",t:`Cobrar ${money(f.monto,f.moneda)} · ${f.cliente}`,d:`Emitida hace ${days(f.fechaEmision)} días`,act:"openFactura",id:f.id}));
    vals(S.leads).filter(l=>l.proximoSeguimiento&&l.proximoSeguimiento<=today()&&!["Ganado","Perdido"].includes(l.etapa)).forEach(l=>att.push({sev:"warn",g:"Comercial",t:`Seguimiento ${l.empresa}`,d:`Programado ${fd(l.proximoSeguimiento)}`,act:"openLead",id:l.id}));
  }
  const order={crit:0,warn:1,info:2};
  const grupos=uniq(att.map(a=>a.g)); UI.attG=grupos.includes(UI.attG)?UI.attG:"";
  const lista=sortBy(att.filter(a=>!UI.attG||a.g===UI.attG),a=>order[a.sev]);
  const filtros=grupos.length>1?`<div class="seg" role="group" aria-label="Filtrar"><button data-act="attG" data-v="" aria-pressed="${!UI.attG}">Todo <span class="muted num">${att.length}</span></button>${grupos.map(g=>`<button data-act="attG" data-v="${esc(g)}" aria-pressed="${UI.attG===g}">${esc(g)} <span class="muted num">${att.filter(a=>a.g===g).length}</span></button>`).join("")}</div>`:"";
  const fila=a=>`<div class="row"><div class="grow"><div><b>${esc(a.t)}</b></div><div class="muted">${esc(a.d)}</div></div><span class="pill ${a.sev}">${a.sev==="crit"?"Urgente":a.sev==="warn"?"Revisar":"Próximo"}</span><button class="btn sm" data-act="${a.act}" data-id="${esc(a.id)}">Abrir</button></div>`;
  const attH=lista.length? lista.slice(0,10).map(fila).join("")+(lista.length>10?`<details class="more"><summary>Ver ${lista.length-10} más</summary>${lista.slice(10).map(fila).join("")}</details>`:"") : `<div class="empty">Nada pendiente. Todas las búsquedas activas tienen novedades de esta semana.</div>`;
  let cal="";
  if(canFin){ const q=calidadDatos(); if(q.length) cal=`<div class="note" style="margin-top:10px">${q.length} puntos de calidad de datos para revisar. <a href="#calidad">Ver calidad de datos</a></div>`; }
  h+=`<div class="grid2">
    <section class="panel"><div class="panel-head"><h2>Requieren atención</h2>${filtros}</div><div class="list">${attH}</div>${cal}</section>
    <section class="panel"><div class="panel-head"><h2>Carga por recruiter</h2><span class="muted">búsquedas activas / capacidad</span></div>${bars||'<div class="empty">Cargá el equipo en Equipo › Editar equipo.</div>'}</section>
  </div>`;
  if(canFin){ const pp=sortBy(vals(S.propuestas).filter(p=>p.estado==="Pendiente"),p=>p.fecha||p.creado||"",-1);
    if(pp.length) h+=`<section class="panel"><div class="panel-head"><h2>Propuestas pendientes</h2><a class="btn sm" href="#propuestas">Revisar las ${pp.length} en la Bandeja</a></div><div class="list">${pp.slice(0,5).map(p=>`<a class="row" href="#propuestas" style="text-decoration:none;color:inherit"><div class="grow" style="min-width:0"><div>${esc(p.resumen||"")}</div><div class="muted" style="font-size:12px">${esc([p.fuente,p.cuenta,p.fecha?fd(String(p.fecha).slice(0,10)):""].filter(Boolean).join(" · "))}</div></div><span class="pill ${FUENTE_PILL[p.fuente]||""}">${esc(p.fuente||"Digest")}</span></a>`).join("")}</div></section>`; }
  h+=funnelPanel();
  return h;
}

// ================= BÚSQUEDAS =================
function vBusquedas(){
  if(!canFin&&!UI._recDef){ UI._recDef=1; const mio=recruiters().find(x=>keyN(x.nombre)===keyN(me.nombre||"")); if(mio){ UI.wkRec=mio.nombre; UI.bRec=mio.nombre; } }
  const recs=uniq(B().map(b=>b.recruiter)).sort();
  let list=B();
  if(UI.bEstado!=="Todas") list=list.filter(b=>b.estado===UI.bEstado);
  if(UI.bRec) list=list.filter(b=>b.recruiter===UI.bRec);
  if(UI.bCli) list=list.filter(b=>b.cliente===UI.bCli);
  if(UI.bQ){ const q=keyN(UI.bQ); list=list.filter(b=>keyN([b.puesto,b.cliente,b.candidatoFinal,b.recruiter].join(" ")).includes(q)); }
  list=sortBy(list,b=>b.fechaInicio||"",-1);
  const counts={}; ESTADOS_B.forEach(e=>counts[e]=B().filter(b=>b.estado===e).length);
  let h=`<div class="head"><div><h1>Búsquedas</h1><p>Todas las búsquedas y su estado. Reemplaza la planilla de Gestión.</p></div>
    <button class="btn lemon" data-act="newBusqueda">Nueva búsqueda</button></div>
  <div class="toolbar">
    <div class="seg" role="group" aria-label="Estado">${[...ESTADOS_B,"Todas"].map(e=>`<button data-act="bEstado" data-v="${e}" aria-pressed="${UI.bEstado===e}">${e}${counts[e]!=null?` <span class="muted num">${counts[e]}</span>`:""}</button>`).join("")}</div>
    <select id="f-brec" data-ui="bRec" aria-label="Recruiter"><option value="">Todas las recruiters</option>${opt(recs,UI.bRec)}</select>
    <select id="f-bcli" data-ui="bCli" aria-label="Cliente"><option value="">Todos los clientes</option>${opt(uniq(B().map(b=>b.cliente)).sort((a,b)=>a.localeCompare(b,"es")),UI.bCli)}</select>
    <input id="q-b" type="search" placeholder="Buscar puesto, cliente o candidato" data-ui="bQ" value="${esc(UI.bQ)}">
    <div class="seg" role="group" aria-label="Vista"><button data-act="bMode" data-v="cards" aria-pressed="${UI.bMode==="cards"}">Tarjetas</button><button data-act="bMode" data-v="table" aria-pressed="${UI.bMode==="table"}">Tabla</button><button data-act="bMode" data-v="seg" aria-pressed="${UI.bMode==="seg"}">Seguimiento</button></div>${xbtn("busquedas")}
  </div>`;
  if(!list.length) return h+`<div class="empty">No hay búsquedas con estos filtros.</div>`;
  if(UI.bMode==="cards"){
    h+=`<div class="cards">${list.map(cardBusqueda).join("")}</div>`;
  } else if(UI.bMode==="seg"){
    h+=tablaSeguimiento(list);
  } else {
    h+=`<div class="tablewrap"><table><thead><tr><th>Puesto</th><th>Cliente</th><th>Recruiter</th><th>Estado</th><th>Inicio</th><th>Cierre</th><th class="r">TTF</th><th>Candidato final</th></tr></thead><tbody>
    ${list.map(b=>`<tr class="click" data-act="openBusqueda" data-id="${b.id}"><td><b>${esc(b.puesto)}</b>${b.garantia?' <span class="tag">garantía</span>':""}${b.inicioAvance?' <span class="tag">inicio y avance</span>':""}</td><td>${esc(b.cliente)}</td><td>${esc(b.recruiter||"—")}</td><td>${pillEstado(b.estado)}</td><td class="num">${fd(b.fechaInicio)}</td><td class="num">${fd(b.fechaCierre)}</td><td class="r num">${ttf(b)??"—"}</td><td>${esc(b.candidatoFinal||"—")}</td></tr>`).join("")}
    </tbody></table></div>`;
  }
  return h;
}
function cardBusqueda(b){
  const d=b.estado==="Activa"?days(b.fechaInicio):ttf(b); const lt=days(lastTouch(b));
  const ps=postsOf(b.id); const st={}; ps.forEach(p=>st[p.etapa]=(st[p.etapa]||0)+1);
  const stages=ETAPAS.filter(e=>st[e]).map(e=>`<span>${e} <b>${st[e]}</b></span>`).join("");
  return `<article class="card">
    <div class="card-top"><div><h3>${esc(b.puesto)}</h3><div class="meta"><span>${esc(b.cliente)}</span><span>${esc(b.recruiter||"Sin recruiter")}</span>${b.prioridad?`<span>Prioridad ${esc(b.prioridad)}</span>`:""}</div></div>
    <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">${pillSalud(salud(b))}${b.estado==="Activa"?`<span class="pill ${ageSev(d)} plain num">${d??"—"} días</span>`:pillEstado(b.estado)}</span></div>
    ${stages?`<div class="stages">${stages}</div>`:""}
    <div class="body">${b.detalle?`<p><span class="label">Estado</span><br>${esc(b.detalle)}</p>`:""}${b.proximoPaso?`<p><span class="label">Próximo paso</span><br>${esc(b.proximoPaso)}</p>`:""}${!b.detalle&&!b.proximoPaso?`<p class="muted">Sin novedades cargadas.</p>`:""}</div>
    <div class="foot"><span class="muted" style="font-size:12px">${lt!=null?`Actualizada hace ${lt} días`:"Sin actualizar"}${salud(b).motivos.length?` · ${esc(salud(b).motivos[0])}`:""}${b.candidatoFinal?` · ${esc(b.candidatoFinal)}`:""}</span>
    <span style="display:flex;gap:6px"><button class="btn sm" data-act="weeklyUpdate" data-id="${b.id}">Actualizar</button><button class="btn sm ghost" data-act="openBusqueda" data-id="${b.id}">Abrir</button></span></div>
  </article>`;
}

// ================= CANDIDATOS =================
function vCandidatos(){
  // El pipeline de cada búsqueda vive en su ficha; acá queda la base de talento
  let h=`<div class="head"><div><h1>Candidatos</h1><p>Base de talento reutilizable. El pipeline de cada búsqueda está en su ficha.</p></div>
    <button class="btn lemon" data-act="newCandidato">Nuevo candidato</button></div>`;
  if(false){
    const act=sortBy(activas(),b=>b.cliente);
    if(!UI.cBusq || !S.busquedas[UI.cBusq]) UI.cBusq=act[0]?.id||"";
    h+=`<div class="toolbar"><select id="f-cb" data-ui="cBusq" aria-label="Búsqueda">${act.map(b=>`<option value="${b.id}"${b.id===UI.cBusq?" selected":""}>${esc(b.cliente)} · ${esc(b.puesto)}</option>`).join("")}${UI.cBusq&&!act.find(b=>b.id===UI.cBusq)?`<option value="${UI.cBusq}" selected>${esc(S.busquedas[UI.cBusq]?.puesto)}</option>`:""}</select>
      ${UI.cBusq?`<button class="btn" data-act="addPost" data-id="${UI.cBusq}">Sumar candidato a esta búsqueda</button><button class="btn ghost" data-act="openBusqueda" data-id="${UI.cBusq}">Ver búsqueda</button>${xbtn("pipeline")}`:""}</div>`;
    if(!UI.cBusq) return h+`<div class="empty">No hay búsquedas activas.</div>`;
    const ps=postsOf(UI.cBusq);
    h+=boardHTML(ps);
    if(!ps.length) h+=`<div class="note">Esta búsqueda todavía no tiene candidatos cargados. Usá “Sumar candidato” para empezar el pipeline.</div>`;
  } else {
    let list=vals(S.candidatos);
    if(UI.cQ){ const q=keyN(UI.cQ); list=list.filter(c=>keyN([c.nombre,c.rolActual,c.empresaActual,c.area,c.seniority,(c.tags||[]).join(" "),c.notas].join(" ")).includes(q)); }
    list=sortBy(list,c=>c.creado||"",-1);
    h+=`<div class="toolbar"><input id="q-c" type="search" placeholder="Buscar por nombre, rol, área, empresa o etiqueta" data-ui="cQ" value="${esc(UI.cQ)}" style="flex:1;min-width:220px"><span class="muted">${list.length} candidatos</span>${xbtn("candidatos")}</div>`;
    h+= list.length? `<div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Rol / empresa</th><th>Área · seniority</th><th>Procesos</th><th>Etiquetas</th></tr></thead><tbody>
      ${list.slice(0,400).map(c=>{const ps=postsOfCand(c.id); const last=sortBy(ps,p=>p.fecha||"",-1)[0];
        return `<tr class="click" data-act="openCandidato" data-id="${c.id}"><td><b>${esc(c.nombre)}</b>${c.linkedin?`<div class="muted" style="font-size:12px">LinkedIn</div>`:""}</td><td>${esc(c.rolActual||"—")}<div class="muted">${esc(c.empresaActual||"")}</div></td><td>${esc([c.area,c.seniority].filter(Boolean).join(" · ")||"—")}</td><td>${ps.length} ${last?pillEtapa(last.etapa):""}</td><td>${(c.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join(" ")}</td></tr>`;}).join("")}
    </tbody></table></div>` : `<div class="empty">Sin resultados.</div>`;
  }
  return h;
}

// Kanban de una búsqueda: una columna por etapa. Cambiar el select mueve al candidato.
function boardHTML(ps){
  return `<div class="board">${ETAPAS.map(e=>{ const items=sortBy(ps.filter(p=>p.etapa===e),p=>p.fecha||"",-1);
    return `<div class="col"><div class="col-h"><span class="label">${e}</span><span class="cnt">${items.length}</span></div>
    ${items.map(p=>{const c=S.candidatos[p.candidatoId]||{}; const dE=days(trayecto(p).slice(-1)[0].fecha||p.fecha);
      return `<div class="mini" data-act="openCandidato" data-id="${p.candidatoId}"><b>${esc(c.nombre||"Candidato")}</b><span class="muted">${esc([c.rolActual,c.empresaActual].filter(Boolean).join(" · ")||"—")}</span>${p.etapa==="Descartado"&&p.motivo?`<span class="tag">${esc(p.motivo)}</span>`:""}${p.notas?`<span>${esc(p.notas)}</span>`:""}${dE!=null&&!["Contratado","Descartado"].includes(p.etapa)?`<span class="muted" style="font-size:11.5px">${dE} días en la etapa</span>`:""}
      <select data-post="${p.id}" aria-label="Etapa">${opt(ETAPAS,p.etapa)}</select></div>`;}).join("")}</div>`; }).join("")}</div>`;
}

// ================= SEGUIMIENTO DE BÚSQUEDAS =================
// Funnel en miniatura: cuántos candidatos llegaron a cada etapa
function miniFunnel(ps){
  const f=funnelData(ps), max=Math.max(1,f.filas[0].n);
  return `<span class="mf" title="${esc(f.filas.map(x=>`${x.e}: ${x.n}`).join(" · "))}">${f.filas.map(x=>`<i style="height:${x.n?Math.max(12,x.n/max*100):4}%"${x.n?"":' class="z"'}></i>`).join("")}</span>`;
}
function tablaSeguimiento(list){
  const rows=sortBy(list.map(b=>({b,sa:salud(b),ps:postsOf(b.id)})),r=>`${SALUD_ORD[r.sa.nivel]}${String(999-(days(r.b.fechaInicio)||0)).padStart(4,"0")}`);
  const tarjetas=`<div class="list solo-mob">${rows.map(({b,sa,ps})=>`<div class="segcard click" data-act="openBusqueda" data-id="${b.id}">
    <div class="segcard-top"><div style="min-width:0"><b>${esc(b.puesto)}</b><div class="muted">${esc(b.cliente)} · ${esc(b.recruiter||"—")}</div></div>${pillSalud(sa)||pillEstado(b.estado)}</div>
    ${sa.motivos.length?`<div class="muted" style="font-size:12.5px">${esc(sa.motivos.join(" · "))}</div>`:""}
    <div class="segcard-nums">${ps.length?miniFunnel(ps):""}<span><b class="num">${(b.estado==="Activa"?days(b.fechaInicio):ttf(b))??"—"}</b> días</span><span><b class="num">${ps.filter(p=>p.etapa!=="Descartado").length}</b> vivos</span><span><b class="num">${ps.filter(p=>alcance(p)>=3).length}</b> present.</span><span class="muted">${hace(days(ultimoMov(b,ps)))}</span></div>
    ${b.proximoPaso?`<div style="font-size:13px"><span class="muted">Próximo paso:</span> ${esc(b.proximoPaso)}</div>`:""}</div>`).join("")}</div>`;
  return tarjetas+`<details class="note"><summary>¿Cómo se calcula el semáforo?</summary>Semáforo: <b>en riesgo</b> si no hay movimiento hace más de 7 días, no se presentó terna a los 21 días o no quedan candidatos vivos · <b>atención</b> si no hay movimiento hace más de 4 días o quedan menos de 3 candidatos vivos. El funnel en miniatura muestra cuántos llegaron a cada etapa (Sourcing → Contratado).</details>
  <div class="tablewrap solo-desk"><table><thead><tr><th>Semáforo</th><th>Búsqueda</th><th>Recruiter</th><th class="r">Días</th><th>Funnel</th><th class="r">Vivos</th><th class="r">Presentados</th><th>Último movimiento</th><th>Próximo paso</th></tr></thead><tbody>
  ${rows.map(({b,sa,ps})=>{ const sm=days(ultimoMov(b,ps));
    return `<tr class="click" data-act="openBusqueda" data-id="${b.id}"><td>${pillSalud(sa)||pillEstado(b.estado)}${sa.motivos.length?`<div class="muted" style="font-size:12px;margin-top:3px">${esc(sa.motivos.join(" · "))}</div>`:""}</td>
    <td><b>${esc(b.puesto)}</b><div class="muted">${esc(b.cliente)}</div></td><td>${esc(b.recruiter||"—")}</td><td class="r num">${(b.estado==="Activa"?days(b.fechaInicio):ttf(b))??"—"}</td>
    <td>${ps.length?miniFunnel(ps):'<span class="muted">—</span>'}</td><td class="r num">${ps.filter(p=>p.etapa!=="Descartado").length}</td><td class="r num">${ps.filter(p=>alcance(p)>=3).length}</td>
    <td class="num">${hace(sm)}</td><td style="max-width:280px">${esc(b.proximoPaso||"—")}</td></tr>`; }).join("")}
  </tbody></table></div>`;
}
// Tiempo promedio en cada etapa (días), a partir del historial de etapas
function tiemposEtapa(ps){
  const acc={};
  ps.forEach(p=>{ const t=trayecto(p); t.forEach((x,i)=>{ if(["Contratado","Descartado"].includes(x.etapa)||!x.fecha) return; const hasta=t[i+1]?t[i+1].fecha:today(); if(!hasta) return; const d=days(x.fecha,hasta); if(d==null||d<0) return; (acc[x.etapa] ||= []).push(d); }); });
  return ETAPAS.slice(0,6).filter(e=>acc[e]).map(e=>({e,n:acc[e].length,prom:acc[e].reduce((a,b)=>a+b,0)/acc[e].length}));
}
// Descartes: por motivo y etapa en la que quedaron afuera
function descartes(ps){
  const ds=ps.filter(p=>p.etapa==="Descartado"), mot={}, eta={};
  ds.forEach(p=>{ mot[p.motivo||"Sin motivo cargado"]=(mot[p.motivo||"Sin motivo cargado"]||0)+1; const e=ETAPAS[alcance(p)]; eta[e]=(eta[e]||0)+1; });
  return {n:ds.length,mot:Object.entries(mot).sort((a,b)=>b[1]-a[1]),eta:ETAPAS.filter(e=>eta[e]).map(e=>[e,eta[e]])};
}
function barras(rows,fmt=v=>v){ const max=Math.max(1,...rows.map(r=>r[1])); return rows.map(([l,v,extra])=>`<div class="bar"><span>${esc(l)}</span><div class="track"><i style="width:${Math.max(2,v/max*100)}%"></i></div><span class="num muted">${fmt(v)}${extra||""}</span></div>`).join(""); }

function vFicha(){
  const b=S.busquedas[UI.fichaId];
  if(!b) return `<div class="head"><div><a href="#busquedas">← Búsquedas</a><h1>Búsqueda</h1></div></div><div class="empty">${!B().length?"Cargando…":"No se encontró esta búsqueda. Puede que la hayan eliminado."}</div>`;
  const ps=postsOf(b.id), sa=salud(b), vivos=ps.filter(p=>p.etapa!=="Descartado"), pres=ps.filter(p=>alcance(p)>=3);
  const d=b.estado==="Activa"?days(b.fechaInicio):ttf(b), sm=days(ultimoMov(b,ps));
  const terna=b.fechaPrimeraTerna?`${fd(b.fechaPrimeraTerna)}`:pres.length?"Sí":"Pendiente";
  const dTerna=b.fechaPrimeraTerna&&b.fechaInicio?days(b.fechaInicio,b.fechaPrimeraTerna):null;
  const ti=tiemposEtapa(ps), de=descartes(ps);
  let h=`<div class="head"><div><a href="#busquedas" class="muted" style="font-size:13px">← Búsquedas</a><h1>${esc(b.puesto)}</h1>
    <p class="keep" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${esc(b.cliente)} · ${b.recruiter&&(canFin||keyN(b.recruiter)===keyN(miNombreRec()))?`<a href="#recruiter/${encodeURIComponent(b.recruiter)}">${esc(b.recruiter)}</a>`:esc(b.recruiter||"Sin recruiter")}${b.prioridad?` · Prioridad ${esc(b.prioridad)}`:""} ${pillEstado(b.estado)} ${pillSalud(sa)}</p></div>
    <div class="toolbar"><button class="btn" data-act="weeklyUpdate" data-id="${b.id}">Actualizar</button><button class="btn" data-act="addPost" data-id="${b.id}">Sumar candidato</button><button class="btn" data-act="editBusqueda" data-id="${b.id}">Editar</button><button class="btn" data-act="repCliente" data-id="${b.id}">Reporte PDF</button><button class="btn lemon" data-act="linkCliente" data-id="${b.id}">Link para el cliente</button></div></div>`;
  if(sa.motivos.length) h+=`<div class="panel cal ${sa.nivel}"><b>${SALUD_LAB[sa.nivel]}</b><span>${esc(sa.motivos.map(m=>m[0].toUpperCase()+m.slice(1)).join(" · "))}.</span></div>`;
  h+=`<div class="kpis">${kpi(b.estado==="Activa"?"Días en curso":"Duración",d??"—",b.fechaInicio?`inicio ${fd(b.fechaInicio)}`:"")}${kpi("Candidatos",ps.length,`${vivos.length} vivos · ${de.n} descartados`)}${kpi("Presentados al cliente",pres.length,`primera terna: ${terna}${dTerna!=null?` (día ${dTerna})`:""}`)}${kpi("Último movimiento",hace(sm),ultimoMov(b,ps)?fd(ultimoMov(b,ps)):"")}</div>`;
  h+=`<div class="grid2"><section class="panel"><div class="panel-head"><h2>Funnel</h2><span class="muted">cuántos llegaron a cada etapa</span></div>${ps.length?funnelHTML(ps,""):`<div class="muted">Todavía no hay candidatos. Usá “Sumar candidato” para empezar.</div>`}</section>
    <section class="panel"><div class="panel-head"><h2>Estado</h2><button class="btn sm" data-act="weeklyUpdate" data-id="${b.id}">Actualizar</button></div>
    ${b.detalle?`<p><span class="label">Estado actual</span><br>${esc(b.detalle)}</p>`:""}${b.proximoPaso?`<p><span class="label">Próximo paso</span><br>${esc(b.proximoPaso)}</p>`:""}${!b.detalle&&!b.proximoPaso?`<p class="muted">Sin novedades cargadas.</p>`:""}
    <span class="label">Bitácora</span>${(b.bitacora||[]).length?`<div class="log">${sortBy(b.bitacora,x=>x.fecha,-1).slice(0,6).map(x=>`<div><small>${fd(x.fecha)} · ${esc(authorName(x.autor))}</small>${esc(x.texto)}</div>`).join("")}</div>`:`<div class="muted" style="font-size:13px">Sin entradas todavía.</div>`}</section></div>`;
  h+=`<section class="panel"><div class="panel-head"><h2>Pipeline</h2><span style="display:flex;gap:6px">${xbtnFicha(b.id)}<button class="btn sm" data-act="addPost" data-id="${b.id}">Sumar candidato</button></span></div>${ps.length?boardHTML(ps):`<div class="muted">Sin candidatos en el pipeline.</div>`}</section>`;
  h+=`<div class="grid2"><section class="panel"><div class="panel-head"><h2>Tiempo por etapa</h2><span class="muted">promedio en días</span></div>${ti.length?barras(ti.map(x=>[x.e,Math.round(x.prom),` · ${x.n}`]),v=>`${v} d`)+`<div class="muted" style="font-size:12px">Promedio de días que pasan los candidatos en cada etapa (y cuántos se midieron). Se vuelve más preciso a medida que se registran los cambios de etapa.</div>`:`<div class="muted">Todavía no hay cambios de etapa registrados.</div>`}</section>
    <section class="panel"><div class="panel-head"><h2>Descartes</h2><span class="muted">${de.n} en total</span></div>${de.n?`<span class="label">Por motivo</span>${barras(de.mot)}<span class="label">Etapa en la que quedaron afuera</span>${barras(de.eta)}`:`<div class="muted">No hay candidatos descartados.</div>`}</section></div>`;
  return h;
}
const xbtnFicha = id => `<button class="btn sm ghost" data-act="pipeFicha" data-id="${id}">Exportar</button>`;

// Elegir motivo antes de descartar
function drawerDescarte(pid){
  const p=S.postulaciones[pid]; if(!p) return; const c=S.candidatos[p.candidatoId]||{}, b=S.busquedas[p.busquedaId]||{};
  openDrawer("Descartar candidato",`${esc(c.nombre||"Candidato")} · ${esc(b.puesto||"")}`,`<div class="form">${fsel("Motivo","ds-m",["",...MOTIVOS_DESC],p.motivo||"","full")}${farea("Nota (opcional)","ds-n",p.motivoDetalle||"")}</div>
    <div class="note">Queda registrado en qué etapa estaba (${esc(p.etapa)}) para las estadísticas de la búsqueda.</div>`,{save:{label:"Descartar"}});
  drawerSave.save.fn=async()=>{ const m=gv("ds-m"); if(!m){ toast("Elegí el motivo del descarte.",true); return; }
    if(await write("postulaciones/"+pid,{etapa:"Descartado",motivo:m,motivoDetalle:gv("ds-n"),fecha:today()},"update")){ toast("Candidato descartado"); closeDrawer(); } };
}

// Link privado de solo lectura para el cliente
async function drawerLink(bid){
  const b=S.busquedas[bid]; if(!b) return;
  let l=null; try{ l=await api("/api/links/"+encodeURIComponent(bid)); }catch(e){ if(e.code!==401) toast(e.message||"No se pudo cargar el link.",true); return; }
  const url=l?`${location.origin}/c/${l.token}`:"";
  const body=`<div class="note">El cliente ve, sin iniciar sesión: estado, días en curso, el funnel (cantidades por etapa), los candidatos presentados (nombre, rol y empresa) y los textos de abajo. No ve montos, notas internas, contactos de candidatos ni el semáforo.</div>
  ${l?`<div class="section"><span class="label">Link activo</span><div class="row"><input id="lk-url" type="text" readonly value="${esc(url)}" style="flex:1"><button class="btn sm" data-act="copyLink">Copiar</button></div>
    <div class="muted" style="font-size:12px">${l.vistas?`Abierto ${l.vistas} ${l.vistas===1?"vez":"veces"} · última ${new Date(l.ultimaVista).toLocaleString("es-AR")}`:"Todavía no lo abrieron."}</div>
    <div><button class="btn sm danger" data-act="unlinkCliente" data-id="${bid}">Desactivar link</button></div></div>`:""}
  <div class="form">${farea("Estado de la búsqueda (lo lee el cliente)","lk-res",l?l.resumen:(b.detalle||""))}${farea("Próximos pasos","lk-pp",l?l.proximos:(b.proximoPaso||""))}
  <label class="check full"><input id="lk-cand" type="checkbox"${!l||l.mostrarCandidatos?" checked":""}> Mostrar candidatos presentados</label></div>`;
  openDrawer("Link para el cliente",`${esc(b.puesto)} · ${esc(b.cliente)}`,body,{save:{label:l?"Guardar cambios":"Crear link"}});
  drawerSave.save.fn=async()=>{
    try{ await api("/api/links/"+encodeURIComponent(bid),{method:"POST",body:JSON.stringify({resumen:gv("lk-res"),proximos:gv("lk-pp"),mostrarCandidatos:gv("lk-cand")})}); toast(l?"Link actualizado":"Link creado"); drawerLink(bid); }
    catch(e){ if(e.code!==401) toast(e.message||"No se pudo guardar.",true); }
  };
}

// ================= RECRUITERS =================
// Nombre de recruiter del usuario logueado (lo resuelve el servidor contra Equipo)
const miNombreRec = () => S.yoRec || me.nombre || "";
const esDe = (b,n) => keyN(b.recruiter)===keyN(n);
function rangoPer(per){
  if(per==="todo") return {s:"0000-01-01",e:"9999-12-31",lab:"Todo el historial"};
  if(/^\d{4}$/.test(per)) return {s:`${per}-01-01`,e:`${per}-12-31`,lab:per};
  return {s:addDays(today(),-365),e:today(),lab:"Últimos 12 meses"};
}
const enR = (d,r) => !!d && d>=r.s && d<=r.e;
const prom = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : null;
function statsRec(n,r){
  const mine=B().filter(b=>esDe(b,n)), act=mine.filter(b=>b.estado==="Activa");
  const ini=mine.filter(b=>enR(b.fechaInicio,r)), cerr=mine.filter(b=>b.estado==="Cerrada"&&enR(b.fechaCierre,r)), canc=mine.filter(b=>b.estado==="Cancelada"&&enR(b.fechaCierre,r));
  const ttfA=prom(cerr.map(ttf).filter(x=>x!=null)), terna=prom(ini.filter(b=>b.fechaPrimeraTerna&&b.fechaInicio).map(b=>days(b.fechaInicio,b.fechaPrimeraTerna)).filter(x=>x>=0));
  const pres=ini.length?ini.reduce((s,b)=>s+postsOf(b.id).filter(p=>alcance(p)>=3).length,0)/ini.length:null;
  const cap=(recruiters().find(x=>keyN(x.nombre)===keyN(n))||{}).capacidad||null;
  return {n,mine,act,ini,cerr,canc,ttfA,terna,pres,cap,exito:(cerr.length+canc.length)?cerr.length/(cerr.length+canc.length):null,riesgo:act.filter(b=>salud(b).nivel==="crit")};
}
function selPer(){
  const per=UI.recPer||"12m", ys=uniq(B().map(b=>(b.fechaInicio||"").slice(0,4))).filter(Boolean).sort().reverse().slice(0,4);
  return `<div class="seg" role="group" aria-label="Período">${[["12m","12 meses"],...ys.map(y=>[y,y]),["todo","Todo"]].map(([v,l])=>`<button data-act="recPer" data-v="${v}" aria-pressed="${per===v}">${l}</button>`).join("")}</div>`;
}
const fmtD = v => v==null ? "—" : nf0.format(v)+" d";
function vRecruiters(){
  if(!canFin){ UI.recNom=miNombreRec(); return vRecruiter(); }
  const r=rangoPer(UI.recPer), o=obj();
  const rows=sortBy(recruiters().map(x=>({...statsRec(x.nombre,r),activa:x.activa})),x=>`${x.activa?0:1}${String(99-x.act.length).padStart(2,"0")}`);
  const comPend=n=>vals(S.facturas).filter(f=>esDe(f,n)&&f.comision>0&&!f.comisionPagada);
  let h=`<div class="head"><div><h1>Equipo</h1><p>Carga, resultados y comisiones de cada recruiter. Tocá una para ver el detalle.</p></div><div class="toolbar">${selPer()}<button class="btn" data-act="editEquipo">Editar equipo</button></div></div>`;
  h+=`<div class="tablewrap solo-desk"><table><thead><tr><th>Recruiter</th><th class="r">Activas</th><th class="r">En riesgo</th><th class="r">Iniciadas</th><th class="r">Cerradas</th><th class="r">Éxito</th><th class="r">Time to fill</th><th class="r">1ª terna</th><th class="r">Comisiones pendientes</th></tr></thead><tbody>
  ${rows.map(x=>{ const cp=comPend(x.n); return `<tr class="click" data-act="openRecruiter" data-id="${esc(x.n)}"><td><b>${esc(x.n)}</b>${x.activa?"":' <span class="tag">inactiva</span>'}</td><td class="r num">${x.act.length}${x.cap?` / ${x.cap}`:""}</td><td class="r num">${x.riesgo.length?`<span class="pill crit">${x.riesgo.length}</span>`:"0"}</td><td class="r num">${x.ini.length}</td><td class="r num">${x.cerr.length}</td><td class="r num">${pct(x.exito)}</td><td class="r num">${fmtD(x.ttfA)}</td><td class="r num">${fmtD(x.terna)}</td><td class="r num">${cp.length?`${sumMon(cp)} · ${cp.length}`:"—"}</td></tr>`; }).join("")}
  </tbody></table></div>
  <div class="list solo-mob">${rows.map(x=>`<div class="segcard click" data-act="openRecruiter" data-id="${esc(x.n)}"><div class="segcard-top"><b>${esc(x.n)}</b>${x.riesgo.length?`<span class="pill crit">${x.riesgo.length} en riesgo</span>`:x.activa?"":'<span class="tag">inactiva</span>'}</div>
    <div class="segcard-nums"><span><b class="num">${x.act.length}${x.cap?"/"+x.cap:""}</b> activas</span><span><b class="num">${x.cerr.length}</b> cerradas</span><span><b class="num">${fmtD(x.ttfA)}</b> TTF</span><span><b class="num">${pct(x.exito)}</b> éxito</span></div></div>`).join("")}</div>
  <div class="note">Período: ${r.lab}. Éxito = cerradas / (cerradas + canceladas). Time to fill objetivo: ${o.timeToFillDias} días.</div>`;
  return h;
}
// Suma de comisiones por moneda: "$ 1.200.000 + US$ 300"
function sumMon(list){ const a=list.filter(f=>f.monedaComision!=="USD").reduce((s,f)=>s+(f.comision||0),0), u=list.filter(f=>f.monedaComision==="USD").reduce((s,f)=>s+(f.comision||0),0); return [a?ars(a):"",u?usd(u):""].filter(Boolean).join(" + ")||ars(0); }
function vRecruiter(){
  let n=UI.recNom||miNombreRec();
  if(!canFin) n=miNombreRec();
  const r=rangoPer(UI.recPer), o=obj(), st=statsRec(n,r);
  const equipo=recActivos().map(x=>statsRec(x.nombre,r)), ttfEq=prom(equipo.map(x=>x.ttfA).filter(x=>x!=null));
  // Comisiones: socios y administradora las calculan de las facturas; una recruiter las pide al servidor (solo las suyas)
  let com=null;
  if(canFin) com=vals(S.facturas).filter(f=>esDe(f,n)&&f.comision>0);
  else { const c=S.misCom; if(c&&c.recruiter===n) com=c.list; else if(!S.misComCargando){ S.misComCargando=1; api("/api/recruiter/comisiones").then(j=>{ S.misCom={recruiter:j.recruiter,list:j.comisiones}; S.misComCargando=0; schedule(); }).catch(()=>{S.misComCargando=0;}); } }
  const comR=com?com.filter(f=>enR(f.fechaEmision,r)||(!f.comisionPagada)):[];
  const pend=comR.filter(f=>!f.comisionPagada), pag=comR.filter(f=>f.comisionPagada);
  const fact=canFin?vals(S.facturas).filter(f=>esDe(f,n)&&enR(f.fechaEmision,r)):[];
  let h=`<div class="head"><div>${canFin?`<a href="#recruiters" class="muted" style="font-size:13px">← Equipo</a>`:""}<h1>${esc(n)}</h1><p class="keep">${st.act.length} ${st.act.length===1?"búsqueda activa":"búsquedas activas"}${st.cap?` de ${st.cap} de capacidad`:""} · ${r.lab}</p></div>${selPer()}</div>`;
  if(st.riesgo.length) h+=`<div class="panel cal crit"><b>${st.riesgo.length} ${st.riesgo.length===1?"búsqueda en riesgo":"búsquedas en riesgo"}</b><span>${st.riesgo.map(b=>`<a href="#busqueda/${encodeURIComponent(b.id)}">${esc(b.puesto)} · ${esc(b.cliente)}</a>`).join(" · ")}</span></div>`;
  h+=`<div class="kpis">${kpi("Activas",st.act.length,st.cap?`capacidad ${st.cap}`:"",st.cap?st.act.length/st.cap:null)}${kpi("Iniciadas",st.ini.length,r.lab)}${kpi("Cerradas",st.cerr.length,`${st.canc.length} canceladas · éxito ${pct(st.exito)}`)}${kpi("Time to fill",fmtD(st.ttfA),`equipo ${fmtD(ttfEq)} · objetivo ${o.timeToFillDias} d`)}${kpi("Primera terna",fmtD(st.terna),"promedio desde el inicio")}${kpi("Presentados por búsqueda",st.pres==null?"—":nf1.format(st.pres),"candidatos que llegaron al cliente")}${canFin?kpi("Facturación generada",usd(fact.reduce((s,f)=>s+fcUSD(f),0)),`${fact.length} facturas`):""}</div>`;
  // Tendencia mensual
  const meses=r.lab==="Últimos 12 meses"?lastMonths(12):r.lab==="Todo el historial"?lastMonths(24):monthsOfYear(+r.s.slice(0,4));
  const tr=meses.map(k=>({label:fm(k),a:st.mine.filter(b=>ym(b.fechaInicio)===k).length,b:st.mine.filter(b=>b.estado==="Cerrada"&&ym(b.fechaCierre)===k).length,ttf:prom(st.mine.filter(b=>b.estado==="Cerrada"&&ym(b.fechaCierre)===k).map(ttf).filter(x=>x!=null))}));
  const conTtf=tr.filter(x=>x.ttf!=null);
  h+=`<div class="grid2"><section class="panel"><div class="panel-head"><h2>Tendencia</h2><span class="muted">por mes</span></div>${barChart(tr,{la:"Iniciadas",lb:"Cerradas",fmt:v=>nf0.format(v),h:200})}</section>
  <section class="panel"><div class="panel-head"><h2>Time to fill por mes</h2><span class="muted">búsquedas cerradas</span></div>${conTtf.length?barras(conTtf.map(x=>[x.label,Math.round(x.ttf)]),v=>`${v} d`):'<div class="muted">Sin cierres en el período.</div>'}</section></div>`;
  // Funnel y clientes
  const psR=st.ini.flatMap(b=>postsOf(b.id));
  const cli={}; st.mine.forEach(b=>{ const c=cli[b.cliente||"—"] ||= {n:b.cliente||"—",tot:0,act:0,cerr:0,ult:""}; c.tot++; if(b.estado==="Activa") c.act++; if(b.estado==="Cerrada") c.cerr++; if((b.fechaInicio||"")>c.ult) c.ult=b.fechaInicio; });
  const cl=sortBy(vals(cli),c=>c.ult,-1);
  h+=`<div class="grid2"><section class="panel"><div class="panel-head"><h2>Funnel</h2><span class="muted">búsquedas iniciadas en el período</span></div>${psR.length?funnelHTML(psR,""):'<div class="muted">Sin candidatos cargados en el período.</div>'}</section>
  <section class="panel"><div class="panel-head"><h2>Clientes</h2><span class="muted">${cl.length}</span></div>${cl.length?`<div class="list">${cl.slice(0,15).map(c=>`<div class="row"><div class="grow"><b>${esc(c.n)}</b><div class="muted" style="font-size:12px">última búsqueda ${fd(c.ult)}</div></div><span class="num muted" style="font-size:12.5px;text-align:right">${c.tot} búsq.${c.act?` · ${c.act} activa${c.act>1?"s":""}`:""}${c.cerr?` · ${c.cerr} cerrada${c.cerr>1?"s":""}`:""}</span></div>`).join("")}</div>`:'<div class="muted">Sin clientes.</div>'}</section></div>`;
  // Comisiones
  h+=`<section class="panel"><div class="panel-head"><h2>Comisiones</h2><span class="muted">pendientes y pagadas en el período</span></div>`;
  if(!com) h+=`<div class="muted">Cargando…</div>`;
  else{
    // Una tarjeta por moneda: pesos y dólares no se suman ni se amontonan en una línea
    const mon=(l,m)=>l.filter(f=>(f.monedaComision==="USD")===(m==="USD")), tot=l=>l.reduce((s,f)=>s+(f.comision||0),0), cant=l=>`${l.length} ${l.length===1?"factura":"facturas"}`;
    const cards=[["Pendiente en pesos",mon(pend,"ARS"),ars],["Pendiente en dólares",mon(pend,"USD"),usd],["Pagado en pesos",mon(pag,"ARS"),ars],["Pagado en dólares",mon(pag,"USD"),usd]].filter(([,l],i)=>l.length||i===0||i===2);
    h+=`<div class="kpis">${cards.map(([t,l,f])=>kpi(t,f(tot(l)),t.startsWith("Pagado")?`${cant(l)} · ${r.lab.toLowerCase()}`:cant(l))).join("")}</div>`;
    const lista=sortBy([...pend,...pag],f=>`${f.comisionPagada?1:0}${f.fechaEmision||""}`);
    h+=lista.length?`<div class="list">${lista.slice(0,40).map(f=>`<div class="row${canFin?" click":""}"${canFin?` data-act="openFactura" data-id="${f.id}"`:""}><div class="grow" style="min-width:0"><b>${esc(f.cliente||"")}</b><div class="muted" style="font-size:12px">${esc(f.concepto||"")}${f.fechaEmision?` · emitida ${fd(f.fechaEmision)}`:" · sin fecha de emisión"}</div></div><div style="text-align:right;flex:none"><div class="num">${money(f.comision,f.monedaComision)}</div>${f.comisionPagada?`<span class="pill ok">Pagada${f.fechaPagoComision?" "+fd(f.fechaPagoComision):""}</span>`:'<span class="pill warn">Pendiente</span>'}</div></div>`).join("")}</div>`:`<div class="muted">No hay comisiones en el período.</div>`;
  }
  h+=`</section>`;
  // Búsquedas
  const fb=UI.recB||"activas", lb=sortBy(st.mine.filter(b=>fb==="todas"||(fb==="activas"?["Activa","En pausa"].includes(b.estado):fb==="cerradas"?["Cerrada","Cancelada"].includes(b.estado):true)),b=>b.fechaInicio||"",-1);
  h+=`<section class="panel"><div class="panel-head"><h2>Búsquedas</h2><div class="seg" role="group">${[["activas","Abiertas"],["cerradas","Terminadas"],["todas","Todas"]].map(([v,l])=>`<button data-act="recB" data-v="${v}" aria-pressed="${fb===v}">${l}</button>`).join("")}</div></div>
  ${lb.length?`<div class="list">${lb.slice(0,200).map(b=>{ const sa=salud(b); return `<div class="row click" data-act="openBusqueda" data-id="${b.id}"><div class="grow" style="min-width:0"><b>${esc(b.puesto)}</b><div class="muted" style="font-size:12px">${esc(b.cliente)} · inicio ${fd(b.fechaInicio)}${b.fechaCierre?" · cierre "+fd(b.fechaCierre):""}</div></div><div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:3px">${pillSalud(sa)||pillEstado(b.estado)}<span class="num muted" style="font-size:12px">${b.estado==="Activa"?`${days(b.fechaInicio)??"—"} días`:ttf(b)!=null?`TTF ${ttf(b)} d`:""}</span></div></div>`; }).join("")}</div>`:'<div class="muted">No hay búsquedas en esta vista.</div>'}</section>`;
  return h;
}

// ================= CRM =================
function vCrm(){
  let h=`<div class="head"><div><h1>Clientes y leads</h1><p>Pipeline comercial y cartera de clientes.</p></div>
  <div class="toolbar"><div class="seg" role="group"><button data-act="crmTab" data-v="leads" aria-pressed="${UI.crmTab==="leads"}">Leads</button><button data-act="crmTab" data-v="clientes" aria-pressed="${UI.crmTab==="clientes"}">Clientes</button></div>
  <button class="btn lemon" data-act="${UI.crmTab==="leads"?"newLead":"newCliente"}">${UI.crmTab==="leads"?"Nuevo lead":"Nuevo cliente"}</button></div></div>`;
  const L=vals(S.leads); const k=curYM();
  const nuevosMes=L.filter(l=>ym(l.fechaPrimerContacto)===k).length;
  const prop=L.filter(l=>l.etapa==="Propuesta enviada").length;
  const ganMes=L.filter(l=>l.etapa==="Ganado"&&ym(l.fechaUltimoContacto||l.fechaPrimerContacto)===k).length;
  const o=obj(); const cs=clienteStats();
  h+=`<div class="kpis">${kpi("Leads nuevos "+fm(k),nuevosMes,"primer contacto este mes")}${kpi("Propuestas abiertas",prop,`objetivo ${o.propuestasMes} por mes`)}${kpi("Ganados "+fm(k),ganMes,`objetivo ${o.nuevosClientesMes} clientes nuevos`)}${kpi("Clientes activos",cs.filter(c=>c.estado==="Activo").length,`${cs.filter(c=>c.estado==="Reciente").length} con búsqueda en los últimos 6 meses`)}</div>`;
  if(UI.crmTab==="leads"){
    let list=L; if(UI.lQ){const q=keyN(UI.lQ); list=list.filter(l=>keyN([l.empresa,l.contacto,l.cargo,l.notas].join(" ")).includes(q));}
    h+=`<div class="toolbar"><input id="q-l" type="search" placeholder="Buscar empresa o contacto" data-ui="lQ" value="${esc(UI.lQ)}" style="flex:1;min-width:220px">${xbtn("leads")}</div>`;
    h+=`<div class="board">${ETAPAS_LEAD.map(e=>{ const it=sortBy(leadsCol(list,e),l=>l.fechaUltimoContacto||l.fechaPrimerContacto||"",-1);
      return `<div class="col"><div class="col-h"><span class="label">${e}</span><span class="cnt">${it.length}</span></div>${it.slice(0,60).map(l=>{const dl=days(l.fechaUltimoContacto||l.fechaPrimerContacto); const due=l.proximoSeguimiento&&l.proximoSeguimiento<=today();
        return `<div class="mini" data-act="openLead" data-id="${l.id}"><b>${esc(l.empresa)}</b><span class="muted">${esc([l.contacto,l.cargo].filter(Boolean).join(" · ")||"—")}</span>
        <span style="display:flex;gap:6px;flex-wrap:wrap">${dl!=null?`<span class="tag">hace ${dl} d</span>`:""}${l.canal?`<span class="tag">${esc(l.canal)}</span>`:""}${due?`<span class="pill warn">seguir</span>`:""}${(l.contactos||[]).length>1?`<span class="tag">${l.contactos.length} contactos</span>`:""}${l.motivoPerdida?`<span class="tag">${esc(l.motivoPerdida)}</span>`:""}${l.reactivar&&l.reactivar<=today()?`<span class="pill lemon">reactivar</span>`:""}</span></div>`;}).join("")}${it.length>60?`<span class="muted" style="font-size:12px;padding:4px">+${it.length-60} más (usá la búsqueda)</span>`:""}</div>`;}).join("")}</div><div class="note">Ganados: últimos 30 días (después quedan en Clientes). Perdidos: últimos 90 días o con fecha de reactivación cumplida. Usá la búsqueda para ver todos.</div>`;
  } else {
    const list=sortBy(cs,c=>c.fact,-1);
    h+=`<div class="toolbar">${xbtn("clientes")}</div><div class="tablewrap"><table><thead><tr><th>Cliente</th><th>Estado</th><th>ICP</th><th class="r">Búsquedas</th><th class="r">Activas</th><th class="r">Facturado (US$ eq.)</th><th class="r">Ticket prom.</th><th>Propuesta / contrato</th><th>Fee acordado</th><th>Última búsqueda</th></tr></thead><tbody>
    ${list.map(c=>`<tr class="click" data-act="openCliente" data-id="${esc(c.k)}"><td><b>${esc(c.nombre)}</b></td><td><span class="pill ${c.estado==="Activo"?"ok":c.estado==="Reciente"?"info":""}">${c.estado}</span></td><td>${esc(c.doc?.icp||"—")}</td><td class="r num">${c.total}</td><td class="r num">${c.act||"—"}</td><td class="r num">${usd(c.fact)}</td><td class="r num">${c.ticket?usd(c.ticket):"—"}</td><td>${docPill(c.nombre,c.act>0)}</td><td>${esc(c.doc?.feeAcordado||"—")}</td><td class="num">${fd(c.last)}</td></tr>`).join("")}
    </tbody></table></div><div class="note">Facturado incluye facturas desde dic-2024 y montos históricos tomados de la planilla de Gestión Procesos. Convertido a dólares con el tipo de cambio del mes de emisión.</div>`;
  }
  return h;
}

// ================= COBROS =================
function vCobros(){
  const F=vals(S.facturas);
  const pend=F.filter(f=>!f.cobrada);
  const pARS=pend.filter(f=>f.moneda!=="USD").reduce((s,f)=>s+f.monto,0), pUSD=pend.filter(f=>f.moneda==="USD").reduce((s,f)=>s+f.monto,0);
  const venc=pend.filter(f=>days(f.fechaEmision)>30);
  const k=curYM();
  const com=F.filter(f=>!f.comisionPagada&&f.comision>0);
  const cARS=com.filter(f=>f.monedaComision!=="USD").reduce((s,f)=>s+f.comision,0), cUSD=com.filter(f=>f.monedaComision==="USD").reduce((s,f)=>s+f.comision,0);
  const emitMes=F.filter(f=>!f.historico&&ym(f.fechaEmision)===k);
  const emitUSD=emitMes.reduce((s,f)=>s+fcUSD(f),0), cobUSD=emitMes.filter(f=>f.cobrada).reduce((s,f)=>s+fcUSD(f),0);
  const tabs=[["pendientes",`Por cobrar <span class="muted num">${pend.length}</span>`],["cobradas","Cobradas"],["comisiones",`Comisiones <span class="muted num">${com.length}</span>`],["gastos","Gastos"],["resultados","Resultados"],["todas","Todas las facturas"]];
  let h=`<div class="head"><div><h1>Finanzas</h1><p>Facturas, cobranza, comisiones, gastos y resultados.</p></div>${UI.fTab==="gastos"?`<button class="btn lemon" data-act="newGasto">Nuevo gasto</button>`:UI.fTab==="resultados"?"":`<button class="btn lemon" data-act="newFactura">Nueva factura</button>`}</div>
  <div class="toolbar"><div class="seg" role="group" aria-label="Vista">${tabs.map(([v,l])=>`<button data-act="fTab" data-v="${v}" aria-pressed="${UI.fTab===v}">${l}</button>`).join("")}</div>${!["gastos","resultados"].includes(UI.fTab)?xbtn("facturas"):""}</div>`;
  if(UI.fTab==="gastos") return h+vGastos();
  if(UI.fTab==="resultados") return h+`<div class="subview">${vEconomics()}</div>`;
  h+=`<div class="kpis">${kpi("Por cobrar",`${short(pARS)} <span class="muted" style="font-size:14px">ARS</span>`,`${usd(pUSD)} · ${pend.length} facturas`)}
  ${kpi("Vencidas (+30 días)",venc.length,venc.length?`${ars(venc.reduce((s,f)=>s+fcARS(f),0))} ARS eq.`:"al día")}
  ${kpi("Cobrado de lo emitido en "+fm(k),emitUSD?pct(cobUSD/emitUSD):"—",`${usd(cobUSD)} de ${usd(emitUSD)}`, emitUSD?cobUSD/emitUSD:null)}
  ${kpi("Comisiones a pagar",ars(cARS),`${usd(cUSD)} · ${com.length} facturas`)}</div>`;
  if(UI.fTab==="comisiones"){
    const pag=sortBy(F.filter(f=>f.comisionPagada&&f.comision>0),f=>f.fechaPagoComision||"",-1).slice(0,30);
    h+=`<section class="panel"><div class="panel-head"><h2>Comisiones a pagar</h2><span class="muted">${com.length}</span></div>${com.length?listaFacturas(sortBy(com,f=>f.fechaEmision||"",-1),"com"):`<div class="muted">No hay comisiones pendientes.</div>`}</section>
    <section class="panel"><div class="panel-head"><h2>Pagadas</h2><span class="muted">últimas ${pag.length}</span></div>${pag.length?listaFacturas(pag,"com"):`<div class="muted">Todavía no se marcó ninguna como pagada.</div>`}</section>`;
    return h;
  }
  let list = UI.fTab==="pendientes"?pend : UI.fTab==="cobradas"?sortBy(F.filter(f=>f.cobrada),f=>f.fechaCobro||"",-1) : F;
  if(UI.fTab!=="cobradas") list=sortBy(list,f=>f.fechaEmision||"9999",-1);
  if(!list.length) return h+`<div class="empty">${UI.fTab==="pendientes"?"No hay facturas pendientes de cobro.":"Sin facturas en esta vista."}</div>`;
  return h+`<div class="note solo-desk">Tocá una factura para editarla. Si marcaste algo por error, usá <b>Deshacer</b> en la misma fila.</div>`+listaFacturas(list.slice(0,300),"cobro");
}
// Estado de cobro y de comisión, cada uno con su acción para marcar o deshacer
function cobroCell(f){ const dd=days(f.fechaEmision);
  return f.cobrada ? `<span class="pill ok">Cobrada${f.fechaCobro?" "+fd(f.fechaCobro):""}</span> <button class="btn sm ghost" data-act="unCobrada" data-id="${f.id}">Deshacer</button>`
    : `<span class="pill ${dd>30?"crit":"warn"}">${dd??"—"} ${dd===1?"día":"días"}</span> <button class="btn sm" data-act="markCobrada" data-id="${f.id}">Marcar cobrada</button>`; }
function comCell(f){ if(!(f.comision>0)) return `<span class="muted">—</span>`;
  return `<span class="num">${money(f.comision,f.monedaComision)}</span> ${f.comisionPagada?`<span class="pill ok">Pagada${f.fechaPagoComision?" "+fd(f.fechaPagoComision):""}</span> <button class="btn sm ghost" data-act="unComision" data-id="${f.id}">Deshacer</button>`:`<span class="pill warn">Pendiente</span> <button class="btn sm" data-act="markComision" data-id="${f.id}">Marcar pagada</button>`}`; }
function listaFacturas(list,modo){
  const tabla=`<div class="tablewrap solo-desk"><table><thead><tr><th>Emisión</th><th>Cliente</th><th>Concepto</th><th class="r">Monto</th>${modo==="com"?"<th>Recruiter</th><th>Comisión</th>":"<th>Cobro</th><th>Comisión</th>"}</tr></thead><tbody>
  ${list.map(f=>`<tr class="click" data-act="openFactura" data-id="${f.id}"><td class="num">${fd(f.fechaEmision)}</td><td>${esc(f.cliente)}</td><td>${esc(f.concepto)}<div class="muted" style="font-size:12px">${esc([f.tipo,f.emisor,f.historico?"histórico":""].filter(Boolean).join(" · "))}</div></td><td class="r num">${money(f.monto,f.moneda)}</td>
    ${modo==="com"?`<td>${esc(f.recruiter||"—")}</td><td class="acts">${comCell(f)}</td>`:`<td class="acts">${cobroCell(f)}</td><td class="acts">${f.comision>0?comCell(f):'<span class="muted">—</span>'}${f.recruiter?`<div class="muted" style="font-size:12px">${esc(f.recruiter)}</div>`:""}</td>`}</tr>`).join("")}
  </tbody></table></div>`;
  const cards=`<div class="list solo-mob">${list.map(f=>`<div class="segcard click" data-act="openFactura" data-id="${f.id}">
    <div class="segcard-top"><div style="min-width:0"><b>${esc(f.cliente)}</b><div class="muted">${esc(f.concepto||"")} · ${fd(f.fechaEmision)}</div></div><b class="num">${money(f.monto,f.moneda)}</b></div>
    ${modo==="com"?"":`<div class="acts">${cobroCell(f)}</div>`}
    ${f.comision>0?`<div class="acts"><span class="muted">Comisión ${esc(f.recruiter||"")}:</span> ${comCell(f)}</div>`:""}</div>`).join("")}</div>`;
  return tabla+cards;
}

// ---- Gastos ----
function vGastos(){
  if(!UI._gApl){ UI._gApl=1; api("/api/gastos-recurrentes/aplicar",{method:"POST"}).then(()=>refresh("gastos")).catch(()=>{}); }
  const min=primerMesSistema(); let k=UI.gMes||curYM(); if(k<min) k=UI.gMes=min;
  const gs=sortBy(vals(S.gastos).filter(g=>g.mes===k),g=>`${g.recurrenteId?0:1}${g.categoria||""}${g.concepto}`);
  const vivos=gs.filter(g=>!g.omitido), pend=vivos.filter(g=>!g.pagado);
  let h=`<div class="toolbar"><button class="btn sm" data-act="gMes" data-v="${antMes(k)}"${antMes(k)<min?" disabled":""} aria-label="Mes anterior">←</button><b style="min-width:70px;text-align:center">${fm(k)}</b><button class="btn sm" data-act="gMes" data-v="${sigMes(k)}" aria-label="Mes siguiente">→</button>${k!==curYM()?`<button class="btn sm ghost" data-act="gMes" data-v="${curYM()}">Mes actual</button>`:""}</div>`;
  if(isAdmin){
    const tc=tcFor(k), tot=vivos.reduce((s,g)=>s+toUSD(g.monto,g.moneda,k),0), tp=pend.reduce((s,g)=>s+toUSD(g.monto,g.moneda,k),0);
    const ars0=vivos.filter(g=>g.moneda!=="USD").reduce((s,g)=>s+(g.monto||0),0), usd0=vivos.filter(g=>g.moneda==="USD").reduce((s,g)=>s+(g.monto||0),0);
    h+=`<div class="kpis">${kpi("Gastos de "+fm(k),usd(tot),`${ars(ars0)} + ${usd(usd0)} · TC ${nf0.format(tc)}`)}${kpi("Pendiente de pago",usd(tp),`${pend.length} de ${vivos.length} gastos`)}${kpi("Recurrentes",usd(vivos.filter(g=>g.recurrenteId).reduce((s,g)=>s+toUSD(g.monto,g.moneda,k),0)),"del total del mes")}</div>`;
    const porCat={}; vivos.forEach(g=>porCat[g.categoria||"Otros"]=(porCat[g.categoria||"Otros"]||0)+toUSD(g.monto,g.moneda,k));
    if(vivos.length) h+=`<section class="panel"><div class="panel-head"><h2>Por categoría</h2><span class="muted">US$ eq.</span></div>${barras(sortBy(Object.entries(porCat),x=>x[1],-1),v=>usd(v))}</section>`;
  } else h+=`<div class="note">${pend.length} de ${vivos.length} gastos de ${fm(k)} pendientes de pago. Los totales y el resultado los ven los socios.</div>`;
  h+=`<section class="panel"><div class="panel-head"><h2>Gastos de ${fm(k)}</h2><button class="btn sm" data-act="newGasto">Agregar</button></div>
  ${gs.length?`<div class="list">${gs.map(g=>`<div class="row click gasto${g.omitido?" omit":""}" data-act="openGasto" data-id="${g.id}"><div class="grow" style="min-width:0"><div><b>${esc(g.concepto)}</b>${g.recurrenteId?' <span class="tag">recurrente</span>':""}</div><div class="muted" style="font-size:12px">${esc(g.categoria||"Otros")}${g.notas?" · "+esc(g.notas):""}</div></div>
    <div class="acts" style="text-align:right"><div class="num"><b>${money(g.monto,g.moneda)}</b></div>${g.omitido?`<span class="muted" style="font-size:12px">No corresponde este mes</span>`:g.pagado?`<span class="pill ok">Pagado${g.fechaPago?" "+fd(g.fechaPago):""}</span> <button class="btn sm ghost" data-act="unGasto" data-id="${g.id}">Deshacer</button>`:`<span class="pill warn">Pendiente</span> <button class="btn sm" data-act="payGasto" data-id="${g.id}">Marcar pagado</button>`}</div></div>`).join("")}</div>`:`<div class="muted">No hay gastos cargados en ${fm(k)}.</div>`}</section>`;
  const recs=sortBy(vals(S.gastosRec),r=>`${r.activo===false?1:0}${r.concepto}`);
  h+=`<section class="panel"><div class="panel-head"><h2>Gastos recurrentes</h2><button class="btn sm" data-act="newRecurrente">Nuevo recurrente</button></div>
  <div class="muted" style="font-size:13px">Se cargan solos todos los meses con su monto. Si un mes cambia, editá el gasto de ese mes; si cambia de acá en adelante, editá el recurrente.</div>
  ${recs.length?`<div class="list">${recs.map(r=>`<div class="row click" data-act="openRecurrente" data-id="${r.id}"><div class="grow" style="min-width:0"><b>${esc(r.concepto)}</b><div class="muted" style="font-size:12px">${esc(r.categoria||"Otros")} · desde ${fm(r.desde)}${r.hasta?" hasta "+fm(r.hasta):""}</div></div><div style="text-align:right"><div class="num">${money(r.monto,r.moneda)}</div>${r.activo===false?'<span class="pill">De baja</span>':'<span class="pill ok">Activo</span>'}</div></div>`).join("")}</div>`:`<div class="muted">Todavía no hay gastos recurrentes.</div>`}</section>`;
  return h;
}
function drawerGasto(id){
  const g=id?S.gastos[id]:{mes:UI.gMes||curYM(),moneda:"ARS",categoria:"Otros",pagado:false};
  if(!g) return;
  const rec=g.recurrenteId?S.gastosRec[g.recurrenteId]:null;
  const body=`${rec?`<div class="note">Gasto recurrente: se carga solo todos los meses. Lo que cambies acá afecta <b>solo ${fm(g.mes)}</b>. <a href="#" data-act="openRecurrente" data-id="${rec.id}">Editar el recurrente</a> para cambiarlo de acá en adelante.</div>`:""}
  <div class="form">${field("Concepto","g-con",g.concepto,"text","full")}${fsel("Categoría","g-cat",CATEGORIAS_GASTO,g.categoria||"Otros")}${id&&g.recurrenteId?`<div class="f"><label>Mes</label><input type="text" value="${fm(g.mes)}" disabled></div>`:field("Mes","g-mes",g.mes,"month")}
  ${fsel("Moneda","g-mnd",["ARS","USD"],g.moneda)}${field("Monto","g-mon",g.monto,"number")}
  <label class="check"><input id="g-pag" type="checkbox"${g.pagado?" checked":""}> Pagado</label>${field("Fecha de pago","g-fp",g.fechaPago,"date")}
  ${farea("Notas","g-not",g.notas)}
  ${!id?`<label class="check full"><input id="g-rec" type="checkbox"> Se repite todos los meses (gasto recurrente)</label>`:""}</div>`;
  const extra=id&&g.recurrenteId?`<button class="btn sm" data-act="omitGasto" data-id="${id}">${g.omitido?"Volver a contarlo este mes":"No corresponde este mes"}</button>`:"";
  openDrawer(id?g.concepto:"Nuevo gasto",id?`${esc(g.categoria||"")} · ${fm(g.mes)}`:"",body,{save:{label:id?"Guardar":"Agregar gasto"},del:id&&!g.recurrenteId?{label:"Eliminar"}:null,extra});
  drawerSave.save.fn=async()=>{
    const con=gv("g-con"), mon=gn("g-mon"), mes=id&&g.recurrenteId?g.mes:gv("g-mes");
    if(!con||mon==null||!mes){ toast("Completá concepto, mes y monto.",true); return; }
    if(mes<primerMesSistema()){ toast(`Los gastos hasta ${fm(antMes(primerMesSistema()))} vienen de la planilla Economics.`,true); return; }
    const pag=gv("g-pag"), fp=gv("g-fp")||(pag?today():"");
    const datos={concepto:con,categoria:gv("g-cat"),moneda:gv("g-mnd"),monto:mon,pagado:pag,fechaPago:pag?fp:"",notas:gv("g-not")};
    if(!id&&gv("g-rec")){
      const rid=newId("r");
      if(!await write("gastosRecurrentes/"+rid,{concepto:con,categoria:datos.categoria,moneda:datos.moneda,monto:mon,desde:mes,hasta:"",notas:datos.notas,activo:true})) return;
      try{ await api(`/api/gastos-recurrentes/${rid}/propagar`,{method:"POST",body:JSON.stringify({desde:mes})}); }catch(e){}
      if(pag&&mes<=curYM()) await write(`gastos/gr-${rid}-${mes}`,{pagado:true,fechaPago:fp},"update");
      await refresh("gastos"); toast("Gasto recurrente creado"); closeDrawer(); return;
    }
    if(await write("gastos/"+(id||newId("g")),id?datos:{...datos,mes,creado:today()},id?"update":"set")){ toast(id?"Gasto actualizado":"Gasto agregado"); closeDrawer(); }
  };
  if(drawerSave.del) drawerSave.del.fn=async()=>{ if(drawerSave.del.armed){ if(await write("gastos/"+id,null,"delete")){toast("Gasto eliminado");closeDrawer();} } else { drawerSave.del.armed=true; $("[data-act=drawerDel]").textContent="Confirmar: eliminar"; } };
}
function drawerRecurrente(rid){
  const r=rid?S.gastosRec[rid]:{moneda:"ARS",categoria:"Otros",desde:UI.gMes||curYM(),activo:true};
  if(!r) return;
  const body=`<div class="form">${field("Concepto","r-con",r.concepto,"text","full")}${fsel("Categoría","r-cat",CATEGORIAS_GASTO,r.categoria||"Otros")}
  ${fsel("Moneda","r-mnd",["ARS","USD"],r.moneda)}${field("Monto mensual","r-mon",r.monto,"number")}
  ${field("Desde","r-des",r.desde,"month")}${field("Hasta (opcional)","r-has",r.hasta,"month")}
  ${rid?field("Aplicar los cambios desde","r-apl",curYM(),"month"):""}
  <label class="check full"><input id="r-act" type="checkbox"${r.activo!==false?" checked":""}> Activo (desactivalo para dar de baja el gasto)</label>
  ${farea("Notas","r-not",r.notas)}</div>
  ${rid?`<div class="note">Los meses desde "Aplicar los cambios desde" que todavía no están pagados se actualizan con el monto nuevo. Los meses pagados no se tocan.</div>`:""}`;
  openDrawer(rid?r.concepto:"Nuevo gasto recurrente",rid?"Gasto recurrente":"",body,{save:{label:rid?"Guardar":"Crear recurrente"}});
  drawerSave.save.fn=async()=>{
    const con=gv("r-con"), mon=gn("r-mon"), des=gv("r-des");
    if(!con||mon==null||!des){ toast("Completá concepto, monto y desde qué mes.",true); return; }
    const has=gv("r-has"); if(has&&has<des){ toast("“Hasta” no puede ser antes de “Desde”.",true); return; }
    const id=rid||newId("r");
    if(!await write("gastosRecurrentes/"+id,{concepto:con,categoria:gv("r-cat"),moneda:gv("r-mnd"),monto:mon,desde:des,hasta:has,notas:gv("r-not"),activo:gv("r-act")})) return;
    try{ await api(`/api/gastos-recurrentes/${id}/propagar`,{method:"POST",body:JSON.stringify({desde:rid?gv("r-apl"):des})}); }catch(e){ toast(e.message||"No se pudieron actualizar los meses.",true); }
    await refresh("gastos"); toast(rid?"Recurrente actualizado":"Recurrente creado"); closeDrawer();
  };
}

// ================= ECONOMICS =================
function vEconomics(){
  const years=uniq([...Object.keys(hist()).map(k=>+k.slice(0,4)),new Date().getFullYear()]).sort();
  const y=UI.ecoYear; const ms=monthsOfYear(y); const P=ms.map(pnl);
  const sum=f=>P.reduce((s,p)=>s+f(p),0);
  const ing=sum(p=>p.ingTot), gas=sum(p=>p.gasTot), res=ing-gas;
  const F=vals(S.facturas).filter(f=>(f.fechaEmision||"").startsWith(String(y)));
  const cierres=F.filter(f=>f.tipo==="Cierre"); const inicio=F.filter(f=>f.tipo==="Inicio y avance");
  const cerr=B().filter(b=>b.estado==="Cerrada"&&(b.fechaCierre||"").startsWith(String(y)));
  const canc=B().filter(b=>b.estado==="Cancelada"&&(b.fechaCierre||"").startsWith(String(y)));
  const abiertas=B().filter(b=>(b.fechaInicio||"").startsWith(String(y)));
  const ticket=F.length?F.reduce((s,f)=>s+fcUSD(f),0)/F.length:null;
  const feeCierre=cierres.length?cierres.reduce((s,f)=>s+fcARS(f),0)/cierres.length:null;
  const ttfs=cerr.map(ttf).filter(x=>x!=null); const ttfA=ttfs.length?ttfs.reduce((a,b)=>a+b,0)/ttfs.length:null;
  const byCli={}, byRec={}; F.forEach(f=>{byCli[f.cliente]=(byCli[f.cliente]||0)+fcUSD(f); if(f.recruiter) byRec[f.recruiter]=(byRec[f.recruiter]||0)+fcUSD(f);});
  const topCli=sortBy(Object.entries(byCli),x=>x[1],-1); const topRec=sortBy(Object.entries(byRec),x=>x[1],-1);
  const factTotal=F.reduce((s,f)=>s+fcUSD(f),0);
  const conc=topCli.slice(0,3).reduce((s,x)=>s+x[1],0)/(factTotal||1);
  const o=obj();
  if(!isAdmin) return vEconomicsAdm({y,years,ms,P,sum,ing,F,cierres,inicio,cerr,canc,abiertas,ticket,feeCierre,ttfA,topCli,topRec,factTotal,conc,o});
  let h=`<div class="head"><div><h1>Resultados</h1><p>Resultado mensual en dólares equivalentes y rentabilidad por búsqueda.</p></div>
  <div class="seg" role="group" aria-label="Año">${years.map(yy=>`<button data-act="ecoYear" data-v="${yy}" aria-pressed="${yy===y}">${yy}</button>`).join("")}</div></div>
  <div class="kpis">${kpi("Ingresos "+y,usd(ing),`${ms.length} meses`)}${kpi("Gastos "+y,usd(gas),`${pct(ing?gas/ing:null)} de los ingresos`)}${kpi("Resultado "+y,usd(res),`margen ${pct(ing?res/ing:null)}`)}${kpi("Resultado mensual promedio",usd(ms.length?res/ms.length:null),"en US$ equivalentes")}</div>
  <section class="panel"><div class="panel-head"><h2>Por mes</h2><span class="muted">tocá una barra o un mes para ver el detalle</span></div>${barChart(P.map(p=>({label:fm(p.k),a:p.ingTot,b:p.gasTot,k:p.k})))}</section>
  <div class="tablewrap"><table><thead><tr><th>Mes</th><th class="r">Ingresos ARS</th><th class="r">Ingresos USD</th><th class="r">TC</th><th class="r">Ingresos US$ eq.</th><th class="r">Gastos US$ eq.</th><th class="r">Resultado</th><th class="r">Margen</th><th>Fuente</th></tr></thead><tbody>
  ${P.map(p=>`<tr class="click" data-act="openMes" data-id="${p.k}"><td>${fm(p.k)}</td><td class="r num">${ars(p.ingARS)}</td><td class="r num">${usd(p.ingUSD)}</td><td class="r num">${nf0.format(p.tc)}</td><td class="r num">${usd(p.ingTot)}</td><td class="r num">${usd(p.gasTot)}</td><td class="r num" style="color:${p.res<0?"var(--crit)":"inherit"}">${usd(p.res)}</td><td class="r num">${pct(p.margen)}</td><td><span class="tag">${p.source}</span></td></tr>`).join("")}
  </tbody><tfoot><tr><td>Total ${y}</td><td class="r num">${ars(sum(p=>p.ingARS))}</td><td class="r num">${usd(sum(p=>p.ingUSD))}</td><td></td><td class="r num">${usd(ing)}</td><td class="r num">${usd(gas)}</td><td class="r num">${usd(res)}</td><td class="r num">${pct(ing?res/ing:null)}</td><td></td></tr></tfoot></table></div>
  <h2>Unidad: la búsqueda</h2>
  <div class="kpis">
    ${kpi("Fee promedio por cierre",ars(feeCierre),`${cierres.length} facturas de cierre · objetivo ${short(o.ticketPromedioARS)}`, feeCierre&&o.ticketPromedioARS?feeCierre/o.ticketPromedioARS:null)}
    ${kpi("Ticket promedio factura",usd(ticket),`${F.length} facturas emitidas`)}
    ${kpi("Costo por búsqueda cerrada",usd(cerr.length?gas/cerr.length:null),`gastos / ${cerr.length} cerradas`)}
    ${kpi("Resultado por búsqueda cerrada",usd(cerr.length?res/cerr.length:null),"resultado del año / cerradas")}
    ${kpi("Time to fill",ttfA!=null?nf0.format(ttfA)+" días":"—",`objetivo ${o.timeToFillDias}`)}
    ${kpi("Tasa de cancelación",(cerr.length+canc.length)?pct(canc.length/(cerr.length+canc.length)):"—",`${canc.length} canceladas · ${abiertas.length} abiertas en ${y}`)}
    ${kpi("Peso de inicio y avance",factTotal?pct(inicio.reduce((s,f)=>s+fcUSD(f),0)/factTotal):"—",`${inicio.length} facturas de anticipo`)}
    ${kpi("Concentración top 3",factTotal?pct(conc):"—","de la facturación del año")}
  </div>
  <div class="grid2">
    <section class="panel"><h2>Facturación por cliente</h2><div class="list">${topCli.slice(0,8).map(([c,v])=>`<div class="row"><span class="grow">${esc(c)}</span><span class="num">${usd(v)}</span><span class="muted num" style="width:44px;text-align:right">${pct(v/(factTotal||1))}</span></div>`).join("")||'<div class="empty">Sin facturas este año.</div>'}</div></section>
    <section class="panel"><h2>Facturación por recruiter</h2><div class="list">${topRec.map(([c,v])=>`<div class="row"><span class="grow">${esc(c)}</span><span class="num">${usd(v)}</span><span class="muted num" style="width:44px;text-align:right">${pct(v/(factTotal||1))}</span></div>`).join("")||'<div class="empty">Sin datos.</div>'}</div></section>
  </div>
  <div class="note">Hasta septiembre 2026 los ingresos y gastos vienen de la planilla Economics, con todas las líneas de gasto sumadas (la planilla original omitía algunas filas en el total). Desde octubre 2026, los ingresos salen de las facturas emitidas y las comisiones de recruiters se calculan solas; los gastos se cargan en Finanzas › Gastos (con recurrentes que se cargan solos cada mes).</div>`;
  return h;
}

// Vista de economics para la Administradora: ingresos y costos unitarios, sin gastos ni resultado.
function vEconomicsAdm({y,years,ms,P,sum,ing,F,cierres,inicio,cerr,canc,abiertas,ticket,feeCierre,ttfA,topCli,topRec,factTotal,conc,o}){
  const u=(S.unit||{})[String(y)]||{};
  return `<div class="head"><div><h1>Resultados</h1><p>Ingresos mensuales en dólares equivalentes y costos por búsqueda.</p></div>
  <div class="seg" role="group" aria-label="Año">${years.map(yy=>`<button data-act="ecoYear" data-v="${yy}" aria-pressed="${yy===y}">${yy}</button>`).join("")}</div></div>
  <div class="kpis">${kpi("Ingresos "+y,usd(ing),`${ms.length} meses`)}${kpi("Ingreso mensual promedio",usd(ms.length?ing/ms.length:null),"en US$ equivalentes")}${kpi("Facturas emitidas",F.length,`${cierres.length} de cierre · ${inicio.length} de inicio y avance`)}</div>
  <section class="panel"><div class="panel-head"><h2>Ingresos por mes</h2><span class="muted">tocá una barra o un mes para ver el detalle</span></div>${barChart(P.map(p=>({label:fm(p.k),a:p.ingTot,b:0,k:p.k})),{onlyA:true})}</section>
  <div class="tablewrap"><table><thead><tr><th>Mes</th><th class="r">Ingresos ARS</th><th class="r">Ingresos USD</th><th class="r">TC</th><th class="r">Ingresos US$ eq.</th></tr></thead><tbody>
  ${P.map(p=>`<tr class="click" data-act="openMes" data-id="${p.k}"><td>${fm(p.k)}</td><td class="r num">${ars(p.ingARS)}</td><td class="r num">${usd(p.ingUSD)}</td><td class="r num">${nf0.format(p.tc)}</td><td class="r num">${usd(p.ingTot)}</td></tr>`).join("")}
  </tbody><tfoot><tr><td>Total ${y}</td><td class="r num">${ars(sum(p=>p.ingARS))}</td><td class="r num">${usd(sum(p=>p.ingUSD))}</td><td></td><td class="r num">${usd(ing)}</td></tr></tfoot></table></div>
  <h2>Unidad: la búsqueda</h2>
  <div class="kpis">
    ${kpi("Fee promedio por cierre",ars(feeCierre),`${cierres.length} facturas de cierre · objetivo ${short(o.ticketPromedioARS)}`, feeCierre&&o.ticketPromedioARS?feeCierre/o.ticketPromedioARS:null)}
    ${kpi("Ticket promedio factura",usd(ticket),`${F.length} facturas emitidas`)}
    ${kpi("Costo por búsqueda cerrada",usd(u.costoPorBusquedaCerradaUSD),`${cerr.length} cerradas en ${y}`)}
    ${kpi("Costo por búsqueda iniciada",usd(u.costoPorBusquedaIniciadaUSD),`${abiertas.length} iniciadas en ${y}`)}
    ${kpi("Time to fill",ttfA!=null?nf0.format(ttfA)+" días":"—",`objetivo ${o.timeToFillDias}`)}
    ${kpi("Tasa de cancelación",(cerr.length+canc.length)?pct(canc.length/(cerr.length+canc.length)):"—",`${canc.length} canceladas · ${abiertas.length} abiertas en ${y}`)}
    ${kpi("Peso de inicio y avance",factTotal?pct(inicio.reduce((s,f)=>s+fcUSD(f),0)/factTotal):"—",`${inicio.length} facturas de anticipo`)}
    ${kpi("Concentración top 3",factTotal?pct(conc):"—","de la facturación del año")}
  </div>
  <div class="grid2">
    <section class="panel"><h2>Facturación por cliente</h2><div class="list">${topCli.slice(0,8).map(([c,v])=>`<div class="row"><span class="grow">${esc(c)}</span><span class="num">${usd(v)}</span><span class="muted num" style="width:44px;text-align:right">${pct(v/(factTotal||1))}</span></div>`).join("")||'<div class="empty">Sin facturas este año.</div>'}</div></section>
    <section class="panel"><h2>Facturación por recruiter</h2><div class="list">${topRec.map(([c,v])=>`<div class="row"><span class="grow">${esc(c)}</span><span class="num">${usd(v)}</span><span class="muted num" style="width:44px;text-align:right">${pct(v/(factTotal||1))}</span></div>`).join("")||'<div class="empty">Sin datos.</div>'}</div></section>
  </div>`;
}

// ================= AJUSTES =================
// ================= CONFIGURACIÓN =================
// Una sola sección con pestañas; cada rol ve las suyas. Las rutas viejas (#historial, #calidad…) abren la pestaña que corresponde.
const CONFIG_VIEWS=["config"];
function tabsConfig(){
  return [canFin&&["usuarios","Usuarios y accesos"],canFin&&["objetivos","Objetivos"],["conexiones","Conexiones"],["historial","Historial de cambios"],canFin&&["calidad",`Calidad de datos <span class="muted num">${calidadDatos().length}</span>`],isAdmin&&["papelera","Papelera y respaldo"],["mejoras",`Pedidos de mejora <span class="muted num">${vals(S.feedback).filter(f=>f.estado==="Pendiente"||f.estado==="En curso").length}</span>`]].filter(Boolean);
}
function abrirTabConfig(){ const t=UI.cfgTab; if(t==="conexiones") refresh("conexiones"); if(t==="papelera") cargarPapelera(); if(t==="historial") S.historial=null; }
function vConfig(){
  const tabs=tabsConfig(); if(!tabs.some(([v])=>v===UI.cfgTab)) UI.cfgTab=tabs[0][0];
  const t=UI.cfgTab;
  const body={usuarios:()=>vUsuarios(),objetivos:objetivosBox,conexiones:vConexiones,historial:vHistorial,calidad:vCalidad,papelera:()=>papeleraBox(),mejoras:vMejoras}[t]();
  return `<div class="head"><div><h1>Configuración</h1><p>Usuarios, metas, conexiones y herramientas del sistema.</p></div></div>
  <div class="toolbar"><div class="seg" role="group" aria-label="Sección">${tabs.map(([v,l])=>`<button data-act="cfgTab" data-v="${v}" aria-pressed="${t===v}">${l}</button>`).join("")}</div></div>
  <div class="subview">${body}</div>`;
}
function objetivosBox(){
  const o=obj();
  return `<section class="panel"><h2>Objetivos</h2><div class="muted" style="font-size:13px">Las metas que usan el Panel, el Weekly y los indicadores.</div><div class="form">
    ${field("Facturación mensual (ARS)","o-fac",o.facturacionMensualARS,"number")}${field("Ticket promedio (ARS)","o-tic",o.ticketPromedioARS,"number")}
    ${field("Fee mínimo aceptado (ARS)","o-fee",o.feeMinimoARS,"number")}${field("Time to fill (días)","o-ttf",o.timeToFillDias,"number")}
    ${field("Búsquedas activas","o-ba",o.busquedasActivas,"number")}${field("Propuestas por mes","o-pr",o.propuestasMes,"number")}
    ${field("Clientes nuevos por mes","o-nc",o.nuevosClientesMes,"number")}</div>
    <div><button class="btn primary" data-act="saveObjetivos">Guardar objetivos</button></div></section>`;
}
// Editar equipo (recruiters, capacidad, comisión): desde la sección Equipo
function drawerEquipo(){
  const r=recruiters();
  const body=`<div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Activa</th><th class="r">Capacidad</th><th class="r">Comisión %</th></tr></thead><tbody>
    ${r.map((x,i)=>`<tr><td><input id="rec-n-${i}" type="text" value="${esc(x.nombre)}" style="width:100%"></td><td><input id="rec-a-${i}" type="checkbox"${x.activa?" checked":""} aria-label="Activa"></td><td class="r"><input id="rec-c-${i}" type="number" value="${x.capacidad??4}" style="width:80px"></td><td class="r"><input id="rec-p-${i}" type="number" value="${x.comisionPct??0}" style="width:80px"></td></tr>`).join("")}
    </tbody></table></div>
    <div class="toolbar"><button class="btn sm" data-act="addRec">Agregar recruiter</button><button class="btn primary" data-act="saveEquipo" data-n="${r.length}">Guardar equipo</button></div>
    <div class="note">La capacidad es la cantidad de búsquedas simultáneas que puede llevar cada recruiter. La comisión se propone sola al cargar una factura. El nombre tiene que coincidir con el de su usuario para que vea su panel.</div>`;
  openDrawer("Editar equipo","Recruiters, capacidad y comisión",body,{});
}

// ================= DRAWER =================
let drawerSave=null;
function openDrawer(title,sub,body,{save,del,extra}={}){
  drawerSave={save,del};
  $("#overlay").innerHTML=`<div class="scrim" data-act="closeDrawer"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="drawer-h"><div><h2>${esc(title)}</h2>${sub?`<div class="muted" style="margin-top:2px">${sub}</div>`:""}</div><button class="btn ghost" data-act="closeDrawer" aria-label="Cerrar">Cerrar</button></div>
    <div class="drawer-b">${body}</div>
    ${save||del||extra?`<div class="drawer-f"><span>${del?`<button class="btn danger" data-act="drawerDel">${esc(del.label||"Eliminar")}</button>`:""}${extra||""}</span>${save?`<button class="btn primary" data-act="drawerSave">${esc(save.label||"Guardar")}</button>`:""}</div>`:""}
  </aside>`;
  const first=$("#overlay .drawer-b input, #overlay .drawer-b select, #overlay .drawer-b textarea"); if(first&&!sub) first.focus();
}
function closeDrawer(){ $("#overlay").innerHTML=""; drawerSave=null; }

// ---------- API ----------
const RES_KEY = {busquedas:"busquedas",candidatos:"candidatos",postulaciones:"postulaciones",feedback:"feedback",busquedasFin:"fin",facturas:"facturas",clientes:"clientes",leads:"leads",meses:"meses",propuestas:"propuestas",gastos:"gastos",gastosRecurrentes:"gastosRec"};
const ADMIN_RES = new Set(["busquedasFin","facturas","clientes","leads","meses","propuestas","gastos","gastosRecurrentes"]);
function apiPath(path){ const [c,id]=path.split("/"); if(c==="economics") return ["meses",id.replace(/^m-/,"")]; if(c==="equipo"||c==="objetivos") return ["config",c]; return [c,id]; }
async function api(url,opts={}){
  const r=await fetch(url,{credentials:"same-origin",headers:{"content-type":"application/json"},...opts});
  if(r.status===401){ showLogin(); throw {code:401}; }
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw {code:r.status,message:j.error};
  return j;
}
function applyLocal(res,id,data,mode){
  if(res==="config"){ if(mode!=="delete") S[id]=data; return; }
  const k=RES_KEY[res]; if(!k) return;
  const cur={...(S[k]||{})};
  if(mode==="delete") delete cur[id];
  else if(mode==="update") cur[id]={...(cur[id]||{}),...data,id};
  else cur[id]={...data,id};
  S[k]=cur;
}
async function write(path,data,mode="set"){
  const [res,id]=apiPath(path);
  const url = res==="config" ? `/api/config/${id}` : `/api/${res}/${encodeURIComponent(id)}`;
  const method = mode==="update"?"PATCH": mode==="delete"?"DELETE":"PUT";
  try{
    await api(url,{method,body:mode==="delete"?undefined:JSON.stringify(data)});
    applyLocal(res,id,data,mode); schedule(); refresh(res==="config"?"config":res);
    return true;
  }catch(e){ if(e.code!==401) toast(e.message||"Sin conexión con el servidor. Probá de nuevo.",true); return false; }
}
async function refresh(res){
  try{
    if(res==="config"){ S.equipo=await api("/api/config/equipo"); if(!canFin){ try{ S.yoRec=(await api("/api/recruiter/yo")).nombre; }catch(e){} } if(canFin){ S.objetivos=await api("/api/config/objetivos"); S.digest=await api("/api/config/digest"); } }
    else if(res==="users"){ if(canFin) S.users=await api("/api/users"); names=await api("/api/users/names"); }
    else if(res==="unit"){ if(canFin) S.unit=await api("/api/unit-costs"); }
    else if(res==="conexiones"){ S.conexiones=await api("/api/unipile/cuentas"); }
    else { if(ADMIN_RES.has(res)&&!canFin) return; const rows=await api("/api/"+res); S[RES_KEY[res]]=Object.fromEntries(rows.map(x=>{const id=x.id??x.mes;return [id,{...x,id}];})); }
    $("#sync").textContent="Actualizado "+new Date().toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"});
    schedule();
  }catch(e){ if(e.code!==401) $("#sync").textContent="Sin conexión con el servidor"; }
}
async function refreshAll(){ await Promise.all([...Object.keys(RES_KEY).map(refresh),refresh("config"),refresh("users"),refresh("unit"),cargarCliDocs()]); }
const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2,6);

// ---- minutas (Granola) ----
let pendingMin=[];
function minList(){ return pendingMin.length? `<div class="list">${sortBy(pendingMin.map((m,i)=>({...m,i})),m=>m.fecha||"",-1).map(m=>`<div class="row"><div class="grow"><div><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.titulo||"Minuta")}</a></div><div class="muted">${fd(m.fecha)}</div></div><button class="btn sm ghost" data-act="minRemove" data-i="${m.i}" aria-label="Quitar minuta">Quitar</button></div>`).join("")}</div>` : `<div class="muted" style="font-size:13px">Sin minutas vinculadas.</div>`; }
function minutasSection(list){
  pendingMin=[...(list||[])];
  return `<div class="section"><span class="label">Minutas de reuniones (Granola)</span><div id="min-list">${minList()}</div>
  <div class="form">${field("Título de la reunión","min-t","")}${field("Fecha","min-f",today(),"date")}${field("Link de Granola","min-u","","text","full")}</div>
  <div><button class="btn sm" data-act="minAdd">Agregar minuta</button></div></div>`;
}
function flushMin(){ const u=gv("min-u"); if(u){ pendingMin.push({titulo:gv("min-t")||"Reunión",fecha:gv("min-f")||today(),url:u.startsWith("http")?u:"https://"+u}); } return pendingMin; }

// ---- búsqueda drawer ----
function drawerBusqueda(id){
  const b=id?S.busquedas[id]:{estado:"Activa",fechaInicio:today(),bitacora:[]};
  if(!b) return;
  const fin=id?(S.fin[id]||{}):{};
  const recs=recruiters().map(r=>r.nombre); if(b.recruiter&&!recs.includes(b.recruiter)) recs.push(b.recruiter);
  const ps=id?sortBy(postsOf(id),p=>ETAPAS.indexOf(p.etapa)):[];
  const fcs=id?vals(S.facturas).filter(f=>f.busquedaId===id):[];
  let body=`<div class="form">
    ${field("Puesto","b-puesto",b.puesto,"text","full")}
    ${fdl("Cliente","b-cliente",b.cliente,"dl-cli")}${fsel("Recruiter","b-rec",["",...recs],b.recruiter)}
    ${fsel("Estado","b-estado",ESTADOS_B,b.estado)}${fsel("Prioridad","b-prio",PRIORIDADES,b.prioridad)}
    ${field("Fecha de inicio","b-fi",b.fechaInicio,"date")}${field("Primera terna presentada","b-ft",b.fechaPrimeraTerna,"date")}
    ${field("Fecha de cierre","b-fc",b.fechaCierre,"date")}${field("Ingreso del candidato","b-fing",b.fechaIngreso,"date")}
    ${field("Candidato final","b-cand",b.candidatoFinal,"text")}${field("Fin de garantía","b-fg",b.finGarantia,"date")}
    <label class="check full"><input id="b-gar" type="checkbox"${b.garantia?" checked":""}> Cubierta por garantía (reemplazo)</label>
    <label class="check full"><input id="b-ia" type="checkbox"${b.inicioAvance?" checked":""}> Tiene cobro de inicio y avance</label>
    ${farea("Estado actual","b-det",b.detalle)}${farea("Próximo paso","b-pp",b.proximoPaso)}
    ${farea("Notas","b-nota",b.nota)}
  </div>${datalist("dl-cli",clientNames())}`;
  if(canFin){
    body+=`<div class="section"><span class="label">Sueldo y fee de la búsqueda</span><div class="form">
      ${field("Sueldo bruto mensual ARS","bf-sars",fin.sueldoBrutoARS,"number")}${field("Sueldo USD","bf-susd",fin.sueldoUSD,"number")}
      ${field("Fee acordado (× sueldo)","bf-mult",fin.feeMultiplo,"number")}${field("Fee estimado ARS","bf-fee",fin.feeEstimadoARS ?? (fin.sueldoBrutoARS&&fin.feeMultiplo?fin.sueldoBrutoARS*fin.feeMultiplo:""),"number")}
    </div>${fcs.length?`<div style="font-size:13px">Facturado: <b>${usd(fcs.reduce((s,f)=>s+fcUSD(f),0))}</b> US$ eq. en ${fcs.length} facturas · cobrado ${usd(fcs.filter(f=>f.cobrada).reduce((s,f)=>s+fcUSD(f),0))}</div>`:""}${fcs.length?`<div class="list">${fcs.map(f=>`<div class="row"><div class="grow"><div>${esc(f.concepto)}</div><div class="muted">${fd(f.fechaEmision)} · ${f.cobrada?"cobrada":"pendiente"}</div></div><span class="num">${money(f.monto,f.moneda)}</span></div>`).join("")}</div>`:`<div class="muted" style="font-size:13px">Sin facturas vinculadas.</div>`}
    ${id?`<div><button class="btn sm" data-act="newFactura" data-bid="${id}">Facturar esta búsqueda</button></div>`:""}</div>`;
  }
  if(id){
    body+=`<div class="section"><div class="panel-head"><span class="label">Candidatos (${ps.length})</span><button class="btn sm" data-act="addPost" data-id="${id}">Sumar candidato</button></div>
    ${ps.length?`<div class="list">${ps.map(p=>{const c=S.candidatos[p.candidatoId]||{}; return `<div class="row"><div class="grow"><div><a href="#" data-act="openCandidato" data-id="${p.candidatoId}">${esc(c.nombre||"Candidato")}</a></div><div class="muted">${esc(c.rolActual||"")}</div></div><select data-post="${p.id}" aria-label="Etapa">${opt(ETAPAS,p.etapa)}</select></div>`;}).join("")}</div>`:`<div class="muted" style="font-size:13px">Todavía no hay candidatos en el pipeline.</div>`}</div>
    ${funnelHTML(ps)}<div class="section"><span class="label">Bitácora semanal</span>${(b.bitacora||[]).length?`<div class="log">${sortBy(b.bitacora,x=>x.fecha,-1).map(x=>`<div><small>${fd(x.fecha)} · ${esc(authorName(x.autor))}</small>${esc(x.texto)}</div>`).join("")}</div>`:`<div class="muted" style="font-size:13px">Sin registros.</div>`}</div>`;
  }
  body+=minutasSection(b.minutas);
  if(id) body+=histSection("busquedas",id);
  openDrawer(id?b.puesto:"Nueva búsqueda", id?`${esc(b.cliente)} · ${pillEstado(b.estado)}`:"", body, {save:{label:id?"Guardar cambios":"Crear búsqueda"}, del: id&&isAdmin?{label:"Eliminar"}:null, extra: id?`<button class="btn sm" data-act="repCliente" data-id="${id}">Reporte para el cliente</button>`:""});
  drawerSave.save.fn=async()=>{
    const puesto=gv("b-puesto"); let cliente=gv("b-cliente");
    if(cliente){ const canon=clienteCanonico(cliente); if(canon) cliente=canon; else if(!drawerSave.cliNuevo){ drawerSave.cliNuevo=true; toast(`“${cliente}” no es un cliente existente. Revisá cómo está escrito o guardá de nuevo para crearlo.`,true); return; } else if(canFin){ await write("clientes/cl-"+keyN(cliente).slice(0,40),{nombre:cliente,contactos:"",notas:"",origen:"",oportunidades:[]}); } }
    if(!puesto||!cliente){ toast("Completá puesto y cliente.",true); return; }
    if(!id&&S.cliDocs&&!tieneDoc(cliente)){ toast(MSG_SIN_DOC(cliente),true); return; }
    if(gv("b-estado")==="Cerrada"&&!gv("b-cand")&&(!id||b.estado!=="Cerrada")){ toast("Para cerrar la búsqueda completá el candidato final (quién ingresó).",true); return; }
    const det=gv("b-det"), pp=gv("b-pp");
    const bit=[...(b.bitacora||[])];
    if(id && (det!==(b.detalle||"")||pp!==(b.proximoPaso||"")) && (det||pp)) bit.push({fecha:today(),texto:[det,pp].filter(Boolean).join(" · "),autor:me.id||""});
    const doc={...(id?b:{}),puesto,cliente,recruiter:gv("b-rec"),estado:gv("b-estado"),prioridad:gv("b-prio"),fechaInicio:gv("b-fi"),fechaPrimeraTerna:gv("b-ft"),
      fechaCierre:gv("b-fc"),fechaIngreso:gv("b-fing"),candidatoFinal:gv("b-cand"),finGarantia:gv("b-fg")||(gv("b-fing")?finGar(gv("b-fing")):""),garantia:gv("b-gar"),inicioAvance:gv("b-ia"),
      detalle:det,proximoPaso:pp,nota:gv("b-nota"),bitacora:bit,minutas:flushMin(),actualizado:today()};
    if((doc.estado==="Cerrada"||doc.estado==="Cancelada")&&!doc.fechaCierre&&(!id||b.estado!==doc.estado)) doc.fechaCierre=today();
    delete doc.id;
    const nid=id||newId("b");
    if(!await write("busquedas/"+nid,doc)) return;
    if(canFin){
      const fdoc={sueldoBrutoARS:gn("bf-sars"),sueldoUSD:gn("bf-susd"),feeMultiplo:gn("bf-mult"),feeEstimadoARS:gn("bf-fee")||(gn("bf-mult")?(gn("bf-sars")?gn("bf-sars")*gn("bf-mult"):gn("bf-susd")?Math.round(toARS(gn("bf-susd")*gn("bf-mult"),"USD",curYM())):null):null)};
      const prev=S.fin[nid]||{}; const merged={...prev,...fdoc}; delete merged.id;
      if(JSON.stringify(merged)!==JSON.stringify(Object.fromEntries(Object.entries(prev).filter(([k])=>k!=="id")))) await write("busquedasFin/"+nid,merged);
    }
    toast(id?"Búsqueda actualizada":"Búsqueda creada"); closeDrawer();
  };
  if(drawerSave.del) drawerSave.del.fn=async()=>{ if(drawerSave.del.armed){ if(await write("busquedas/"+id,null,"delete")){toast("Búsqueda eliminada");closeDrawer();} } else { drawerSave.del.armed=true; $("[data-act=drawerDel]").textContent="Confirmar: eliminar"; } };
}
function authorName(a){ if(!a) return "—"; return names[a]||a; }

function drawerWeekly(id){
  const b=S.busquedas[id]; if(!b) return;
  const body=`<div class="form">${fsel("Estado","w-estado",ESTADOS_B,b.estado)}${fsel("Prioridad","w-prio",PRIORIDADES,b.prioridad)}
    ${farea("¿Cómo está la búsqueda esta semana?","w-det",b.detalle)}${farea("Plan de acción / próximo paso","w-pp",b.proximoPaso)}
    ${field("Primera terna presentada","w-ft",b.fechaPrimeraTerna,"date")}${field("Candidato final (si cerró)","w-cand",b.candidatoFinal)}</div>
    ${(b.bitacora||[]).length?`<div class="section"><span class="label">Semanas anteriores</span><div class="log">${sortBy(b.bitacora,x=>x.fecha,-1).slice(0,5).map(x=>`<div><small>${fd(x.fecha)} · ${esc(authorName(x.autor))}</small>${esc(x.texto)}</div>`).join("")}</div></div>`:""}`;
  openDrawer("Actualización semanal",`${esc(b.puesto)} · ${esc(b.cliente)}`,body,{save:{label:"Guardar actualización"}});
  setTimeout(()=>{const t=$("#w-det"); t&&t.focus();},30);
  drawerSave.save.fn=async()=>{
    const det=gv("w-det"), pp=gv("w-pp"), est=gv("w-estado");
    if(est==="Cerrada"&&!gv("w-cand")){ toast("Para cerrar la búsqueda completá el candidato final (quién ingresó).",true); return; }
    const upd={estado:est,prioridad:gv("w-prio"),detalle:det,proximoPaso:pp,fechaPrimeraTerna:gv("w-ft"),candidatoFinal:gv("w-cand"),actualizado:today(),
      bitacora:[...(b.bitacora||[]),{fecha:today(),texto:[det,pp].filter(Boolean).join(" · ")||`Estado: ${est}`,autor:me.id||""}]};
    if((est==="Cerrada"||est==="Cancelada")&&!b.fechaCierre) upd.fechaCierre=today();
    if(await write("busquedas/"+id,upd,"update")){ toast("Actualización guardada"); closeDrawer(); }
  };
}

// ---- candidato ----
function drawerCandidato(id,{busquedaId}={}){
  const c=id?S.candidatos[id]:{tags:[]}; if(!c) return;
  const ps=id?sortBy(postsOfCand(id),p=>p.fecha||"",-1):[];
  let body=`<div class="form">${field("Nombre y apellido","c-nom",c.nombre,"text","full")}
    ${field("LinkedIn (URL)","c-li",c.linkedin)}${field("Email","c-em",c.email)}
    ${field("Teléfono","c-tel",c.telefono)}${field("Ubicación","c-ub",c.ubicacion)}
    ${field("Rol actual","c-rol",c.rolActual)}${field("Empresa actual","c-emp",c.empresaActual)}
    ${fsel("Área","c-area",["","Comercial","Marketing","Finanzas","Operaciones","Producto","Tecnología","Diseño","People","Atención al cliente","Dirección"],c.area)}
    ${fsel("Seniority","c-sen",["","Jr","Ssr","Sr","Líder","Director/C-level"],c.seniority)}
    ${field("Pretensión salarial","c-pre",c.pretension)}${field("Etiquetas (separadas por coma)","c-tags",(c.tags||[]).join(", "))}
    ${farea("Notas de entrevista","c-not",c.notas)}</div>`;
  if(c.linkedin) body+=`<div><a class="btn sm" href="${esc(c.linkedin.startsWith("http")?c.linkedin:"https://"+c.linkedin)}" target="_blank" rel="noopener">Abrir LinkedIn</a></div>`;
  if(busquedaId&&!id){ const b=S.busquedas[busquedaId]; body+=`<div class="note">Se suma a <b>${esc(b?.puesto)}</b> · ${esc(b?.cliente)} en etapa ${fsel("","c-etapa",ETAPAS.slice(0,7),"Sourcing")}</div>`; }
  if(id){
    body+=`<div class="section"><span class="label">Procesos (${ps.length})</span>${ps.length?`<div class="list">${ps.map(p=>{const b=S.busquedas[p.busquedaId]||{}; return `<div class="row"><div class="grow"><div><a href="#" data-act="openBusqueda" data-id="${p.busquedaId}">${esc(b.puesto||"Búsqueda")}</a></div><div class="muted">${esc(b.cliente||"")} · ${fd(p.fecha)}</div></div><select data-post="${p.id}" aria-label="Etapa">${opt(ETAPAS,p.etapa)}</select></div>`;}).join("")}</div>`:`<div class="muted" style="font-size:13px">No participó de procesos todavía.</div>`}
    <div class="toolbar"><select id="c-addb" aria-label="Búsqueda"><option value="">Sumar a una búsqueda activa…</option>${sortBy(activas(),b=>b.cliente).filter(b=>!ps.some(p=>p.busquedaId===b.id)).map(b=>`<option value="${b.id}">${esc(b.cliente)} · ${esc(b.puesto)}</option>`).join("")}</select><button class="btn sm" data-act="candToBusq" data-id="${id}">Sumar</button></div></div>`;
  }
  if(id) body+=archivosSection("candidatos",id);
  body+=minutasSection(c.minutas);
  if(id) body+=histSection("candidatos",id);
  openDrawer(id?c.nombre:"Nuevo candidato", id?esc([c.rolActual,c.empresaActual].filter(Boolean).join(" · ")):"", body, {save:{label:id?"Guardar":"Crear candidato"}, del:id&&isAdmin?{label:"Eliminar"}:null});
  drawerSave.save.fn=async()=>{
    const nombre=gv("c-nom"); if(!nombre){toast("Falta el nombre.",true);return;}
    const li=gv("c-li");
    if(!id){ const dup=vals(S.candidatos).find(x=>keyN(x.nombre)===keyN(nombre)||(li&&x.linkedin&&keyN(x.linkedin)===keyN(li))||(gv("c-em")&&x.email&&x.email.trim().toLowerCase()===gv("c-em").toLowerCase()));
      if(dup&&!drawerSave.dupOk){ drawerSave.dupOk=true; toast(`Ya existe “${dup.nombre}”. Guardá de nuevo para crear igual.`,true); return; } }
    const doc={...(id?c:{}),nombre,linkedin:li,email:gv("c-em"),telefono:gv("c-tel"),ubicacion:gv("c-ub"),rolActual:gv("c-rol"),empresaActual:gv("c-emp"),
      area:gv("c-area"),seniority:gv("c-sen"),pretension:gv("c-pre"),tags:gv("c-tags").split(",").map(t=>t.trim()).filter(Boolean),notas:gv("c-not"),minutas:flushMin(),creado:c.creado||today(),fuente:c.fuente||"Sistema"};
    delete doc.id;
    const cid=id||newId("c");
    if(!await write("candidatos/"+cid,doc)) return;
    if(!id&&busquedaId){ await write("postulaciones/"+newId("p"),{busquedaId,candidatoId:cid,etapa:gv("c-etapa")||"Sourcing",motivo:"",fecha:today(),notas:""}); }
    toast(id?"Candidato actualizado":"Candidato creado"); closeDrawer();
  };
  if(drawerSave.del) drawerSave.del.fn=async()=>{ if(drawerSave.del.armed){ for(const p of postsOfCand(id)) await write("postulaciones/"+p.id,null,"delete"); if(await write("candidatos/"+id,null,"delete")){toast("Candidato eliminado");closeDrawer();} } else { drawerSave.del.armed=true; $("[data-act=drawerDel]").textContent="Confirmar: eliminar"; } };
}
function drawerAddPost(bid){
  const b=S.busquedas[bid]; if(!b) return;
  const existing=new Set(postsOf(bid).map(p=>p.candidatoId));
  const opts=sortBy(vals(S.candidatos).filter(c=>!existing.has(c.id)),c=>c.nombre);
  const body=`<div class="note">Elegí alguien de la base o creá un candidato nuevo.</div>
    <div class="form"><div class="f full"><label for="ap-c">Candidato de la base</label><input id="ap-c" type="text" list="dl-cands" placeholder="Escribí el nombre"></div>
    ${fsel("Etapa","ap-e",ETAPAS.slice(0,7),"Sourcing")}${field("Nota","ap-n","")}</div>${datalist("dl-cands",opts.map(c=>c.nombre+(c.rolActual?" — "+c.rolActual:"")))}`;
  openDrawer("Sumar candidato",`${esc(b.puesto)} · ${esc(b.cliente)}`,body,{save:{label:"Sumar al pipeline"},extra:`<button class="btn" data-act="newCandFor" data-id="${bid}">Crear candidato nuevo</button>`});
  drawerSave.save.fn=async()=>{
    const v=gv("ap-c"); const nm=v.split(" — ")[0].trim();
    const c=opts.find(x=>keyN(x.nombre)===keyN(nm));
    if(!c){ toast("No está en la base. Usá “Crear candidato nuevo”.",true); return; }
    if(await write("postulaciones/"+newId("p"),{busquedaId:bid,candidatoId:c.id,etapa:gv("ap-e"),motivo:"",fecha:today(),notas:gv("ap-n")})){ toast("Candidato sumado"); closeDrawer(); }
  };
}

// ---- lead ----
function drawerLead(id){
  const l=id?S.leads[id]:{etapa:"Identificado",fechaPrimerContacto:today(),contactos:[]}; if(!l) return;
  const cts=(l.contactos&&l.contactos.length)?l.contactos:(l.contacto?[{nombre:l.contacto,cargo:l.cargo,linkedin:l.linkedin}]:[]);
  const ctRow=(c,i)=>`<tr><td><input id="lc-n-${i}" type="text" value="${esc(c.nombre||"")}" placeholder="Nombre" style="width:100%"></td><td><input id="lc-c-${i}" type="text" value="${esc(c.cargo||"")}" placeholder="Cargo" style="width:100%"></td><td><input id="lc-m-${i}" type="text" value="${esc(c.email||"")}" placeholder="Email" style="width:100%"></td><td><input id="lc-l-${i}" type="text" value="${esc(c.linkedin||"")}" placeholder="LinkedIn" style="width:100%"></td></tr>`;
  const body=`<div class="form">${field("Empresa","l-emp",l.empresa,"text","full")}
    ${fsel("Etapa","l-eta",ETAPAS_LEAD,l.etapa)}${fsel("Origen","l-ori",["",...ORIGENES_LEAD],l.origen)}
    ${fsel("Canal de contacto","l-can",["",...CANALES_LEAD],l.canal)}${fsel("ICP","l-icp",["",...((S.equipo&&S.equipo.icps)||["Scale Up Nativa","Growth Consolidado","Creativas Ágiles","LATAM Talent Hub","Early stage"])],l.icp)}
    <div id="l-perd" class="full" style="display:${l.etapa==="Perdido"?"grid":"none"};grid-template-columns:1fr 1fr;gap:10px">${fsel("Motivo de pérdida","l-mot",["",...MOTIVOS_PERDIDA],l.motivoPerdida)}${field("Reactivar el","l-rea",l.reactivar,"date")}</div>
    ${field("Fee propuesto / acordado","l-fee",l.fee)}${field("Próximo seguimiento","l-fs",l.proximoSeguimiento,"date")}
    ${field("Primer contacto","l-fp",l.fechaPrimerContacto,"date")}${field("Último contacto","l-fu",l.fechaUltimoContacto,"date")}
    ${farea("Notas","l-not",l.notas)}</div>
  <div class="section"><div class="panel-head"><span class="label">Contactos</span><button class="btn sm" data-act="lcAdd">Agregar contacto</button></div>
    <div class="tablewrap"><table><tbody id="lc-rows">${(cts.length?cts:[{}]).map(ctRow).join("")}</tbody></table></div></div>
  <div class="note">Criterio de etapas: <b>Identificado</b> sin contacto · <b>Contactado</b> mensaje enviado (seguimiento a 7 días) · <b>En conversación</b> respondieron con interés o hubo reunión · <b>Propuesta enviada</b> con fecha y fee · <b>Ganado</b> abrieron la primera búsqueda (pasa a Clientes) · <b>Perdido</b> con motivo.</div>
  ${minutasSection(l.minutas)}`;
  openDrawer(id?l.empresa:"Nuevo lead",id?pillLead(l.etapa):"",body,{save:{label:id?"Guardar":"Crear lead"},del:id?{label:"Eliminar"}:null,extra:id?`<button class="btn" data-act="leadTouch" data-id="${id}">Registrar contacto hoy</button>`:""});
  drawerSave.rows=Math.max(1,cts.length); drawerSave.ctRow=ctRow;
  const sel=$("#l-eta"); if(sel) sel.addEventListener("change",()=>{ const p=$("#l-perd"); if(p) p.style.display=sel.value==="Perdido"?"grid":"none";
    const fs=$("#l-fs"); if(fs&&!fs.value&&["Contactado","En conversación","Propuesta enviada"].includes(sel.value)) fs.value=addDays(today(),7);
    if(sel.value==="Perdido"){ const r=$("#l-rea"); if(r&&!r.value) r.value=addDays(today(),90); } });
  drawerSave.save.fn=async()=>{
    const emp=gv("l-emp"); if(!emp){toast("Falta la empresa.",true);return;}
    const etapa=gv("l-eta");
    if(etapa==="Perdido"&&!gv("l-mot")){ toast("Elegí el motivo de pérdida.",true); return; }
    if(["Contactado","En conversación","Propuesta enviada"].includes(etapa)&&!gv("l-fs")){ toast("Poné la fecha del próximo seguimiento.",true); return; }
    const contactos=[]; for(let i=0;i<drawerSave.rows;i++){ const c={nombre:gv("lc-n-"+i),cargo:gv("lc-c-"+i),email:gv("lc-m-"+i),linkedin:gv("lc-l-"+i)}; if(c.nombre||c.email||c.linkedin) contactos.push(c); }
    if(!id){ const dup=vals(S.leads).find(x=>keyN(x.empresa)===keyN(emp)&&!["Ganado","Perdido"].includes(x.etapa)); if(dup&&!drawerSave.dupOk){ drawerSave.dupOk=true; toast(`Ya hay un lead abierto de ${dup.empresa}: sumá el contacto ahí. Guardá de nuevo para crear igual.`,true); return; } }
    const p0=contactos[0]||{};
    const doc={...(id?l:{}),empresa:emp,etapa,origen:gv("l-ori"),canal:gv("l-can"),icp:gv("l-icp"),fee:gv("l-fee"),motivoPerdida:etapa==="Perdido"?gv("l-mot"):"",reactivar:etapa==="Perdido"?gv("l-rea"):"",
      contactos,contacto:p0.nombre||"",cargo:p0.cargo||"",linkedin:p0.email||p0.linkedin||"",
      fechaPrimerContacto:gv("l-fp"),fechaUltimoContacto:gv("l-fu"),proximoSeguimiento:["Ganado","Perdido"].includes(etapa)?"":gv("l-fs"),notas:gv("l-not"),minutas:flushMin()};
    if(["Ganado","Perdido"].includes(etapa)&&l.etapa!==etapa) doc.fechaUltimoContacto=today();
    delete doc.id;
    const lid=id||newId("l");
    if(!await write("leads/"+lid,doc)) return;
    if(etapa==="Ganado"){
      const ex=vals(S.clientes).find(c=>keyN(c.nombre)===keyN(emp));
      const lineas=contactos.map(c=>[c.nombre,c.cargo,c.email||c.linkedin].filter(Boolean).join(" · "));
      if(!ex) await write("clientes/cl-"+keyN(emp).slice(0,40),{nombre:emp,icp:doc.icp,feeAcordado:doc.fee,contactos:lineas.join("\n"),notas:doc.notas||"",origen:doc.origen||"Lead ganado",oportunidades:[]});
      else { const prev=ex.contactos||""; const nuevas=lineas.filter(x=>!prev.includes(x.split(" · ")[0])); if(nuevas.length) await write("clientes/"+ex.id,{contactos:[prev,...nuevas].filter(Boolean).join("\n")},"update"); }
      toast(ex?"Lead ganado: se actualizó el cliente":"Lead ganado: se creó el cliente");
      if(S.cliDocs&&!tieneDoc(emp)){ drawerCliente(keyN(emp)); toast("Lead ganado: subí ahora la propuesta o el contrato del cliente"); return; }
    } else toast(id?"Lead actualizado":"Lead creado");
    closeDrawer();
  };
  if(drawerSave.del) drawerSave.del.fn=async()=>{ if(drawerSave.del.armed){ if(await write("leads/"+id,null,"delete")){toast("Lead eliminado");closeDrawer();} } else { drawerSave.del.armed=true; $("[data-act=drawerDel]").textContent="Confirmar: eliminar"; } };
}

function drawerCliente(k){
  const st=k?clienteStats().find(c=>c.k===k):null; const c=st?.doc||{nombre:st?.nombre||""};
  const ops=c.oportunidades||[];
  const body=`<div class="form">${field("Nombre","cl-nom",c.nombre,"text","full")}
    ${fsel("ICP","cl-icp",["",...((S.equipo&&S.equipo.icps)||["Scale Up Nativa","Growth Consolidado","Creativas Ágiles","LATAM Talent Hub","Early stage"])],c.icp)}${field("Fee acordado","cl-fee",c.feeAcordado)}
    ${fsel("Origen","cl-ori",["",...ORIGENES_LEAD,"Lead ganado"],c.origen)}
    ${farea("Contactos (uno por línea: nombre · cargo · mail)","cl-con",c.contactos)}${farea("Notas","cl-not",c.notas)}</div>
    ${docsSection(c.nombre||"")}
    ${st?`<div class="kpis">${kpi("Estado",st.estado,st.act?"tiene búsquedas abiertas":st.estado==="Reciente"?"búsqueda en los últimos 6 meses":"sin búsquedas hace más de 6 meses")}${kpi("Búsquedas",st.total,`${st.cerradas} cerradas · ${st.act} activas`)}${kpi("Facturado",usd(st.fact),"US$ eq.")}</div>`:""}
    ${c.id||st?`<div class="section"><div class="panel-head"><span class="label">Oportunidades (nuevas búsquedas en conversación)</span></div>
      ${ops.length?`<div class="list">${sortBy(ops,o=>o.fecha||"",-1).map(o=>`<div class="row"><div class="grow"><b>${esc(o.puesto)}</b><div class="muted">${fd(o.fecha)}${o.notas?" · "+esc(o.notas):""}</div></div><span class="pill ${o.estado==="Abierta"?"lemon":o.estado==="Convertida"?"ok":""}">${esc(o.estado)}</span>${o.estado==="Abierta"?`<button class="btn sm" data-act="opConvertir" data-id="${esc(o.id)}">Abrir búsqueda</button><button class="btn sm ghost" data-act="opPerder" data-id="${esc(o.id)}">Perdida</button>`:""}</div>`).join("")}</div>`:`<div class="muted" style="font-size:13px">Sin oportunidades abiertas.</div>`}
      <div class="toolbar"><input id="op-p" type="text" placeholder="Puesto que están evaluando" style="flex:1;min-width:160px"><input id="op-n" type="text" placeholder="Notas (opcional)" style="flex:1;min-width:140px"><button class="btn sm" data-act="opAdd">Agregar oportunidad</button></div></div>`:""}
    ${minutasSection(c.minutas)}
    ${st?`<div class="section"><span class="label">Búsquedas</span><div class="list">${sortBy(st.bus,b=>b.fechaInicio||"",-1).map(b=>`<div class="row"><div class="grow"><div><a href="#" data-act="openBusqueda" data-id="${b.id}">${esc(b.puesto)}</a></div><div class="muted">${fd(b.fechaInicio)} · ${esc(b.recruiter||"")}</div></div>${pillEstado(b.estado)}</div>`).join("")||'<div class="muted">Sin búsquedas.</div>'}</div></div>`:""}`;
  openDrawer(c.nombre||"Nuevo cliente",st?st.estado:"",body,{save:{label:"Guardar"}});
  const did=c.id||("cl-"+keyN(c.nombre||"").slice(0,40));
  drawerSave.cliente={did,doc:c,k};
  drawerSave.save.fn=async()=>{
    const nombre=gv("cl-nom"); if(!nombre){toast("Falta el nombre.",true);return;}
    const id2=c.id||("cl-"+keyN(nombre).slice(0,40));
    const doc={...c,nombre,icp:gv("cl-icp"),feeAcordado:gv("cl-fee"),origen:gv("cl-ori"),contactos:gv("cl-con"),notas:gv("cl-not"),minutas:flushMin(),oportunidades:(S.clientes[id2]||c).oportunidades||ops}; delete doc.id;
    if(c.id&&c.nombre&&c.nombre!==nombre){ try{ const r=await api("/api/clientes/renombrar",{method:"POST",body:JSON.stringify({de:c.nombre,a:nombre})}); toast(`Renombrado también en ${r.cambios.busquedas} búsquedas, ${r.cambios.facturas} facturas y ${r.cambios.leads} leads`); refresh("busquedas"); refresh("facturas"); refresh("leads"); }catch(e){ if(e.code!==401) toast(e.message||"No se pudo renombrar.",true); return; } }
    if(await write("clientes/"+id2,doc)){toast("Cliente guardado");closeDrawer();}
  };
}
async function opGuardar(fn){
  const ctx=drawerSave&&drawerSave.cliente; if(!ctx) return;
  const nombre=gv("cl-nom")||ctx.doc.nombre; const id2=ctx.doc.id||("cl-"+keyN(nombre).slice(0,40));
  const base=S.clientes[id2]||{...ctx.doc,nombre}; const ops=fn([...(base.oportunidades||[])]);
  const doc={...base,oportunidades:ops}; delete doc.id;
  if(await write("clientes/"+id2,doc)){ drawerCliente(ctx.k||keyN(nombre)); }
}
function leadsCol(list,e){
  let it=list.filter(l=>l.etapa===e||(e==="Identificado"&&l.etapa==="Nuevo"));
  if(e==="Ganado"&&!UI.lQ) it=it.filter(l=>(days(l.fechaUltimoContacto||l.fechaPrimerContacto)??0)<=30);
  if(e==="Perdido"&&!UI.lQ) it=it.filter(l=>(days(l.fechaUltimoContacto||l.fechaPrimerContacto)??0)<=90||(l.reactivar&&l.reactivar<=today()));
  return it;
}

function drawerFactura(id,{bid}={}){
  const b=bid?S.busquedas[bid]:null;
  const f=id?S.facturas[id]:{moneda:"ARS",fechaEmision:today(),tipo:"Cierre",emisor:"MATI",cliente:b?.cliente||"",recruiter:b?.recruiter||"",concepto:b?`${b.puesto}`:"",busquedaId:bid||"",cobrada:false,comisionPagada:false};
  if(!f) return;
  const recs=recruiters().map(r=>r.nombre); if(f.recruiter&&!recs.includes(f.recruiter)) recs.push(f.recruiter);
  const bus=sortBy(B(),x=>x.fechaInicio||"",-1).slice(0,150);
  const body=`<div class="form">
    ${fdl("Cliente","fc-cli",f.cliente,"dl-cli")}${fsel("Búsqueda","fc-bid",[{v:"",l:"Sin vincular"},...bus.map(x=>({v:x.id,l:`${x.cliente} · ${x.puesto}`}))],f.busquedaId)}
    ${field("Concepto","fc-con",f.concepto,"text","full")}
    ${fsel("Tipo","fc-tipo",TIPOS_FC,f.tipo)}${fsel("Emitida por","fc-emi",EMISORES,f.emisor)}
    ${field("Monto","fc-mon",f.monto,"number")}${fsel("Moneda","fc-mnd",["ARS","USD"],f.moneda)}
    ${field("Fecha de emisión","fc-fe",f.fechaEmision,"date")}${field("Pago estimado","fc-fp",f.fechaPagoEstimada,"date")}
    <label class="check"><input id="fc-cob" type="checkbox"${f.cobrada?" checked":""}> Cobrada</label>${field("Fecha de cobro","fc-fcob",f.fechaCobro,"date")}
    ${fsel("Recruiter","fc-rec",["",...recs],f.recruiter)}${field("Comisión recruiter","fc-com",f.comision,"number")}
    ${fsel("Moneda comisión","fc-cmnd",["ARS","USD"],f.monedaComision||f.moneda)}<label class="check"><input id="fc-cpag" type="checkbox"${f.comisionPagada?" checked":""}> Comisión pagada</label>${field("Fecha de pago de la comisión","fc-fpc",f.fechaPagoComision,"date")}
    ${farea("Comentarios","fc-txt",f.comentarios)}</div>${datalist("dl-cli",clientNames())}
    <div><button class="btn sm" data-act="calcCom">Calcular comisión con el % de la recruiter</button></div>
    ${f.historico?`<div class="note">Registro histórico importado de la planilla de Gestión Procesos.</div>`:""}`;
  openDrawer(id?`${f.concepto}`:"Nueva factura",id?`${esc(f.cliente)} · ${money(f.monto,f.moneda)}`:"",body,{save:{label:id?"Guardar":"Registrar factura"},del:id?{label:"Eliminar"}:null});
  drawerSave.save.fn=async()=>{
    const monto=gn("fc-mon"); let cli=gv("fc-cli"); if(!monto||!cli){toast("Completá cliente y monto.",true);return;}
    { const canon=clienteCanonico(cli); if(canon) cli=canon; else if(!drawerSave.cliNuevo){ drawerSave.cliNuevo=true; toast(`“${cli}” no es un cliente existente. Revisá cómo está escrito o guardá de nuevo para usarlo igual.`,true); return; } }
    if(!gv("fc-bid")&&!drawerSave.sinBusq&&!f.historico){ drawerSave.sinBusq=true; toast("La factura no está vinculada a una búsqueda. Elegila arriba, o guardá de nuevo para dejarla sin vincular.",true); return; }
    const cob=gv("fc-cob");
    const doc={...(id?f:{}),cliente:cli,busquedaId:gv("fc-bid"),concepto:gv("fc-con"),tipo:gv("fc-tipo"),emisor:gv("fc-emi"),monto,moneda:gv("fc-mnd"),
      fechaEmision:gv("fc-fe"),fechaPagoEstimada:gv("fc-fp"),cobrada:cob,fechaCobro:gv("fc-fcob")||(cob?today():""),recruiter:gv("fc-rec"),comision:gn("fc-com")||0,
      monedaComision:gv("fc-cmnd"),comisionPagada:gv("fc-cpag"),fechaPagoComision:gv("fc-fpc")||(gv("fc-cpag")&&!f.comisionPagada?today():(f.fechaPagoComision||"")),comentarios:gv("fc-txt"),historico:!!f.historico};
    delete doc.id;
    if(await write("facturas/"+(id||newId("f")),doc)){toast(id?"Factura actualizada":"Factura registrada");closeDrawer();}
  };
  if(drawerSave.del) drawerSave.del.fn=async()=>{ if(drawerSave.del.armed){ if(await write("facturas/"+id,null,"delete")){toast("Factura eliminada");closeDrawer();} } else { drawerSave.del.armed=true; $("[data-act=drawerDel]").textContent="Confirmar: eliminar"; } };
}

// ---- mes ----
function drawerMes(k){
  const p=pnl(k), sistema=p.source==="sistema", m=S.meses[k]||{};
  const fs=sortBy(vals(S.facturas).filter(f=>!f.historico&&ym(f.fechaEmision)===k),f=>f.fechaEmision||"");
  let body=`<div class="kpis">${kpi("Ingresos",usd(p.ingTot),`${ars(p.ingARS)} + ${usd(p.ingUSD)}`)}${isAdmin?kpi("Gastos",usd(p.gasTot),"US$ eq.")+kpi("Resultado",usd(p.res),`margen ${pct(p.margen)}`):""}</div>`;
  body+=`<div class="section"><div class="panel-head"><span class="label">Facturas emitidas (${fs.length})</span><span class="muted num">TC ${nf0.format(p.tc)}</span></div>${fs.length?`<div class="list">${fs.map(f=>`<div class="row click" data-act="openFactura" data-id="${f.id}"><div class="grow" style="min-width:0"><b>${esc(f.cliente)}</b><div class="muted" style="font-size:12px">${esc(f.concepto||"")} · ${fd(f.fechaEmision)}</div></div><div style="text-align:right"><div class="num">${money(f.monto,f.moneda)}</div>${f.cobrada?'<span class="pill ok">Cobrada</span>':'<span class="pill warn">Por cobrar</span>'}</div></div>`).join("")}</div>`:`<div class="muted" style="font-size:13px">${p.source==="planilla"?"Mes anterior a las facturas: los ingresos vienen de la planilla Economics.":"No hay facturas emitidas este mes."}</div>`}</div>`;
  if(isAdmin){
    const porCat={}; p.gastos.forEach(g=>{ const c=g.categoria||(sistema?"Otros":"Planilla"); porCat[c]=(porCat[c]||0)+toUSD(g.monto,g.moneda,k); });
    body+=`<div class="section"><span class="label">Gastos por categoría (US$ eq.)</span>${p.gastos.length?barras(sortBy(Object.entries(porCat),x=>x[1],-1),v=>usd(v)):'<div class="muted" style="font-size:13px">Sin gastos cargados.</div>'}</div>
    <div class="section"><span class="label">Detalle de gastos</span>${p.gastos.length?`<div class="list">${sortBy(p.gastos,g=>-toUSD(g.monto,g.moneda,k)).map(g=>`<div class="row${g.id?" click":""}"${g.id?` data-act="openGasto" data-id="${g.id}"`:""}><div class="grow"><div>${esc(g.concepto)}</div>${g.categoria?`<div class="muted" style="font-size:12px">${esc(g.categoria)}</div>`:""}</div><span class="num">${money(g.monto,g.moneda)}</span></div>`).join("")}</div>`:""}
    ${sistema?`<div><button class="btn sm" data-act="irGastos" data-v="${k}">Cargar o editar gastos de ${fm(k)}</button></div>`:`<div class="note">Gastos importados de la planilla Economics (solo lectura).</div>`}</div>`;
    if(sistema) body+=`<div class="section"><span class="label">Tipo de cambio</span><div class="form">${field("ARS por USD de "+fm(k),"m-tc",m.tc||p.tc,"number")}</div></div>`;
  }
  openDrawer("Detalle de "+fm(k),p.source==="planilla"?"Planilla Economics":p.source==="facturas"?"Ingresos de facturas · gastos de la planilla":"Ingresos de facturas · gastos cargados",body,isAdmin&&sistema?{save:{label:"Guardar tipo de cambio"}}:{});
  if(isAdmin&&sistema) drawerSave.save.fn=async()=>{ const tc=gn("m-tc"); if(!tc){ toast("Cargá el tipo de cambio.",true); return; } if(await write("economics/m-"+k,{mes:k,tc})){ toast("Tipo de cambio guardado"); drawerMes(k); } };
}

// ---------- events ----------
document.addEventListener("click",async e=>{
  const t=e.target.closest("[data-act]"); if(!t) return;
  if(t.tagName==="SELECT"||e.target.tagName==="SELECT") return;
  const a=t.dataset.act, id=t.dataset.id, v=t.dataset.v;
  if(t.tagName==="A"||t.tagName==="BUTTON") e.preventDefault();
  t.closest("details.menu")?.removeAttribute("open");
  switch(a){
    case "closeDrawer": closeDrawer(); break;
    case "drawerSave": if(drawerSave?.save?.fn){ t.disabled=true; try{ await drawerSave.save.fn(); } finally { t.disabled=false; } } break;
    case "drawerDel": drawerSave?.del?.fn && drawerSave.del.fn(); break;
    case "bEstado": UI.bEstado=v; if(v!=="Activa"&&UI.bMode==="cards") UI.bMode="table"; if(v==="Activa") UI.bMode="cards"; render(); break;
    case "bMode": UI.bMode=v; render(); break;
    case "cTab": UI.cTab=v; render(); break;
    case "crmTab": UI.crmTab=v; render(); break;
    case "fTab": UI.fTab=v; render(); break;
    case "ecoYear": UI.ecoYear=+v; render(); break;
    case "newBusqueda": drawerBusqueda(null); break;
    case "openBusqueda": if(id){ if(location.hash==="#busqueda/"+encodeURIComponent(id)) route(); else location.hash="#busqueda/"+encodeURIComponent(id); } else drawerBusqueda(null); break;
    case "editBusqueda": drawerBusqueda(id); if(id) cargarHistSection("busquedas",id); break;
    case "linkCliente": drawerLink(id); break;
    case "copyLink": { const i=$("#lk-url"); if(i){ try{ await navigator.clipboard.writeText(i.value); toast("Link copiado"); }catch(err){ i.select(); toast("Seleccionado: copialo con Ctrl+C",true); } } break; }
    case "unlinkCliente": if(!confirm("¿Desactivar el link? El cliente ya no va a poder abrirlo.")) break; try{ await api("/api/links/"+encodeURIComponent(id),{method:"DELETE"}); toast("Link desactivado"); drawerLink(id); }catch(err){ if(err.code!==401) toast(err.message||"No se pudo desactivar.",true); } break;
    case "pipeFicha": UI.cBusq=id; descargarExcel(datosExport("pipeline"),EXPORT_NOMBRE.pipeline||"pipeline"); break;
    case "weeklyUpdate": drawerWeekly(id); break;
    case "newCandidato": drawerCandidato(null); break;
    case "openCandidato": drawerCandidato(id); if(id){ cargarArchivos("candidatos",id); cargarHistSection("candidatos",id); } break;
    case "newCandFor": drawerCandidato(null,{busquedaId:id}); break;
    case "addPost": drawerAddPost(id); break;
    case "candToBusq": { const bid=gv("c-addb"); if(!bid){toast("Elegí una búsqueda.",true);break;} if(await write("postulaciones/"+newId("p"),{busquedaId:bid,candidatoId:id,etapa:"Sourcing",motivo:"",fecha:today(),notas:""})){toast("Sumado a la búsqueda"); drawerCandidato(id);} break; }
    case "newLead": drawerLead(null); break;
    case "openLead": drawerLead(id); break;
    case "leadTouch": { const l=S.leads[id]; const et=["Nuevo","Identificado"].includes(l.etapa)?"Contactado":l.etapa; if(await write("leads/"+id,{fechaUltimoContacto:today(),etapa:et,proximoSeguimiento:["Ganado","Perdido"].includes(et)?l.proximoSeguimiento:addDays(today(),7)},"update")){toast("Contacto registrado · seguimiento en 7 días"); closeDrawer();} break; }
    case "lcAdd": { const i=drawerSave.rows++; $("#lc-rows").insertAdjacentHTML("beforeend",drawerSave.ctRow({},i)); break; }
    case "opAdd": { const p=gv("op-p"); if(!p){ toast("Escribí el puesto.",true); break; } await opGuardar(ops=>[...ops,{id:newId("op"),fecha:today(),puesto:p,notas:gv("op-n"),estado:"Abierta"}]); toast("Oportunidad agregada"); break; }
    case "opPerder": await opGuardar(ops=>ops.map(o=>o.id===id?{...o,estado:"Perdida",cerrada:today()}:o)); break;
    case "opConvertir": { const ctx=drawerSave.cliente; const nombre=gv("cl-nom")||ctx.doc.nombre; const id2=ctx.doc.id||("cl-"+keyN(nombre).slice(0,40)); const o=((S.clientes[id2]||ctx.doc).oportunidades||[]).find(x=>x.id===id); if(!o) break;
      if(S.cliDocs&&!tieneDoc(nombre)){ toast(MSG_SIN_DOC(nombre),true); break; } const bid=newId("b"); if(!await write("busquedas/"+bid,{puesto:o.puesto,cliente:nombre,estado:"Activa",fechaInicio:today(),detalle:o.notas||"",bitacora:[],minutas:[],actualizado:today()})) break;
      await opGuardar(ops=>ops.map(x=>x.id===id?{...x,estado:"Convertida",busquedaId:bid,cerrada:today()}:x)); toast("Búsqueda creada: completá recruiter y datos"); drawerBusqueda(bid); break; }
    case "newCliente": drawerCliente(null); break;
    case "openCliente": drawerCliente(id); break;
    case "newFactura": drawerFactura(null,{bid:t.dataset.bid}); break;
    case "openFactura": drawerFactura(id); break;
    case "markCobrada": case "unCobrada": case "markComision": case "unComision": case "payGasto": case "unGasto": {
      e.stopPropagation();
      const M={markCobrada:["facturas",{cobrada:true,fechaCobro:today()},{cobrada:false,fechaCobro:""},"Factura marcada como cobrada"],
        unCobrada:["facturas",{cobrada:false,fechaCobro:""},null,"La factura volvió a Por cobrar"],
        markComision:["facturas",{comisionPagada:true,fechaPagoComision:today()},{comisionPagada:false,fechaPagoComision:""},"Comisión marcada como pagada"],
        unComision:["facturas",{comisionPagada:false,fechaPagoComision:""},null,"La comisión volvió a pendiente"],
        payGasto:["gastos",{pagado:true,fechaPago:today()},{pagado:false,fechaPago:""},"Gasto marcado como pagado"],
        unGasto:["gastos",{pagado:false,fechaPago:""},null,"El gasto volvió a pendiente"]}[a];
      const col=M[0], prev=S[col==="facturas"?"facturas":"gastos"][id]||{};
      const undo=M[2]||Object.fromEntries(Object.keys(M[1]).map(k=>[k,prev[k]??""]));
      if(await write(`${col}/${id}`,M[1],"update")) toastUndo(M[3],async()=>{ if(await write(`${col}/${id}`,undo,"update")) toast("Listo, se deshizo"); });
      break; }
    case "undo": { const f=undoFn; undoFn=null; $("#toastHost").innerHTML=""; if(f) await f(); break; }
    case "gMes": UI.gMes=v; render(); break;
    case "scDet": drawerMetrica(v); break;
    case "cfgTab": UI.cfgTab=v; history.replaceState(null,"","#config/"+v); abrirTabConfig(); render(); break;
    case "editEquipo": drawerEquipo(); break;
    case "openRecruiter": location.hash="#recruiter/"+encodeURIComponent(id); break;
    case "recPer": UI.recPer=v; render(); break;
    case "recB": UI.recB=v; render(); break;
    case "newGasto": drawerGasto(null); break;
    case "openGasto": drawerGasto(id); break;
    case "omitGasto": { const g=S.gastos[id]; if(g&&await write("gastos/"+id,{omitido:!g.omitido},"update")){ toast(g.omitido?"El gasto vuelve a contar este mes":"Listo: este mes no se cuenta"); closeDrawer(); } break; }
    case "newRecurrente": drawerRecurrente(null); break;
    case "openRecurrente": drawerRecurrente(id); break;
    case "irGastos": UI.fTab="gastos"; UI.gMes=v; closeDrawer(); if(location.hash!=="#cobros") location.hash="#cobros"; else render(); break;
    case "calcCom": { const r=recruiters().find(x=>x.nombre===gv("fc-rec")); const m=gn("fc-mon"); if(!r||!m){toast("Elegí recruiter y monto.",true);break;} document.getElementById("fc-com").value=Math.round(m*(+r.comisionPct||0)/100); document.getElementById("fc-cmnd").value=gv("fc-mnd"); break; }
    case "openMes": if(canFin) drawerMes(id); break;
    case "newFeedback": drawerFeedback(null); break;
    case "openFeedback": drawerFeedback(id); break;
    case "fbEstado": UI.fbEstado=v; render(); break;
    case "newUser": drawerUser(null); break;
    case "resetPass": drawerUser(id); break;
    case "saveUser": try{ await api("/api/users/"+id,{method:"PATCH",body:JSON.stringify(isAdmin?{rol:gv("u-r-"+id),activo:gv("u-a-"+id)}:{activo:gv("u-a-"+id)})}); toast("Usuario actualizado"); refresh("users"); }catch(e){ if(e.code!==401) toast(e.message||"No se pudo guardar.",true); } break;
    case "pEstado": UI.pEstado=v; render(); break;
    case "scPer": UI.scPer=v; UI.scOff=0; UI.mesOff=0; render(); break;
    case "wkTab": case "iniTab": UI.iniTab=v; if(v!=="hoy") UI.wkTab=v; if(view!=="panel"){ location.hash="#panel"; } else render(); break;
    case "mesNav": UI.mesOff= +v===0?0:Math.max(0,(UI.mesOff||0)+(+v)); render(); break;
    case "wkSoloSin": UI.wkSoloSin=!UI.wkSoloSin; render(); break;
    case "attG": UI.attG=v; render(); break;
    case "scOff": UI.scOff=Math.max(0,(UI.scOff||0)+(+v)); render(); break;
    case "propAprobar": t.disabled=true; await propAprobar(id); t.disabled=false; break;
    case "propEditar": drawerPropuesta(id); break;
    case "propRechazar": try{ await api("/api/propuestas/"+encodeURIComponent(id)+"/rechazar",{method:"POST"}); S.propuestas[id]={...S.propuestas[id],estado:"Rechazada"}; toast("Propuesta rechazada"); schedule(); refresh("propuestas"); }catch(e){ if(e.code!==401) toast(e.message||"No se pudo rechazar.",true); } break;
    case "uniLink": { t.disabled=true; try{ const r=await api("/api/unipile/link",{method:"POST",body:JSON.stringify({proveedor:v})}); const w=window.open(r.url,"_blank"); if(!w) location.href=r.url; else toast("Seguí los pasos en la pestaña nueva y volvé acá."); }catch(e){ if(e.code!==401) toast(e.message||"No se pudo generar el link.",true); } t.disabled=false; break; }
    case "uniSave": try{ await api("/api/unipile/cuentas/"+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({filtro:gv("uni-f-"+t.dataset.i)})}); toast("Guardado"); refresh("conexiones"); }catch(e){ if(e.code!==401) toast(e.message||"No se pudo guardar.",true); } break;
    case "uniDel": if(!t.dataset.armed){ t.dataset.armed="1"; t.textContent="Confirmar: desconectar"; break; } try{ await api("/api/unipile/cuentas/"+encodeURIComponent(id),{method:"DELETE"}); toast("Cuenta desconectada"); refresh("conexiones"); }catch(e){ if(e.code!==401) toast(e.message||"No se pudo desconectar.",true); } break;
    case "wkNav": UI.wk = +v===0 ? weekStart() : addDays(UI.wk||weekStart(), +v); if(UI.wk>weekStart()) UI.wk=weekStart(); render(); break;
    case "wkCopy": try{ await navigator.clipboard.writeText(wkTexto()); toast("Resumen copiado: pegalo en WhatsApp o en un mail"); }catch(e){ toast("No se pudo copiar. Probá de nuevo.",true); } break;
    case "exportar": descargarExcel(datosExport(v),EXPORT_NOMBRE[v]||v); break;
    case "repCliente": drawerRepCliente(id); break;
    case "repMensual": drawerRepMensual(); break;
    case "wkPDF": weeklyPDF(); break;
    case "restaurar": try{ const r=await api("/api/papelera/"+encodeURIComponent(id)+"/restaurar",{method:"POST"}); toast("Restaurado"); cargarPapelera(); refresh(r.coleccion); }catch(e){ if(e.code!==401) toast(e.message||"No se pudo restaurar.",true); } break;
    case "cliDocDel": if(!t.dataset.armed){ t.dataset.armed="1"; t.textContent="Confirmar"; break; } try{ await api("/api/archivos/"+encodeURIComponent(id),{method:"DELETE"}); toast("Documento quitado"); await cargarCliDocs(); refrescarDocs(); }catch(e){ if(e.code!==401) toast(e.message||"No se pudo quitar.",true); } break;
    case "archDel": if(!t.dataset.armed){ t.dataset.armed="1"; t.textContent="Confirmar"; break; } try{ await api("/api/archivos/"+encodeURIComponent(id),{method:"DELETE"}); toast("Archivo quitado"); cargarArchivos(t.dataset.col,t.dataset.reg); }catch(e){ if(e.code!==401) toast(e.message||"No se pudo quitar.",true); } break;
    case "myPass": drawerMyPass(); break;
    case "logout": await fetch("/api/logout",{method:"POST"}); location.reload(); break;
    case "minAdd": { const u=gv("min-u"); if(!u){toast("Pegá el link de Granola.",true);break;} flushMin(); $("#min-u").value=""; $("#min-t").value=""; $("#min-list").innerHTML=minList(); toast("Minuta agregada: guardá para confirmar"); break; }
    case "minRemove": { pendingMin.splice(+t.dataset.i,1); $("#min-list").innerHTML=minList(); break; }
    case "addRec": { const eq={...(S.equipo||{}),recruiters:[...recruiters(),{nombre:"Nueva recruiter",activa:true,capacidad:4,comisionPct:20}]}; delete eq.id; if(await write("equipo/config",eq)){ toast("Recruiter agregada: editá el nombre"); if($("#overlay .drawer")) drawerEquipo(); } break; }
    case "saveEquipo": { const n=+t.dataset.n; const list=[]; for(let i=0;i<n;i++){ const nm=gv("rec-n-"+i); if(nm) list.push({nombre:nm,activa:gv("rec-a-"+i),capacidad:gn("rec-c-"+i)||4,comisionPct:gn("rec-p-"+i)||0}); }
      const prevR=(S.equipo&&S.equipo.recruiters)||[]; for(let i=0;i<Math.min(prevR.length,n);i++){ const o=prevR[i]&&prevR[i].nombre, nn=gv("rec-n-"+i); if(o&&nn&&o!==nn){ try{ await api("/api/equipo/renombrar",{method:"POST",body:JSON.stringify({de:o,a:nn})}); }catch(e){} } }
      const eq={...(S.equipo||{}),recruiters:list}; delete eq.id; if(await write("equipo/config",eq)){ toast("Equipo guardado"); closeDrawer(); refresh("busquedas"); refresh("facturas"); } break; }
    case "saveObjetivos": { const o={facturacionMensualARS:gn("o-fac"),ticketPromedioARS:gn("o-tic"),feeMinimoARS:gn("o-fee"),timeToFillDias:gn("o-ttf"),busquedasActivas:gn("o-ba"),propuestasMes:gn("o-pr"),nuevosClientesMes:gn("o-nc")};
      if(await write("objetivos/config",o)) toast("Objetivos guardados"); break; }
  }
});
document.addEventListener("change",async e=>{
  const el=e.target;
  if(el.dataset.post){ const p=S.postulaciones[el.dataset.post]; if(p && el.value==="Descartado" && p.etapa!=="Descartado"){ el.value=p.etapa; drawerDescarte(p.id); return; }
    if(p && p.etapa!==el.value){ if(await write("postulaciones/"+p.id,{etapa:el.value,fecha:today(),...(p.etapa==="Descartado"?{motivo:"",motivoDetalle:""}:{})},"update")){ toast(`Movido a ${el.value}`);
      if(el.value==="Contratado"){ const b=S.busquedas[p.busquedaId], c=S.candidatos[p.candidatoId]; if(b&&c&&!b.candidatoFinal) await write("busquedas/"+b.id,{candidatoFinal:c.nombre,actualizado:today()},"update"); }
      const open=$("#overlay .drawer"); if(open){ /* keep drawer */ } } } return; }
  if(el.dataset.ui && el.tagName==="SELECT"){ UI[el.dataset.ui]=el.value; render(); }
});
document.addEventListener("input",e=>{ const el=e.target; if(el.dataset.ui && el.tagName==="INPUT"){ UI[el.dataset.ui]=el.value; clearTimeout(window.__qt); window.__qt=setTimeout(render,180); } });
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&$("#overlay .drawer")) closeDrawer(); });
function route(){ const h=(location.hash||"#panel").slice(1); if(h==="scorecard"||h==="weekly"){ UI.iniTab=h==="scorecard"?"resumen":(canFin?(UI.wkTab||"resumen"):"busquedas"); history.replaceState(null,"","#panel"); } if(h.startsWith("busqueda/")) UI.fichaId=decodeURIComponent(h.slice(9)); if(h.startsWith("recruiter/")) UI.recNom=decodeURIComponent(h.slice(10)); if(h==="economics"){ UI.fTab="resultados"; history.replaceState(null,"","#cobros"); }
  const alias={ajustes:"usuarios",historial:"historial",calidad:"calidad",conexiones:"conexiones",mejoras:"mejoras"};
  if(alias[h]) UI.cfgTab=alias[h]; if(h.startsWith("config/")) UI.cfgTab=h.slice(7);
  view=h==="economics"?"cobros":(h==="scorecard"||h==="weekly")?"panel":h.startsWith("busqueda/")?"ficha":h.startsWith("recruiter/")?"recruiter":(alias[h]||h==="config"||h.startsWith("config/"))?"config":VIEWS.some(v=>v.id===h)?h:"panel"; closeDrawer(); schedule(); window.scrollTo(0,0); if(view==="config") abrirTabConfig(); }
window.addEventListener("hashchange",route);

// ---------- login ----------
function showLogin(){
  $(".rail").hidden=true; closeDrawer();
  $("#main").innerHTML=`<form class="login" id="loginForm"><div class="brand"><img class="brand-mark" src="/logo.svg" alt="" width="40" height="40"><div><b>Lemon Talent</b><small>Sistema interno</small></div></div>
  <section class="panel"><h2>Ingresar</h2>
  <div class="f"><label for="li-e">Email</label><input id="li-e" type="text" autocomplete="username" inputmode="email"></div>
  <div class="f"><label for="li-p">Contraseña</label><input id="li-p" type="password" autocomplete="current-password"></div>
  <button class="btn primary" type="submit">Ingresar</button><div id="li-err" class="muted"></div></section>
  <p class="muted" style="font-size:12.5px">¿No tenés usuario? Pedíselo a un socio de Lemon Talent.</p></form>`;
  setTimeout(()=>$("#li-e")?.focus(),30);
}
document.addEventListener("submit",async e=>{
  if(e.target.id!=="loginForm") return; e.preventDefault();
  const r=await fetch("/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:$("#li-e").value,password:$("#li-p").value})});
  if(r.ok) location.reload(); else { const j=await r.json().catch(()=>({})); $("#li-err").textContent=j.error||"No se pudo ingresar."; }
});

// ---------- usuarios ----------
function vUsuarios(){
  const us=sortBy(S.users||[],u=>u.nombre);
  const ROLES=[{v:"socio",l:"Socio"},{v:"admin",l:"Administradora"},{v:"recruiter",l:"Recruiter"}];
  const rolLabel=r=>(ROLES.find(x=>x.v===r)||{}).l||r;
  const editable=u=>isAdmin||u.rol==="recruiter";
  return `<section class="panel"><div class="panel-head"><h2>Usuarios y accesos</h2><button class="btn sm" data-act="newUser">Nuevo usuario</button></div>
  <div class="tablewrap"><table><thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Activo</th><th></th></tr></thead><tbody>
  ${us.map(u=>`<tr><td>${esc(u.nombre)}${u.id===me.id?' <span class="tag">vos</span>':""}</td><td>${esc(u.email)}</td><td>${isAdmin?`<select id="u-r-${u.id}">${opt(ROLES,u.rol)}</select>`:esc(rolLabel(u.rol))}</td><td>${editable(u)?`<input id="u-a-${u.id}" type="checkbox"${u.activo?" checked":""} aria-label="Activo">`:(u.activo?"Sí":"No")}</td>
  <td style="white-space:nowrap">${editable(u)?`<button class="btn sm" data-act="saveUser" data-id="${u.id}">Guardar</button> <button class="btn sm ghost" data-act="resetPass" data-id="${u.id}">Nueva contraseña</button>`:""}</td></tr>`).join("")}
  </tbody></table></div>
  <div class="note"><b>Socio</b>: ve y edita todo. <b>Administradora</b>: todo lo de recruiter más facturación y cobros, CRM, ajustes y alta de recruiters; en economics ve ingresos y costos por búsqueda, pero no los gastos ni el resultado. <b>Recruiter</b>: búsquedas, candidatos y pedidos de mejora; el servidor le bloquea los datos de dinero.</div></section>`;
}
function drawerUser(id){
  const u=id?(S.users||[]).find(x=>x.id===id):null;
  const body= u ? `<div class="form">${field("Nueva contraseña (mínimo 8 caracteres)","nu-p","","text","full")}</div><div class="note">Compartile la contraseña por un canal privado y pedile que la cambie desde “Mi contraseña”.</div>`
   : `<div class="form">${field("Nombre","nu-n","","text")}${field("Email","nu-e","","text")}${isAdmin?fsel("Rol","nu-r",[{v:"recruiter",l:"Recruiter"},{v:"admin",l:"Administradora"},{v:"socio",l:"Socio"}],"recruiter"):'<div class="f"><label>Rol</label><div>Recruiter</div></div>'}${field("Contraseña temporal (mínimo 8)","nu-p","","text")}</div>`;
  openDrawer(u?`Contraseña de ${u.nombre}`:"Nuevo usuario","",body,{save:{label:u?"Cambiar contraseña":"Crear usuario"}});
  drawerSave.save.fn=async()=>{
    try{
      if(u) await api("/api/users/"+u.id,{method:"PATCH",body:JSON.stringify({password:gv("nu-p")})});
      else await api("/api/users",{method:"POST",body:JSON.stringify({nombre:gv("nu-n"),email:gv("nu-e"),rol:isAdmin?gv("nu-r"):"recruiter",password:gv("nu-p")})});
      toast(u?"Contraseña actualizada":"Usuario creado"); closeDrawer(); refresh("users");
    }catch(e){ if(e.code!==401) toast(e.message||"No se pudo guardar.",true); }
  };
}
function drawerMyPass(){
  openDrawer("Cambiar mi contraseña","",`<div class="form">${field("Contraseña actual","mp-a","","password","full")}${field("Contraseña nueva (mínimo 8)","mp-n","","password","full")}</div>`,{save:{label:"Cambiar contraseña"}});
  drawerSave.save.fn=async()=>{ try{ await api("/api/me/password",{method:"POST",body:JSON.stringify({actual:gv("mp-a"),nueva:gv("mp-n")})}); toast("Contraseña cambiada"); closeDrawer(); }catch(e){ if(e.code!==401) toast(e.message||"No se pudo cambiar.",true); } };
}

// ---------- pedidos de mejora ----------
const ESTADOS_FB=["Pendiente","En curso","Hecho","Descartado"];
const TIPOS_FB=["Mejora","Error","Idea"];
const SECCIONES=()=>VIEWS.filter(v=>v.id&&(!v.admin||canFin)).map(v=>({v:v.id,l:labOf(v)}));
UI.fbEstado="Abiertos";
function vMejoras(){
  let list=vals(S.feedback);
  if(UI.fbEstado==="Abiertos") list=list.filter(f=>f.estado==="Pendiente"||f.estado==="En curso");
  else if(UI.fbEstado!=="Todos") list=list.filter(f=>f.estado===UI.fbEstado);
  const pr={Alta:0,Media:1,Baja:2};
  list=sortBy(list,f=>`${pr[f.prioridad]??1}-${9999-(+String(f.fecha||"0").replace(/-/g,"").slice(0,8)||0)}`);
  const lab={ajustes:"Equipo y accesos",economics:"Unit economics",historial:"Historial de cambios",calidad:"Calidad de datos",conexiones:"Conexiones",mejoras:"Pedidos de mejora",...Object.fromEntries(VIEWS.filter(v=>v.id).map(v=>[v.id,labOf(v)]))};
  let h=`<div class="head"><div><h1>Pedidos de mejora</h1><p>Lo que el equipo pide cambiar del sistema. Cada pedido tiene estado y respuesta, así se ve qué se hizo.</p></div><button class="btn lemon" data-act="newFeedback">Sugerir mejora</button></div>
  <div class="toolbar"><div class="seg" role="group">${["Abiertos","Hecho","Descartado","Todos"].map(e=>`<button data-act="fbEstado" data-v="${e}" aria-pressed="${UI.fbEstado===e}">${e}</button>`).join("")}</div></div>`;
  if(!list.length) return h+`<div class="empty">No hay pedidos en esta vista. Usá “Sugerir mejora” desde cualquier pantalla.</div>`;
  h+=`<div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Pedido</th><th>Sección</th><th>Tipo</th><th>Prioridad</th><th>De</th><th>Estado</th></tr></thead><tbody>
  ${list.map(f=>`<tr class="click" data-act="openFeedback" data-id="${f.id}"><td class="num">${fd(f.fecha)}</td><td>${esc(f.texto)}${f.respuesta?`<div class="muted" style="font-size:12px">↳ ${esc(f.respuesta)}</div>`:""}</td><td>${esc(lab[f.seccion]||f.seccion||"—")}</td><td><span class="tag">${esc(f.tipo||"—")}</span></td><td><span class="pill ${f.prioridad==="Alta"?"crit":f.prioridad==="Baja"?"":"warn"}">${esc(f.prioridad||"Media")}</span></td><td>${esc(authorName(f.autorId))}</td><td><span class="pill ${f.estado==="Hecho"?"ok":f.estado==="En curso"?"info":f.estado==="Descartado"?"":"lemon"}">${esc(f.estado)}</span></td></tr>`).join("")}
  </tbody></table></div>
  <div class="note">Para implementar un pedido: abrí el proyecto en Replit, copiá el texto del pedido al agente y, cuando esté listo, marcalo como “Hecho” con una respuesta corta.</div>`;
  return h;
}
function drawerFeedback(id){
  const f=id?S.feedback[id]:{seccion:view==="config"?"config":view,tipo:"Mejora",prioridad:"Media",estado:"Pendiente"};
  if(!f) return;
  const body=`<div class="form">${farea("¿Qué querés que cambie o qué no funciona?","fb-t",f.texto)}
    ${fsel("Pantalla","fb-s",SECCIONES(),f.seccion)}${fsel("Tipo","fb-ti",TIPOS_FB,f.tipo)}
    ${fsel("Prioridad","fb-p",["Alta","Media","Baja"],f.prioridad)}${id?fsel("Estado","fb-e",ESTADOS_FB,f.estado):""}
    ${id?farea("Respuesta / qué se hizo","fb-r",f.respuesta):""}</div>
    ${id?`<div class="muted" style="font-size:12.5px">Pedido de ${esc(authorName(f.autorId))} · ${fd(f.fecha)}</div>`:`<div class="note">Contá el problema con un ejemplo concreto: qué hiciste, qué esperabas y qué pasó.</div>`}`;
  openDrawer(id?"Pedido de mejora":"Sugerir mejora","",body,{save:{label:id?"Guardar":"Enviar pedido"},del:id&&isAdmin?{label:"Eliminar"}:null});
  setTimeout(()=>$("#fb-t")?.focus(),30);
  drawerSave.save.fn=async()=>{
    const texto=gv("fb-t"); if(!texto){toast("Escribí el pedido.",true);return;}
    const doc={...(id?f:{}),texto,seccion:gv("fb-s"),tipo:gv("fb-ti"),prioridad:gv("fb-p"),estado:id?gv("fb-e"):"Pendiente",respuesta:id?gv("fb-r"):"",fecha:f.fecha||today(),autorId:f.autorId||me.id};
    delete doc.id;
    if(await write("feedback/"+(id||newId("fb")),doc)){ toast(id?"Pedido actualizado":"Pedido enviado. Gracias."); closeDrawer(); }
  };
  if(drawerSave.del) drawerSave.del.fn=async()=>{ if(drawerSave.del.armed){ if(await write("feedback/"+id,null,"delete")){toast("Pedido eliminado");closeDrawer();} } else { drawerSave.del.armed=true; $("[data-act=drawerDel]").textContent="Confirmar: eliminar"; } };
}


// ================= BANDEJA DE PROPUESTAS (digest automático) =================
const COL_LAB = {busquedas:"Búsqueda",candidatos:"Candidato",postulaciones:"Postulación",clientes:"Cliente",leads:"Lead",facturas:"Factura",busquedasFin:"Datos económicos"};
const OP_LAB = {crear:"Crear",actualizar:"Actualizar",bitacora:"Sumar a la bitácora",minuta:"Vincular minuta"};
const FUENTE_PILL = {Mail:"info",Calendario:"lemon",Granola:"ok",WhatsApp:"ok",LinkedIn:"info"};
const humanKey = k => { const L={fechaUltimoContacto:"Último contacto",fechaPrimerContacto:"Primer contacto",motivoPerdida:"Motivo de pérdida",feeMultiplo:"Fee (× sueldo)",feeEstimadoARS:"Fee estimado ARS",sueldoUSD:"Sueldo USD",sueldoBrutoARS:"Sueldo bruto ARS",proximoPaso:"Próximo paso",proximoSeguimiento:"Próximo seguimiento",fechaCierre:"Fecha de cierre",fechaInicio:"Fecha de inicio",fechaIngreso:"Fecha de ingreso",candidatoFinal:"Candidato final",fechaPagoComision:"Fecha de pago de comisión",comisionPagada:"Comisión pagada",fechaCobro:"Fecha de cobro",fechaEmision:"Fecha de emisión",busquedaId:"Búsqueda",monedaComision:"Moneda de comisión",fechaPrimeraTerna:"Primera terna",inicioAvance:"Inicio y avance"}; if(L[k]) return L[k]; return String(k).replace(/^_/,"").replace(/([a-z])([A-Z])/g,"$1 $2").split(" ").map((w,i)=>/^[A-Z]{2,}$/.test(w)?w:(i?w.toLowerCase():w.charAt(0).toUpperCase()+w.slice(1).toLowerCase())).join(" "); };
function propTarget(p){
  const id=p.registroId; if(!id) return p.op==="crear" ? "Nuevo registro" : "—";
  const b=S.busquedas[id], c=S.candidatos[id], cl=S.clientes[id], l=S.leads[id], f=S.facturas[id], po=S.postulaciones[id];
  if(p.coleccion==="busquedas"||p.coleccion==="busquedasFin") return b?`${b.puesto} · ${b.cliente}`:id;
  if(p.coleccion==="candidatos") return c?c.nombre:id;
  if(p.coleccion==="clientes") return cl?cl.nombre:id;
  if(p.coleccion==="leads") return l?`${l.empresa}${l.contacto?" · "+l.contacto:""}`:id;
  if(p.coleccion==="facturas") return f?`${money(f.monto,f.moneda)} · ${f.cliente}`:id;
  if(p.coleccion==="postulaciones"&&po){ const cc=S.candidatos[po.candidatoId], bb=S.busquedas[po.busquedaId]; return `${cc?cc.nombre:"Candidato"} → ${bb?bb.puesto+" · "+bb.cliente:"búsqueda"}`; }
  return id;
}
function propDatos(p){
  const d=p.datos||{}; const ks=Object.keys(d).filter(k=>d[k]!==""&&d[k]!=null);
  if(!ks.length) return "";
  return `<div class="tablewrap" style="margin-top:8px"><table><tbody>${ks.map(k=>{
    const v=d[k]; const cur=p.registroId&&p.op==="actualizar"? (S[RES_KEY[p.coleccion]]||{})[p.registroId]?.[k] : undefined;
    const show=x=> typeof x==="boolean"?(x?"Sí":"No"): typeof x==="object"?JSON.stringify(x): String(x);
    const fmtV = k==="url" ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(show(v));
    return `<tr><td class="muted" style="width:34%">${esc(humanKey(k))}</td><td>${cur!==undefined&&cur!==null&&cur!==""?`<span class="muted" style="text-decoration:line-through">${esc(show(cur))}</span> → `:""}<b>${fmtV}</b></td></tr>`;
  }).join("")}</tbody></table></div>`;
}
function propBanner(){
  if(!canFin) return "";
  const n=vals(S.propuestas).filter(p=>p.estado==="Pendiente").length;
  return n? `<div class="note" style="display:flex;align-items:center;gap:12px;justify-content:space-between;margin-bottom:14px"><span><b>${n} novedades</b> de mails, calendario y chats esperan tu aprobación.</span><a class="btn sm lemon" href="#propuestas">Revisar</a></div>` : "";
}
function vPropuestas(){
  UI.pEstado ||= "Pendiente";
  const all=vals(S.propuestas);
  let list=all.filter(p=>UI.pEstado==="Todas"||p.estado===UI.pEstado);
  if(UI.pFuente) list=list.filter(p=>p.fuente===UI.pFuente);
  list=sortBy(list,p=>p.fecha||p.creado||"",-1);
  const dg=S.digest; const ult=dg&&dg.actualizado? new Date(dg.actualizado).toLocaleString("es-AR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : null;
  let h=`<div class="head"><div><h1>Bandeja de propuestas</h1><p class="keep">Lo que el sistema detectó en mails, calendarios, Granola y chats. Nada se guarda hasta que lo aprobás.${ult?` · Última lectura: ${esc(ult)}`:" · Todavía no corrió ninguna lectura."}</p></div></div>
  <div class="toolbar"><div class="seg" role="group" aria-label="Estado">${["Pendiente","Aprobada","Rechazada","Todas"].map(e=>`<button data-act="pEstado" data-v="${e}" aria-pressed="${UI.pEstado===e}">${e==="Pendiente"?"Pendientes":e==="Aprobada"?"Aprobadas":e==="Rechazada"?"Rechazadas":"Todas"} <span class="muted num">${e==="Todas"?all.length:all.filter(p=>p.estado===e).length}</span></button>`).join("")}</div>
  <select data-ui="pFuente" aria-label="Fuente"><option value="">Todas las fuentes</option>${opt(uniq(all.map(p=>p.fuente)).sort(),UI.pFuente)}</select></div>`;
  if(!list.length) return h+`<div class="empty">${UI.pEstado==="Pendiente"?"No hay novedades para revisar.":"No hay propuestas en esta vista."}</div>`;
  h+=list.map(p=>`<section class="panel" style="margin-bottom:12px">
    <div class="panel-head" style="align-items:flex-start;gap:10px">
      <div class="grow"><div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px"><span class="pill ${FUENTE_PILL[p.fuente]||""}">${esc(p.fuente||"Digest")}</span>${p.cuenta?`<span class="tag">${esc(p.cuenta)}</span>`:""}<span class="muted" style="font-size:12.5px">${p.fecha?esc(/^\d{4}-\d{2}-\d{2}$/.test(p.fecha)?fd(p.fecha):new Date(p.fecha).toLocaleString("es-AR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})):""}</span></div>
        <h2 style="margin:0">${esc(p.resumen)}</h2>
        <div class="muted" style="font-size:13px;margin-top:2px">${esc(OP_LAB[p.op]||p.op)} · ${esc(COL_LAB[p.coleccion]||p.coleccion)}: <b>${esc(propTarget(p))}</b></div></div>
      ${p.estado==="Pendiente"?`<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm lemon" data-act="propAprobar" data-id="${esc(p.id)}">Aprobar</button><button class="btn sm" data-act="propEditar" data-id="${esc(p.id)}">Editar</button><button class="btn sm ghost" data-act="propRechazar" data-id="${esc(p.id)}">Rechazar</button></div>`
        :`<span class="pill ${p.estado==="Aprobada"?"ok":""}">${esc(p.estado)}${p.revisadoPor?" · "+esc(authorName(p.revisadoPor)):""}</span>`}
    </div>
    ${propDatos(p)}
    ${p.evidencia||p.link?`<details style="margin-top:8px"><summary class="muted" style="cursor:pointer;font-size:13px">Ver de dónde sale</summary>${p.evidencia?`<blockquote class="muted" style="white-space:pre-wrap;font-size:13px;margin:8px 0;border-left:3px solid var(--line);padding-left:10px">${esc(p.evidencia)}</blockquote>`:""}${p.link?`<a href="${esc(p.link)}" target="_blank" rel="noopener" class="btn sm ghost">Abrir original</a>`:""}</details>`:""}
  </section>`).join("");
  return h;
}
function drawerPropuesta(id){
  const p=S.propuestas[id]; if(!p) return;
  const d=p.datos||{}; const ks=Object.keys(d);
  const body=`<div class="note">${esc(OP_LAB[p.op]||p.op)} · ${esc(COL_LAB[p.coleccion]||p.coleccion)}: <b>${esc(propTarget(p))}</b></div>
    <div class="form">${ks.map((k,i)=>{ const v=d[k];
      if(typeof v==="boolean") return fsel(humanKey(k),"pe-"+i,[{v:"true",l:"Sí"},{v:"false",l:"No"}],String(v));
      if(typeof v==="object"&&v!==null) return farea(humanKey(k)+" (JSON)","pe-"+i,JSON.stringify(v));
      if(String(v??"").length>60) return farea(humanKey(k),"pe-"+i,v);
      return field(humanKey(k),"pe-"+i,v,typeof v==="number"?"number":"text","full"); }).join("")}</div>
    ${p.evidencia?`<details><summary class="muted">Ver de dónde sale</summary><blockquote class="muted" style="white-space:pre-wrap;font-size:13px">${esc(p.evidencia)}</blockquote></details>`:""}`;
  openDrawer("Editar y aprobar",p.resumen,body,{save:{label:"Aprobar con cambios"}});
  drawerSave.save.fn=async()=>{
    const datos={};
    ks.forEach((k,i)=>{ const v=d[k], raw=gv("pe-"+i);
      if(typeof v==="boolean") datos[k]=raw==="true";
      else if(typeof v==="number") datos[k]=gn("pe-"+i);
      else if(typeof v==="object"&&v!==null){ try{ datos[k]=JSON.parse(raw); }catch{ datos[k]=v; } }
      else datos[k]=raw; });
    if(await propAprobar(id,datos)) closeDrawer();
  };
}
async function propAprobar(id,datos){
  try{
    const r=await api(`/api/propuestas/${encodeURIComponent(id)}/aprobar`,{method:"POST",body:JSON.stringify(datos?{datos}:{})});
    toast("Aprobada y guardada"); S.propuestas[id]={...S.propuestas[id],estado:"Aprobada"}; schedule();
    refresh("propuestas"); refresh(r.coleccion); if(r.coleccion==="candidatos") refresh("postulaciones");
    return true;
  }catch(e){ if(e.code!==401) toast(e.message||"No se pudo aprobar.",true); return false; }
}


// ================= CONEXIONES (WhatsApp y LinkedIn vía Unipile) =================
function vConexiones(){
  const d=S.conexiones;
  let h=`<div class="head"><div><h1>Conexiones</h1><p>Conectá tu WhatsApp y tu LinkedIn para que el sistema lea las novedades cada 2 horas y las proponga en la Bandeja. Es solo lectura: nunca envía mensajes.</p></div></div>`;
  if(!d) return h+`<div class="empty">Cargando conexiones…</div>`;
  if(!d.configurado) return h+`<div class="empty">Falta configurar la cuenta de Unipile: un socio tiene que cargar UNIPILE_DSN y UNIPILE_API_KEY en Secrets.</div>`;
  h+=`<div class="toolbar"><button class="btn lemon" data-act="uniLink" data-v="WHATSAPP">Conectar mi WhatsApp</button><button class="btn" data-act="uniLink" data-v="LINKEDIN">Conectar mi LinkedIn</button></div>`;
  if(!d.cuentas.length) h+=`<div class="empty">Todavía no conectaste ninguna cuenta. Tocá “Conectar mi WhatsApp” y escaneá el QR desde WhatsApp → Dispositivos vinculados.</div>`;
  else h+=`<div class="tablewrap"><table><thead><tr><th>Canal</th><th>Cuenta</th><th>De</th><th>Estado</th><th>Qué lee el sistema</th><th></th></tr></thead><tbody>
    ${d.cuentas.map((c,i)=>`<tr><td><span class="pill ${c.tipo==="WHATSAPP"?"ok":"info"}">${c.tipo==="WHATSAPP"?"WhatsApp":c.tipo==="LINKEDIN"?"LinkedIn":esc(c.tipo)}</span></td><td>${esc(c.nombre||"—")}</td><td>${esc(c.usuario||"Sin asignar")}</td>
      <td><span class="pill ${/OK|RUNNING|CONNECTED/i.test(c.estado)?"ok":"crit"}">${/OK|RUNNING|CONNECTED/i.test(c.estado)?"Conectada":esc(c.estado)}</span></td>
      <td><select id="uni-f-${i}">${opt([{v:"base",l:"Solo contactos que están en el sistema"},{v:"todo",l:"Todos los chats (cuenta de trabajo)"}],c.filtro)}</select></td>
      <td style="white-space:nowrap"><button class="btn sm" data-act="uniSave" data-id="${esc(c.id)}" data-i="${i}">Guardar</button> <button class="btn sm ghost" data-act="uniDel" data-id="${esc(c.id)}">Desconectar</button></td></tr>`).join("")}
  </tbody></table></div>`;
  h+=`<div class="note">“Solo contactos que están en el sistema” lee únicamente los chats con candidatos o contactos de clientes cuyo teléfono o nombre ya está cargado. Usá “Todos los chats” solo en cuentas de trabajo, como un WhatsApp Business de Lemon o LinkedIn. Los grupos nunca se leen.</div>`;
  return h;
}


// ================= WEEKLY (avances semanales) =================
const sinPP = (t,pp) => { t=String(t||""); if(pp && t.endsWith(" · "+pp)) t=t.slice(0,-(pp.length+3)); return t; };
const PRIO_ORD = p => p ? (parseInt(p)||9) : 9;
function weekStart(iso){ const d=new Date((iso||today())+"T12:00:00"); const wd=(d.getDay()+6)%7; d.setDate(d.getDate()-wd); return d.toISOString().slice(0,10); }
function wkRange(){ const s=UI.wk||weekStart(); return {s, e:addDays(s,6)}; }
const inRange = (iso,{s,e}) => !!iso && iso.slice(0,10)>=s && iso.slice(0,10)<=e;
function wkData(){
  const r=wkRange();
  const vivas=B().filter(b=>b.fechaInicio && b.fechaInicio<=r.e && (!b.fechaCierre || b.fechaCierre>=r.s) && !(b.estado!=="Activa" && !b.fechaCierre && b.estado!=="En pausa"));
  const activasSem=vivas.filter(b=>!(b.fechaCierre && b.fechaCierre<r.s));
  const nuevas=B().filter(b=>inRange(b.fechaInicio,r));
  const cerradas=B().filter(b=>b.estado==="Cerrada"&&inRange(b.fechaCierre,r));
  const canceladas=B().filter(b=>b.estado==="Cancelada"&&inRange(b.fechaCierre,r));
  const notas=b=>(b.bitacora||[]).filter(x=>inRange(x.fecha,r));
  const presentados=vals(S.postulaciones).filter(p=>inRange(p.fecha,r)&&["Presentado","Entrevista cliente","Oferta","Contratado"].includes(p.etapa));
  return {r,activasSem,nuevas,cerradas,canceladas,notas,presentados};
}
// ================= INICIO: Hoy + el weekly (Números, Búsquedas, Comercial) =================
function vInicio(){
  const D=wkData(), r=D.r;
  const tabs=[["hoy","Hoy"],canFin&&["resumen","Números"],["busquedas",`Búsquedas <span class="muted num">${D.activasSem.filter(b=>b.estado!=="En pausa"&&(!b.fechaCierre||b.fechaCierre>r.e)).length}</span>`],canFin&&["comercial","Comercial"]].filter(Boolean);
  if(!tabs.some(([v])=>v===UI.iniTab)) UI.iniTab="hoy";
  const t=UI.iniTab;
  // Exportar (copiar, PDF, Excel, reporte mensual) arriba a la derecha, solo en las pestañas del weekly
  const exp=t==="hoy"?"":`<details class="menu"><summary class="btn sm">Exportar</summary><div class="menu-pop"><button class="btn sm ghost" data-act="wkCopy">Copiar resumen</button><button class="btn sm ghost" data-act="wkPDF">PDF de la semana</button>${xbtn(t==="resumen"?"scorecard":"weekly","Excel")}${canFin?`<button class="btn sm ghost" data-act="repMensual">Reporte mensual</button>`:""}</div></details>`;
  let h=`<div class="head ini-head"><div><h1>Inicio</h1><p class="keep">${fd(today())}</p></div>${exp}</div>
  <div class="toolbar"><div class="seg" role="tablist">${tabs.map(([v,l])=>`<button role="tab" data-act="iniTab" data-v="${v}" aria-pressed="${t===v}" aria-selected="${t===v}">${l}</button>`).join("")}</div></div>`;
  if(t==="hoy") return h+vPanel();
  UI.wkTab=t; return h+vWeekly();
}
function vWeekly(){
  const D=wkData(); const {r}=D; const esActual=r.s===weekStart();
  if(!canFin) UI.wkTab="busquedas"; else if(!["resumen","busquedas","comercial"].includes(UI.wkTab)) UI.wkTab="resumen";
  const tab=UI.wkTab, mes=tab==="resumen"&&UI.scPer==="mes";
  // Período en una sola línea: ‹ 28 sep – 4 oct ›, con "volver a hoy" si no es el actual
  const dm = iso => { const [,m,d]=iso.split("-"); return `${+d}\u00a0${MES[+m-1]}`; };
  let nav;
  if(mes){ const per=scPeriodos(); const k=per[per.length-1].k, act=!(UI.mesOff||0);
    nav=`<div class="stepper"><button class="btn sm" data-act="mesNav" data-v="1" aria-label="Mes anterior">‹</button>${act?`<span class="stepper-l">${fm(k)}</span>`:`<button class="stepper-l volver" data-act="mesNav" data-v="0" title="Volver al mes actual">${fm(k)}</button>`}<button class="btn sm" data-act="mesNav" data-v="-1" ${act?"disabled":""} aria-label="Mes siguiente">›</button></div>`; }
  else nav=`<div class="stepper"><button class="btn sm" data-act="wkNav" data-v="-7" aria-label="Semana anterior">‹</button>${esActual?`<span class="stepper-l">${dm(r.s)} – ${dm(r.e)}</span>`:`<button class="stepper-l volver" data-act="wkNav" data-v="0" title="Volver a esta semana">${dm(r.s)} – ${dm(r.e)}</button>`}<button class="btn sm" data-act="wkNav" data-v="7" ${esActual?"disabled":""} aria-label="Semana siguiente">›</button></div>`;
  const perSeg = tab==="resumen" ? `<div class="seg" role="group" aria-label="Período"><button data-act="scPer" data-v="semana" aria-pressed="${UI.scPer!=="mes"}">Semana</button><button data-act="scPer" data-v="mes" aria-pressed="${UI.scPer==="mes"}">Mes</button></div>` : "";
  const tabs=[canFin&&["resumen","Resumen"],["busquedas",`Búsquedas <span class="muted num">${D.activasSem.filter(b=>b.estado!=="En pausa"&&(!b.fechaCierre||b.fechaCierre>r.e)).length}</span>`],canFin&&["comercial","Comercial"]].filter(Boolean);
  let h=`<div class="toolbar wk-bar">${perSeg}${nav}</div>`;
  if(tab==="resumen") return h+wkResumen();
  if(tab==="comercial") return h+wkComercial(D);
  return h+wkBusquedas(D);
}
function wkBusquedas(D){
  if(!canFin&&!UI._recDef){ UI._recDef=1; const mio=recruiters().find(x=>keyN(x.nombre)===keyN(me.nombre||"")); if(mio){ UI.wkRec=mio.nombre; UI.bRec=mio.nombre; } }
  const {r}=D; const esActual=r.s===weekStart();
  let list=D.activasSem;
  if(UI.wkRec) list=list.filter(b=>b.recruiter===UI.wkRec);
  const act=list.filter(b=>b.estado!=="En pausa"&&(!b.fechaCierre||b.fechaCierre>r.e));
  const upd=act.filter(b=>D.notas(b).length);
  const pres=D.presentados.filter(p=>!UI.wkRec||S.busquedas[p.busquedaId]?.recruiter===UI.wkRec);
  const recs=uniq(D.activasSem.map(b=>b.recruiter)).sort();
  const sin=act.length-upd.length;
  let h=`<div class="toolbar"><select data-ui="wkRec" aria-label="Recruiter"><option value="">Todo el equipo</option>${opt(recs,UI.wkRec)}</select>
    <span class="chip"><b>${act.length}</b> activas</span><span class="chip"><b>${upd.length}</b> con avance</span>
    <button class="chip${sin?" warn":""}" data-act="wkSoloSin" aria-pressed="${!!UI.wkSoloSin}" title="Mostrar solo las que no tienen avance esta semana"><b>${sin}</b> sin avance${UI.wkSoloSin?" · filtrando":""}</button>
    <span class="chip"><b>${pres.length}</b> candidatos presentados</span></div>`;
  const mov=[...D.nuevas.map(b=>({b,t:"Nueva",c:"lemon"})),...D.cerradas.map(b=>({b,t:"Cerrada",c:"ok"})),...D.canceladas.map(b=>({b,t:"Cancelada",c:"crit"}))].filter(x=>!UI.wkRec||x.b.recruiter===UI.wkRec);
  if(mov.length) h+=`<section class="panel"><div class="panel-head"><h2>Movimientos de la semana</h2></div><div class="list">${mov.map(x=>`<div class="row"><span class="pill ${x.c}">${x.t}</span><div class="grow"><b>${esc(x.b.puesto)}</b> · ${esc(x.b.cliente)}<div class="muted">${esc(x.b.recruiter||"Sin recruiter")}${x.t==="Cerrada"&&x.b.candidatoFinal?` · ingresa ${esc(x.b.candidatoFinal)}`:""}</div></div><button class="btn sm ghost" data-act="openBusqueda" data-id="${x.b.id}">Abrir</button></div>`).join("")}</div></section>`;
  const porRec={}; act.concat(list.filter(b=>b.estado==="En pausa")).filter(b=>!UI.wkSoloSin||(b.estado!=="En pausa"&&!D.notas(b).length)).forEach(b=>(porRec[b.recruiter||"Sin recruiter"] ||= []).push(b));
  const recOrden=Object.keys(porRec).sort((a,b)=>a.localeCompare(b,"es"));
  if(!recOrden.length) return h+`<div class="empty">${UI.wkSoloSin?"Todas las búsquedas activas tienen avance esta semana.":"No hay búsquedas activas en esta semana."}</div>`;
  for(const rec of recOrden){
    const rows=sortBy(porRec[rec],b=>`${b.estado==="En pausa"?1:0}-${PRIO_ORD(b.prioridad)}-${String(9999-(days(b.fechaInicio,r.e)||0)).padStart(4,"0")}`);
    h+=`<section class="panel"><div class="panel-head"><h2>${esc(rec)}</h2><span class="muted">${rows.length} búsquedas · ${rows.filter(b=>D.notas(b).length).length} con avance</span></div>
    <div class="tablewrap"><table><thead><tr><th>Búsqueda</th><th>Prio.</th><th class="r">Días</th><th>Pipeline</th><th style="width:38%">Avance de la semana</th><th>Próximo paso</th><th></th></tr></thead><tbody>
    ${rows.map(b=>{ const n=D.notas(b); const d=days(b.fechaInicio,esActual?today():r.e);
      const ps=postsOf(b.id); const st={}; ps.forEach(p=>st[p.etapa]=(st[p.etapa]||0)+1);
      const pipe=["Presentado","Entrevista cliente","Oferta"].filter(e=>st[e]).map(e=>`<span class="tag">${e==="Entrevista cliente"?"Ent. cliente":e} ${st[e]}</span>`).join(" ")||`<span class="muted">${ps.length?ps.length+" en proceso":"—"}</span>`;
      const av=n.length? n.map(x=>`<div>${esc(sinPP(x.texto,b.proximoPaso))}<div class="muted" style="font-size:11.5px">${fd(x.fecha)} · ${esc(authorName(x.autor))}</div></div>`).join("") : `<span class="pill warn">Sin avance cargado</span>`;
      return `<tr><td><b>${esc(b.puesto)}</b><div class="muted">${esc(b.cliente)}${b.estado==="En pausa"?" · En pausa":""}</div></td><td>${esc((b.prioridad||"").split(" ")[0]||"—")}</td><td class="r num"><span class="pill ${ageSev(d)} plain">${d??"—"}</span></td><td>${pipe}</td><td>${av}</td><td>${esc(b.proximoPaso||"—")}</td>
      <td style="white-space:nowrap">${esActual?`<button class="btn sm" data-act="weeklyUpdate" data-id="${b.id}">Actualizar</button>`:`<button class="btn sm ghost" data-act="openBusqueda" data-id="${b.id}">Abrir</button>`}</td></tr>`; }).join("")}
    </tbody></table></div></section>`;
  }
  return h;
}
function spark(vs){
  const pts=vs.map((v,i)=>[i,v]).filter(([,v])=>v!=null&&!isNaN(v)); if(pts.length<2) return `<div class="spark"></div>`;
  const ys=pts.map(p=>p[1]), mn=Math.min(...ys), mx=Math.max(...ys), W=120, H=30, n=Math.max(1,vs.length-1);
  const X=i=>2+i/n*(W-6), Y=v=>mx===mn?H/2:H-4-(v-mn)/(mx-mn)*(H-8);
  const [li,lv]=pts[pts.length-1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.map(([i,v])=>X(i).toFixed(1)+","+Y(v).toFixed(1)).join(" ")}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/><circle cx="${X(li).toFixed(1)}" cy="${Y(lv).toFixed(1)}" r="2.6" fill="currentColor"/></svg>`;
}
function scCard(m,per){
  const vs=per.map(p=>m.f(p)), v=vs[vs.length-1], prev=vs[vs.length-2], ok=x=>x!=null&&!isNaN(x);
  const o=m.obj?m.obj(per[per.length-1]):null;
  let delta=""; const unidad=UI.scPer==="mes"?"mes anterior":"semana anterior";
  if(ok(v)&&ok(prev)){ const d=v-prev;
    if(Math.abs(d)<1e-9) delta=`<span class="delta" title="Igual que la ${unidad}">= igual</span>`;
    else { const bueno=m.dir?(d>0)===(m.dir>0):null;
      const txt=(m.fmt==="ars"||m.fmt==="usd")?(prev?`${d>0?"+":""}${nf0.format(d/Math.abs(prev)*100)}%`:scFmt(d,m.fmt)):m.fmt==="pct"?`${d>0?"+":""}${nf0.format(d*100)} pp`:`${d>0?"+":""}${nf0.format(d)}`;
      delta=`<span class="delta ${bueno==null?"":bueno?"up":"down"}" title="Contra la ${unidad}: ${scFmt(prev,m.fmt)}">${d>0?"▲":"▼"} ${txt}</span>`; } }
  let meta="";
  if(o!=null&&ok(v)){ const cumple=m.dir<0?v<=o:v>=o; meta=`<span class="pill ${cumple?"ok":"warn"} plain">obj. ${scFmt(o,m.fmt)}</span>`; }
  const meter=o&&ok(v)&&m.dir>0?`<div class="meter${v>=o?" goal":""}" title="${nf0.format(v/o*100)}% del objetivo"><i style="width:${Math.min(100,Math.max(2,v/o*100))}%"></i></div>`:"";
  const det=m.it||m.go;
  return `<div class="sc-card${m.dest?" dest":""}${det?" click":""}"${det?` data-act="scDet" data-v="${esc(m.l)}" role="button" tabindex="0"`:""} ${m.n?`title="${esc(m.n)}"`:""}><span class="label">${esc(m.l)}${m.n?" *":""}</span>
    <div class="sc-v"><span class="v">${scFmt(v,m.fmt)}</span>${delta}</div>${meter}
    <div class="sc-foot">${spark(vs)}${meta}</div></div>`;
}
function wkResumen(){
  UI.scPer ||= "semana";
  const per=scPeriodos(), M=scMetricas();
  const secs=[]; M.forEach(m=>{ if(m.sec) secs.push({t:m.sec,ms:[]}); else if(secs.length) secs[secs.length-1].ms.push(m); });
  let h=`<div class="muted" style="font-size:12.5px">Compara contra ${UI.scPer==="mes"?"el mes anterior; la línea muestra los últimos 8 meses":"la semana anterior; la línea muestra las últimas 8 semanas"}. * aproximado.</div>`;
  if(canFin){ const q=calidadDatos(); if(q.length) h+=`<div class="note" style="margin-bottom:12px">Hay ${q.length} puntos de calidad de datos que pueden afectar estos números. <a href="#calidad">Revisarlos</a></div>`; }
  const tabla=ms=>`<details class="more"><summary>Ver evolución en tabla</summary><div class="tablewrap"><table class="sc-tab"><thead><tr><th>Métrica</th>${per.map((p,i)=>`<th class="r${i===per.length-1?" cur":""}">${esc(p.l)}</th>`).join("")}</tr></thead><tbody>
    ${ms.map(m=>`<tr><td>${esc(m.l)}${m.n?` <span class="muted" style="font-size:11px">(${esc(m.n)})</span>`:""}</td>${per.map((p,i)=>`<td class="r num${i===per.length-1?" cur":""}">${scFmt(m.f(p),m.fmt)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
  for(const s of secs){
    if(!s.ms.length) continue;
    h+=`<section class="panel"><div class="panel-head"><h2>${esc(s.t)}</h2></div><div class="sc-grid">${s.ms.filter(m=>!m.rec).map(m=>scCard(m,per)).join("")}</div>${tabla(s.ms)}</section>`;
  }
  h+=`<div class="note">* Aproximado: los leads y postulaciones guardan la fecha del último cambio, no todo el historial de etapas. Desde ahora cada cambio queda en el Historial y estas métricas se van volviendo exactas.</div>`;
  return h;
}

function wkTexto(){
  const D=wkData(); const {r}=D;
  let act=D.activasSem.filter(b=>b.estado!=="En pausa"&&(!b.fechaCierre||b.fechaCierre>r.e)); if(UI.wkRec) act=act.filter(b=>b.recruiter===UI.wkRec);
  const porRec={}; act.forEach(b=>(porRec[b.recruiter||"Sin recruiter"] ||= []).push(b));
  let t=`Weekly Lemon Talent · semana del ${fd(r.s)} al ${fd(r.e)}\n`;
  const mov=[...D.nuevas.map(b=>"Nueva: "+b.puesto+" ("+b.cliente+")"),...D.cerradas.map(b=>"Cerrada: "+b.puesto+" ("+b.cliente+")"+(b.candidatoFinal?" · "+b.candidatoFinal:"")),...D.canceladas.map(b=>"Cancelada: "+b.puesto+" ("+b.cliente+")")];
  if(mov.length) t+=`\nMovimientos:\n${mov.map(x=>"• "+x).join("\n")}\n`;
  t+=wkComercialTexto(D);
  for(const rec of Object.keys(porRec).sort()){
    t+=`\n${rec}\n`;
    for(const b of sortBy(porRec[rec],b=>PRIO_ORD(b.prioridad))){
      const n=D.notas(b); t+=`• ${b.puesto} (${b.cliente}): ${n.length?n.map(x=>sinPP(x.texto,b.proximoPaso)).join(" / "):"sin avance cargado"}${b.proximoPaso?` → Próximo: ${b.proximoPaso}`:""}\n`;
    }
  }
  return t;
}


// ================= EXTRAS: exportar, reportes, historial, papelera, archivos, buscador, funnel =================
// ---- Exportar a Excel (SheetJS bajo demanda; si no carga, CSV) ----
let XLSXlib=null;
async function loadXLSX(){ if(XLSXlib) return XLSXlib; if(window.XLSX) return XLSXlib=window.XLSX;
  await new Promise((ok,ko)=>{ const s=document.createElement("script"); s.src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"; s.onload=ok; s.onerror=ko; document.head.appendChild(s); });
  return XLSXlib=window.XLSX; }
async function descargarExcel(rows,nombre){
  if(!rows.length){ toast("No hay datos para descargar.",true); return; }
  const file=`${nombre} ${today()}`;
  try{ const X=await loadXLSX(); const ws=X.utils.json_to_sheet(rows); ws["!cols"]=Object.keys(rows[0]).map(k=>({wch:Math.min(60,Math.max(10,k.length+2,...rows.slice(0,200).map(r=>String(r[k]??"").length)))}));
    const wb=X.utils.book_new(); X.utils.book_append_sheet(wb,ws,nombre.slice(0,31)); X.writeFile(wb,file+".xlsx"); }
  catch(e){ const cols=Object.keys(rows[0]); const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;
    const csv="﻿"+[cols.map(q).join(";"),...rows.map(r=>cols.map(c=>q(r[c])).join(";"))].join("\r\n");
    const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})); a.download=file+".csv"; a.click(); }
  toast("Descarga lista");
}
const xbtn = (k,label="Descargar Excel") => `<button class="btn sm ghost" data-act="exportar" data-v="${k}">${label}</button>`;
function datosExport(k){
  if(k==="busquedas"){ let list=B(); if(UI.bEstado!=="Todas") list=list.filter(b=>b.estado===UI.bEstado); if(UI.bRec) list=list.filter(b=>b.recruiter===UI.bRec); if(UI.bCli) list=list.filter(b=>b.cliente===UI.bCli);
    if(UI.bQ){ const q=keyN(UI.bQ); list=list.filter(b=>keyN([b.puesto,b.cliente,b.candidatoFinal,b.recruiter].join(" ")).includes(q)); }
    return sortBy(list,b=>b.fechaInicio||"",-1).map(b=>{ const ps=postsOf(b.id); const row={Puesto:b.puesto,Cliente:b.cliente,Recruiter:b.recruiter||"",Estado:b.estado,Prioridad:b.prioridad||"","Fecha inicio":b.fechaInicio||"","Primera terna":b.fechaPrimeraTerna||"","Fecha cierre":b.fechaCierre||"","Días":b.estado==="Activa"?days(b.fechaInicio):ttf(b),"Candidatos en pipeline":ps.length,"Presentados o más":ps.filter(p=>ETAPAS.indexOf(p.etapa)>=3&&p.etapa!=="Descartado").length,"Candidato final":b.candidatoFinal||"","Estado actual":b.detalle||"","Próximo paso":b.proximoPaso||""};
      if(canFin){ const f=S.fin[b.id]||{}; row["Sueldo ARS"]=f.sueldoBrutoARS??""; row["Fee (× sueldo)"]=f.feeMultiplo??""; row["Fee estimado ARS"]=f.feeEstimadoARS??""; } return row; }); }
  if(k==="candidatos"){ let list=vals(S.candidatos); if(UI.cQ){ const q=keyN(UI.cQ); list=list.filter(c=>keyN([c.nombre,c.rolActual,c.empresaActual,c.area,c.seniority,(c.tags||[]).join(" "),c.notas].join(" ")).includes(q)); }
    return sortBy(list,c=>c.creado||"",-1).map(c=>({Nombre:c.nombre,Email:c.email||"",Teléfono:c.telefono||"",LinkedIn:c.linkedin||"",Ubicación:c.ubicacion||"","Rol actual":c.rolActual||"","Empresa actual":c.empresaActual||"",Área:c.area||"",Seniority:c.seniority||"",Pretensión:c.pretension||"",Etiquetas:(c.tags||[]).join(", "),Procesos:postsOfCand(c.id).length,Alta:c.creado||"",Notas:c.notas||""})); }
  if(k==="pipeline"){ const b=S.busquedas[UI.cBusq]; return sortBy(postsOf(UI.cBusq),p=>ETAPAS.indexOf(p.etapa)).map(p=>{const c=S.candidatos[p.candidatoId]||{}; return {Búsqueda:b?.puesto||"",Cliente:b?.cliente||"",Candidato:c.nombre||"",Etapa:p.etapa,Fecha:p.fecha||"","Rol actual":c.rolActual||"",Empresa:c.empresaActual||"",Email:c.email||"",Teléfono:c.telefono||"",LinkedIn:c.linkedin||"",Notas:p.notas||""};}); }
  if(k==="leads"){ let list=vals(S.leads); if(UI.lQ){const q=keyN(UI.lQ); list=list.filter(l=>keyN([l.empresa,l.contacto,l.cargo,l.notas].join(" ")).includes(q));}
    return sortBy(list,l=>l.fechaUltimoContacto||l.fechaPrimerContacto||"",-1).map(l=>({Empresa:l.empresa,Contacto:l.contacto||"",Cargo:l.cargo||"",LinkedIn:l.linkedin||"",Origen:l.origen||"",Canal:l.canal||"",Etapa:l.etapa,"Motivo pérdida":l.motivoPerdida||"",Reactivar:l.reactivar||"",Contactos:(l.contactos||[]).map(c=>[c.nombre,c.cargo,c.email||c.linkedin].filter(Boolean).join(" - ")).join(" | "),"Primer contacto":l.fechaPrimerContacto||"","Último contacto":l.fechaUltimoContacto||"","Próximo seguimiento":l.proximoSeguimiento||"",ICP:l.icp||"",Fee:l.fee||"",Notas:l.notas||""})); }
  if(k==="clientes") return sortBy(clienteStats(),c=>c.fact,-1).map(c=>({Cliente:c.nombre,Estado:c.estado,ICP:c.doc?.icp||"",Búsquedas:c.total,Activas:c.act,Cerradas:c.cerradas,"Facturado US$ eq.":Math.round(c.fact),"Ticket prom. US$":c.ticket?Math.round(c.ticket):"","Propuesta / contrato":docsCliente(c.nombre).map(a=>a.etiqueta||"Documento").join(", ")||"Falta","Fee acordado":c.doc?.feeAcordado||"","Primera búsqueda":c.first,"Última búsqueda":c.last,Contactos:c.doc?.contactos||""}));
  if(k==="facturas"){ const F=vals(S.facturas); let list=UI.fTab==="pendientes"?F.filter(f=>!f.cobrada):UI.fTab==="comisiones"?F.filter(f=>!f.comisionPagada&&f.comision>0):UI.fTab==="cobradas"?F.filter(f=>f.cobrada):F;
    return sortBy(list,f=>f.fechaEmision||"",-1).map(f=>({Emisión:f.fechaEmision||"",Cliente:f.cliente||"",Concepto:f.concepto||"",Tipo:f.tipo||"",Emisor:f.emisor||"",Moneda:f.moneda||"",Monto:f.monto??"","Monto US$ eq.":Math.round(fcUSD(f)),Cobrada:f.cobrada?"Sí":"No","Fecha cobro":f.fechaCobro||"","Días sin cobrar":f.cobrada?"":days(f.fechaEmision),Recruiter:f.recruiter||"",Comisión:f.comision??"","Moneda comisión":f.monedaComision||"","Comisión pagada":f.comision?(f.comisionPagada?"Sí":"No"):"",Histórica:f.historico?"Sí":"",Comentarios:f.comentarios||""})); }
  if(k==="weekly"){ const D=wkData(); const {r}=D; let act=D.activasSem; if(UI.wkRec) act=act.filter(b=>b.recruiter===UI.wkRec);
    return sortBy(act,b=>`${b.recruiter}-${PRIO_ORD(b.prioridad)}`).map(b=>({Semana:r.s,Recruiter:b.recruiter||"",Búsqueda:b.puesto,Cliente:b.cliente,Estado:b.estado,Prioridad:b.prioridad||"",Días:days(b.fechaInicio,r.e),"En pipeline":postsOf(b.id).length,"Avance de la semana":D.notas(b).map(x=>sinPP(x.texto,b.proximoPaso)).join(" / "),"Próximo paso":b.proximoPaso||""})); }
  if(k==="scorecard") return datosScorecard();
  if(k==="historial") return (S.historial||[]).map(hh=>({Fecha:new Date(hh.fecha).toLocaleString("es-AR"),Usuario:authorName(hh.usuarioId),Qué:HIST_LAB[hh.coleccion]||hh.coleccion,Registro:histNombre(hh),Acción:hh.accion,Cambios:Object.entries(hh.cambios||{}).map(([c,[a,b]])=>`${humanKey(c)}: ${a??"—"} → ${b??"—"}`).join(" | ")}));
  return [];
}
const EXPORT_NOMBRE={busquedas:"Búsquedas",candidatos:"Candidatos",pipeline:"Pipeline",leads:"Leads",clientes:"Clientes",facturas:"Facturas",weekly:"Weekly",historial:"Historial",scorecard:"Scorecard"};

// ---- Documento imprimible (PDF) ----
function printDoc(title,body){
  const w=window.open("","_blank"); if(!w){ toast("Permití las ventanas emergentes para generar el PDF.",true); return; }
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  @page{size:A4;margin:16mm 14mm}*{box-sizing:border-box}body{font:12.5px/1.5 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1b201b;margin:0;padding:24px}
  h1{font-size:22px;margin:0 0 2px}h2{font-size:14.5px;margin:22px 0 8px;padding-bottom:4px;border-bottom:2px solid #D9E151}h3{font-size:13px;margin:12px 0 4px}
  .muted{color:#667063}.top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:1px solid #dde1d8;padding-bottom:12px;margin-bottom:6px}
  .brand{font-weight:700;font-size:13px;display:flex;align-items:center;gap:7px}.brand img{width:22px;height:22px}
  table{width:100%;border-collapse:collapse;margin:6px 0}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e6e9e2;vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#667063}
  .r{text-align:right}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0}.kpi{border:1px solid #dde1d8;border-radius:8px;padding:8px 10px}.kpi b{display:block;font-size:17px}.kpi span{font-size:11px;color:#667063}
  .tag{display:inline-block;border:1px solid #dde1d8;border-radius:999px;padding:1px 8px;font-size:11px;margin:1px 2px 1px 0}p{margin:4px 0}.foot{margin-top:28px;font-size:11px;color:#667063;border-top:1px solid #dde1d8;padding-top:8px}
  .noprint{margin-bottom:16px}@media print{.noprint{display:none}body{padding:0}}tr{page-break-inside:avoid}
  </style></head><body><div class="noprint"><button onclick="print()" style="font:inherit;padding:8px 14px;border-radius:6px;border:0;background:#D9E151;font-weight:600;cursor:pointer">Guardar como PDF / Imprimir</button></div>
  <div class="top"><div><div class="brand"><img src="${location.origin}/logo.svg" alt="">Lemon Talent</div><h1>${esc(title)}</h1></div><div class="muted">${fd(today())}</div></div>${body}
  <div class="foot">Lemon Talent · Reporte generado el ${new Date().toLocaleString("es-AR")}</div></body></html>`);
  w.document.close(); setTimeout(()=>{ try{w.focus(); w.print();}catch(e){} },400);
}
const pasa = p => p.etapa!=="Descartado" && ETAPAS.indexOf(p.etapa)>=3;

// Reporte para el cliente: primero se revisa y edita, después se genera.
function drawerRepCliente(id){
  const b=S.busquedas[id]; if(!b) return;
  const ps=sortBy(postsOf(id),p=>-ETAPAS.indexOf(p.etapa));
  const elegibles=ps.filter(pasa);
  const body=`<div class="note">Revisá el texto antes de generar: el reporte lo ve el cliente. No incluye montos ni notas internas.</div>
  <div class="form">${farea("Resumen del estado","rc-est",b.detalle||"")}${farea("Próximos pasos","rc-pp",b.proximoPaso||"")}</div>
  <div class="section"><span class="label">Candidatos a incluir (presentados o más avanzados)</span>
  ${elegibles.length?`<div class="list">${elegibles.map((p,i)=>{const c=S.candidatos[p.candidatoId]||{}; return `<label class="check"><input type="checkbox" id="rc-c-${i}" checked> <b>${esc(c.nombre||"Candidato")}</b> · ${esc(p.etapa)} <span class="muted">${esc([c.rolActual,c.empresaActual].filter(Boolean).join(" · "))}</span></label>`;}).join("")}</div>`:`<div class="muted" style="font-size:13px">Todavía no hay candidatos presentados.</div>`}
  <label class="check"><input type="checkbox" id="rc-funnel" checked> Incluir resumen del proceso (cantidad de candidatos por etapa)</label></div>`;
  openDrawer("Reporte para el cliente",`${esc(b.puesto)} · ${esc(b.cliente)}`,body,{save:{label:"Generar PDF"}});
  drawerSave.save.fn=async()=>{
    const sel=elegibles.filter((p,i)=>gv("rc-c-"+i));
    const d=b.estado==="Activa"?days(b.fechaInicio):ttf(b);
    const cont={}; ps.forEach(p=>cont[p.etapa]=(cont[p.etapa]||0)+1);
    const evaluados=ps.length, entrevistados=ps.filter(p=>ETAPAS.indexOf(p.etapa)>=2&&p.etapa!=="Descartado").length+ (cont["Descartado"]||0);
    let html=`<p class="muted">${esc(b.cliente)} · Recruiter: ${esc(b.recruiter||"Lemon Talent")}</p>
    <div class="kpis"><div class="kpi"><span>Estado</span><b>${esc(b.estado)}</b></div><div class="kpi"><span>Inicio</span><b>${fd(b.fechaInicio)}</b></div><div class="kpi"><span>${b.estado==="Activa"?"Días en curso":"Duración"}</span><b>${d??"—"}</b></div><div class="kpi"><span>Presentados</span><b>${ps.filter(pasa).length}</b></div></div>`;
    if(gv("rc-est")) html+=`<h2>Estado de la búsqueda</h2><p>${esc(gv("rc-est")).replace(/\n/g,"<br>")}</p>`;
    if(gv("rc-funnel")&&evaluados) html+=`<h2>Resumen del proceso</h2><table><tbody><tr><td>Perfiles evaluados</td><td class="r"><b>${evaluados}</b></td></tr><tr><td>Entrevistados por Lemon Talent</td><td class="r"><b>${Math.min(evaluados,entrevistados)}</b></td></tr><tr><td>Presentados al cliente</td><td class="r"><b>${ps.filter(pasa).length}</b></td></tr><tr><td>En entrevistas con el cliente u oferta</td><td class="r"><b>${ps.filter(p=>["Entrevista cliente","Oferta","Contratado"].includes(p.etapa)).length}</b></td></tr></tbody></table>`;
    if(sel.length) html+=`<h2>Candidatos presentados</h2><table><thead><tr><th>Candidato</th><th>Rol y empresa actual</th><th>Etapa</th></tr></thead><tbody>${sel.map(p=>{const c=S.candidatos[p.candidatoId]||{}; return `<tr><td><b>${esc(c.nombre||"")}</b>${c.linkedin?`<div class="muted">${esc(c.linkedin)}</div>`:""}</td><td>${esc([c.rolActual,c.empresaActual].filter(Boolean).join(" · ")||"—")}</td><td>${esc(p.etapa)}</td></tr>`;}).join("")}</tbody></table>`;
    if(gv("rc-pp")) html+=`<h2>Próximos pasos</h2><p>${esc(gv("rc-pp")).replace(/\n/g,"<br>")}</p>`;
    printDoc(`Reporte de búsqueda: ${b.puesto}`,html); closeDrawer();
  };
}
function weeklyPDF(){
  const D=wkData(); const {r}=D; let act=D.activasSem.filter(b=>b.estado!=="En pausa"&&(!b.fechaCierre||b.fechaCierre>r.e)); if(UI.wkRec) act=act.filter(b=>b.recruiter===UI.wkRec);
  const porRec={}; act.forEach(b=>(porRec[b.recruiter||"Sin recruiter"] ||= []).push(b));
  const mov=[...D.nuevas.map(b=>["Nueva",b]),...D.cerradas.map(b=>["Cerrada",b]),...D.canceladas.map(b=>["Cancelada",b])].filter(([,b])=>!UI.wkRec||b.recruiter===UI.wkRec);
  let html=`<div class="kpis"><div class="kpi"><span>Activas</span><b>${act.length}</b></div><div class="kpi"><span>Con avance cargado</span><b>${act.filter(b=>D.notas(b).length).length}</b></div><div class="kpi"><span>Nuevas · cerradas</span><b>${D.nuevas.length} · ${D.cerradas.length}</b></div><div class="kpi"><span>Canceladas</span><b>${D.canceladas.length}</b></div></div>`;
  if(mov.length) html+=`<h2>Movimientos de la semana</h2><table><tbody>${mov.map(([t,b])=>`<tr><td><span class="tag">${t}</span></td><td><b>${esc(b.puesto)}</b> · ${esc(b.cliente)}</td><td>${esc(b.recruiter||"")}${t==="Cerrada"&&b.candidatoFinal?` · ingresa ${esc(b.candidatoFinal)}`:""}</td></tr>`).join("")}</tbody></table>`;
  html+=wkComercialPDF(D);
  for(const rec of Object.keys(porRec).sort()){
    html+=`<h2>${esc(rec)}</h2><table><thead><tr><th style="width:24%">Búsqueda</th><th class="r">Días</th><th style="width:42%">Avance de la semana</th><th>Próximo paso</th></tr></thead><tbody>${sortBy(porRec[rec],b=>PRIO_ORD(b.prioridad)).map(b=>{const n=D.notas(b); return `<tr><td><b>${esc(b.puesto)}</b><div class="muted">${esc(b.cliente)}${b.prioridad?" · Prio "+esc(b.prioridad.split(" ")[0]):""}</div></td><td class="r">${days(b.fechaInicio,r.e)??"—"}</td><td>${n.length?n.map(x=>esc(sinPP(x.texto,b.proximoPaso))).join("<br>"):'<span class="muted">Sin avance cargado</span>'}</td><td>${esc(b.proximoPaso||"—")}</td></tr>`;}).join("")}</tbody></table>`;
  }
  printDoc(`Weekly · semana del ${fd(r.s)} al ${fd(r.e)}`,html);
}
// Reporte mensual (socios ven resultado; la administradora solo ingresos)
function drawerRepMensual(){
  const meses=lastMonths(18).reverse();
  openDrawer("Reporte mensual","Resumen del mes para socios",`<div class="form">${fsel("Mes","rm-mes",meses.map(k=>({v:k,l:fm(k)})),meses[0])}</div><div class="note">Incluye facturación, cobranza, búsquedas, time to fill y comercial.${isAdmin?" También gastos y resultado.":""}</div>`,{save:{label:"Generar PDF"}});
  drawerSave.save.fn=async()=>{ repMensual(gv("rm-mes")); closeDrawer(); };
}
function repMensual(k){
  const p=pnl(k); const F=vals(S.facturas);
  const emit=F.filter(f=>ym(f.fechaEmision)===k&&!f.historico); const cob=F.filter(f=>f.cobrada&&ym(f.fechaCobro)===k);
  const pend=F.filter(f=>!f.cobrada); const inM=d=>ym(d)===k;
  const nuevas=B().filter(b=>inM(b.fechaInicio)), cerr=B().filter(b=>b.estado==="Cerrada"&&inM(b.fechaCierre)), canc=B().filter(b=>b.estado==="Cancelada"&&inM(b.fechaCierre));
  const ttfs=cerr.map(ttf).filter(x=>x!=null); const ttfA=ttfs.length?Math.round(ttfs.reduce((a,b)=>a+b,0)/ttfs.length):null;
  const L=vals(S.leads); const ln=L.filter(l=>inM(l.fechaPrimerContacto)).length, lp=L.filter(l=>l.etapa==="Propuesta enviada"&&inM(l.fechaUltimoContacto)).length, lg=L.filter(l=>l.etapa==="Ganado"&&inM(l.fechaUltimoContacto||l.fechaPrimerContacto)).length;
  const o=obj(); const ingARS=p.ingARS+p.ingUSD*p.tc;
  const porCli={}; emit.forEach(f=>porCli[f.cliente||"—"]=(porCli[f.cliente||"—"]||0)+fcUSD(f));
  let html=`<div class="kpis"><div class="kpi"><span>Facturado (ARS eq.)</span><b>${ars(ingARS)}</b><span>objetivo ${short(o.facturacionMensualARS)}</span></div><div class="kpi"><span>Facturado US$ eq.</span><b>${usd(p.ingTot)}</b></div><div class="kpi"><span>Cobrado en el mes</span><b>${usd(cob.reduce((s,f)=>s+fcUSD(f),0))}</b><span>${cob.length} facturas</span></div><div class="kpi"><span>Por cobrar hoy</span><b>${usd(pend.reduce((s,f)=>s+fcUSD(f),0))}</b><span>${pend.length} facturas</span></div></div>`;
  if(isAdmin) html+=`<div class="kpis"><div class="kpi"><span>Gastos US$ eq.</span><b>${usd(p.gasTot)}</b></div><div class="kpi"><span>Resultado</span><b>${usd(p.res)}</b></div><div class="kpi"><span>Margen</span><b>${pct(p.margen)}</b></div><div class="kpi"><span>Tipo de cambio</span><b>${nf0.format(p.tc)}</b></div></div>`;
  html+=`<h2>Búsquedas</h2><div class="kpis"><div class="kpi"><span>Nuevas</span><b>${nuevas.length}</b></div><div class="kpi"><span>Cerradas</span><b>${cerr.length}</b></div><div class="kpi"><span>Canceladas</span><b>${canc.length}</b></div><div class="kpi"><span>Time to fill prom.</span><b>${ttfA??"—"}${ttfA!=null?" días":""}</b><span>objetivo ${o.timeToFillDias}</span></div></div>`;
  if(cerr.length) html+=`<table><thead><tr><th>Cerradas en el mes</th><th>Cliente</th><th>Recruiter</th><th class="r">Días</th></tr></thead><tbody>${cerr.map(b=>`<tr><td>${esc(b.puesto)}${b.candidatoFinal?` · ${esc(b.candidatoFinal)}`:""}</td><td>${esc(b.cliente)}</td><td>${esc(b.recruiter||"")}</td><td class="r">${ttf(b)??"—"}</td></tr>`).join("")}</tbody></table>`;
  if(Object.keys(porCli).length) html+=`<h2>Facturación por cliente</h2><table><tbody>${Object.entries(porCli).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`<tr><td>${esc(c)}</td><td class="r">${usd(v)}</td></tr>`).join("")}</tbody></table>`;
  html+=`<h2>Comercial</h2><div class="kpis"><div class="kpi"><span>Leads nuevos</span><b>${ln}</b></div><div class="kpi"><span>Propuestas enviadas</span><b>${lp}</b><span>objetivo ${o.propuestasMes}</span></div><div class="kpi"><span>Clientes ganados</span><b>${lg}</b><span>objetivo ${o.nuevosClientesMes}</span></div><div class="kpi"><span>Búsquedas activas hoy</span><b>${activas().length}</b></div></div>`;
  html+=`<h2>Equipo</h2><table><thead><tr><th>Recruiter</th><th class="r">Activas</th><th class="r">Cerradas en el mes</th><th class="r">Nuevas en el mes</th></tr></thead><tbody>${recActivos().map(r=>`<tr><td>${esc(r.nombre)}</td><td class="r">${activas().filter(b=>b.recruiter===r.nombre).length}</td><td class="r">${cerr.filter(b=>b.recruiter===r.nombre).length}</td><td class="r">${nuevas.filter(b=>b.recruiter===r.nombre).length}</td></tr>`).join("")}</tbody></table>`;
  printDoc(`Reporte mensual · ${fm(k)}`,html);
}

// ---- Funnel ----
// Cuenta cuántos candidatos llegaron a cada etapa (incluye a los descartados hasta la etapa en la que quedaron afuera)
function funnelData(ps){
  const etapas=ETAPAS.slice(0,7);
  return {total:ps.length, desc:ps.filter(p=>p.etapa==="Descartado").length, filas:etapas.map((e,i)=>({e,n:ps.filter(p=>alcance(p)>=i).length}))};
}
function funnelHTML(ps,titulo="Funnel del proceso"){
  if(!ps.length) return "";
  const f=funnelData(ps); const max=Math.max(1,f.filas[0].n);
  return `<div class="section"><span class="label">${titulo}</span>
  ${f.filas.map((x,i)=>{const prev=i?f.filas[i-1].n:null; return `<div class="bar"><span>${x.e}</span><div class="track"><i style="width:${Math.max(2,x.n/max*100)}%"></i></div><span class="num muted">${x.n}${prev?` · ${pct(x.n/prev)}`:""}</span></div>`;}).join("")}
  <div class="muted" style="font-size:12px">${f.total} candidatos en total · ${f.desc} descartados (cuentan hasta la etapa a la que llegaron). El % es la conversión desde la etapa anterior.</div></div>`;
}
function funnelPanel(){
  const desde=addDays(today(),-180); const bs=B().filter(b=>(b.fechaInicio||"")>=desde); const ids=new Set(bs.map(b=>b.id));
  const ps=vals(S.postulaciones).filter(p=>ids.has(p.busquedaId)); if(!ps.length) return "";
  return `<section class="panel"><div class="panel-head"><h2>Funnel de candidatos</h2><span class="muted">búsquedas iniciadas en los últimos 6 meses (${bs.length})</span></div>${funnelHTML(ps,"")}</section>`;
}

// ---- Historial ----
const HIST_LAB={gastos:"Gasto",gastosRecurrentes:"Gasto recurrente",busquedas:"Búsqueda",busquedasFin:"Finanzas de búsqueda",candidatos:"Candidato",postulaciones:"Postulación",facturas:"Factura",clientes:"Cliente",leads:"Lead",meses:"Mes (P&L)",feedback:"Pedido de mejora"};
const ACC_LAB={crear:"Creó",editar:"Editó",borrar:"Eliminó",restaurar:"Restauró",adjuntar:"Adjuntó archivo"};
function histNombre(hh){ const id=hh.registroId; const b=S.busquedas[id], c=S.candidatos[id], f=S.facturas[id], l=S.leads[id], cl=S.clientes[id], po=S.postulaciones[id];
  if(b) return `${b.puesto} · ${b.cliente}`; if(c) return c.nombre; if(f) return `${f.concepto||"Factura"} · ${f.cliente||""}`; if(l) return l.empresa; if(cl) return cl.nombre;
  if(po){ const cc=S.candidatos[po.candidatoId], bb=S.busquedas[po.busquedaId]; return `${cc?.nombre||"Candidato"} → ${bb?.puesto||"búsqueda"}`; }
  if(hh.coleccion==="busquedasFin"&&S.busquedas[id]) return S.busquedas[id].puesto; return id; }
function histFila(hh,conNombre=true){
  const ch=Object.entries(hh.cambios||{});
  return `<div class="row"><div class="grow"><div><b>${esc(authorName(hh.usuarioId))}</b> ${esc((ACC_LAB[hh.accion]||hh.accion).toLowerCase())} ${conNombre?`${esc(HIST_LAB[hh.coleccion]||hh.coleccion).toLowerCase()} <b>${esc(histNombre(hh))}</b>`:""}</div>
  ${ch.length?`<div class="muted" style="font-size:12.5px">${ch.slice(0,6).map(([k,[a,b]])=>`${esc(humanKey(k))}: <s>${esc(a===true?"Sí":a===false?"No":(a??"—"))}</s> → ${esc(b===true?"Sí":b===false?"No":(b??"—"))}`).join("<br>")}${ch.length>6?`<br>+${ch.length-6} cambios más`:""}</div>`:""}</div>
  <span class="muted num" style="font-size:12px;white-space:nowrap">${new Date(hh.fecha).toLocaleString("es-AR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</span></div>`;
}
async function cargarHistorial(){ try{ const q=new URLSearchParams({limite:"500"}); if(UI.hCol) q.set("coleccion",UI.hCol); S.historial=await api("/api/historial?"+q); schedule(); }catch(e){} }
function vHistorial(){
  if(!S.historial||S._hcol!==(UI.hCol||"")){ S._hcol=UI.hCol||""; cargarHistorial(); }
  let list=S.historial||[]; if(UI.hUser) list=list.filter(h=>h.usuarioId===UI.hUser); if(UI.hQ){ const q=keyN(UI.hQ); list=list.filter(h=>keyN(histNombre(h)+" "+JSON.stringify(h.cambios)).includes(q)); }
  const cols=Object.keys(HIST_LAB).filter(c=>isAdmin||(canFin&&c!=="meses")||["busquedas","candidatos","postulaciones","feedback"].includes(c));
  let h=`<div class="head"><div><h1>Historial de cambios</h1><p>Quién cambió qué y cuándo. Se registra desde la instalación de esta función.</p></div></div>
  <div class="toolbar"><select data-ui="hCol" aria-label="Tipo"><option value="">Todo</option>${opt(cols.map(c=>({v:c,l:HIST_LAB[c]})),UI.hCol)}</select>
  <select data-ui="hUser" aria-label="Usuario"><option value="">Todas las personas</option>${opt(Object.entries(names).map(([v,l])=>({v,l})),UI.hUser)}</select>
  <input id="q-h" type="search" placeholder="Buscar" data-ui="hQ" value="${esc(UI.hQ||"")}">${xbtn("historial")}</div>`;
  if(!S.historial) return h+`<div class="empty">Cargando…</div>`;
  if(!list.length) return h+`<div class="empty">Todavía no hay cambios registrados con estos filtros.</div>`;
  return h+`<section class="panel"><div class="list">${list.slice(0,300).map(x=>histFila(x)).join("")}</div></section>`;
}
function histSection(col,id){ setTimeout(()=>cargarHistSection(col,id),0); return `<div class="section"><span class="label">Historial</span><div id="hist-${esc(id)}" class="list"><div class="muted" style="font-size:13px">Cargando…</div></div></div>`; }
async function cargarHistSection(col,id){ const el=document.getElementById("hist-"+id); if(!el) return;
  try{ const rows=await api(`/api/historial?coleccion=${encodeURIComponent(col)}&registro=${encodeURIComponent(id)}&limite=30`); const el2=document.getElementById("hist-"+id); if(!el2) return;
    el2.innerHTML=rows.length?rows.map(x=>histFila(x,false)).join(""):`<div class="muted" style="font-size:13px">Sin cambios registrados todavía.</div>`; }catch(e){ el.innerHTML=""; } }

// ---- Papelera y backup (Equipo y accesos, solo socios) ----
function papeleraBox(){
  if(!isAdmin) return "";
  const P=S.papelera;
  return `<section class="panel"><div class="panel-head"><h2>Papelera y respaldo</h2><span style="display:flex;gap:6px"><a class="btn sm" href="/api/backup" download>Descargar backup completo</a></span></div>
  <div class="note">Lo que se elimina queda 30 días en la papelera y se puede restaurar. El backup descarga toda la base en un archivo; además se guarda una copia automática en Google Drive.</div>
  ${!P?`<div class="muted">Cargando papelera…</div>`:!P.length?`<div class="muted" style="font-size:13px">La papelera está vacía.</div>`:`<div class="list">${P.map(x=>`<div class="row"><div class="grow"><div><b>${esc(x.datos?.puesto||x.datos?.nombre||x.datos?.empresa||x.datos?.concepto||x.datos?.texto?.slice(0,60)||x.registroId)}</b> <span class="muted">· ${esc(HIST_LAB[x.coleccion]||x.coleccion)}</span></div><div class="muted" style="font-size:12px">Eliminado por ${esc(authorName(x.usuarioId))} el ${new Date(x.fecha).toLocaleDateString("es-AR")}</div></div><button class="btn sm" data-act="restaurar" data-id="${esc(x.id)}">Restaurar</button></div>`).join("")}</div>`}</section>`;
}
async function cargarPapelera(){ if(!isAdmin) return; try{ S.papelera=await api("/api/papelera"); schedule(); }catch(e){} }

// ---- Archivos adjuntos (CV) ----
function archivosSection(col,id){ setTimeout(()=>cargarArchivos(col,id),0); return `<div class="section"><div class="panel-head"><span class="label">Archivos (CV y otros)</span><label class="btn sm" style="cursor:pointer">Adjuntar<input type="file" data-upload="${col}" data-id="${esc(id)}" hidden accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"></label></div><div id="arch-${esc(id)}" class="list"><div class="muted" style="font-size:13px">Cargando…</div></div></div>`; }
async function cargarArchivos(col,id){ const el=document.getElementById("arch-"+id); if(!el) return;
  try{ const rows=await api(`/api/archivos?coleccion=${col}&registro=${encodeURIComponent(id)}`); const el2=document.getElementById("arch-"+id); if(!el2) return;
    el2.innerHTML=rows.length?rows.map(a=>`<div class="row"><div class="grow"><a href="/api/archivos/${a.id}?ver=1" target="_blank" rel="noopener">${esc(a.nombre)}</a><div class="muted" style="font-size:12px">${Math.max(1,Math.round(a.tamano/1024))} KB · ${new Date(a.fecha).toLocaleDateString("es-AR")} · ${esc(authorName(a.usuarioId))}</div></div><a class="btn sm ghost" href="/api/archivos/${a.id}" download>Descargar</a><button class="btn sm ghost" data-act="archDel" data-id="${a.id}" data-col="${col}" data-reg="${esc(id)}">Quitar</button></div>`).join(""):`<div class="muted" style="font-size:13px">Sin archivos. Adjuntá el CV en PDF o Word (hasta 8 MB).</div>`; }catch(e){ el.innerHTML=""; } }
document.addEventListener("change",async e=>{ const el=e.target; if(!el.dataset||!el.dataset.upload) return; const f=el.files&&el.files[0]; if(!f) return;
  if(f.size>8*1024*1024){ toast("El archivo supera los 8 MB.",true); return; }
  const b64=await new Promise((ok,ko)=>{ const r=new FileReader(); r.onload=()=>ok(String(r.result).split(",")[1]); r.onerror=ko; r.readAsDataURL(f); });
  try{ toast("Subiendo…"); await api("/api/archivos",{method:"POST",body:JSON.stringify({coleccion:el.dataset.upload,registroId:el.dataset.id,nombre:f.name,tipo:f.type,base64:b64})}); toast("Archivo adjuntado"); cargarArchivos(el.dataset.upload,el.dataset.id); }
  catch(err){ if(err.code!==401) toast(err.message||"No se pudo subir.",true); } el.value=""; });

// ---- Buscador global ----
function buscarGlobal(q){
  const k=keyN(q); if(k.length<2) return [];
  const out=[]; const add=(t,sub,act,id,tipo)=>out.push({t,sub,act,id,tipo});
  (canFin?recruiters().map(r=>r.nombre):[miNombreRec()]).forEach(n=>{ if(n&&keyN(n).includes(k)) { const na=B().filter(b=>keyN(b.recruiter)===keyN(n)&&b.estado==="Activa").length; add(n,`${na} ${na===1?"búsqueda activa":"búsquedas activas"}`,"openRecruiter",n,"Recruiter"); } });
  B().forEach(b=>{ if(keyN(b.puesto+" "+b.cliente+" "+(b.candidatoFinal||"")+" "+(b.recruiter||"")).includes(k)) add(b.puesto,`${b.cliente} · ${b.estado}${b.recruiter?" · "+b.recruiter:""}`,"openBusqueda",b.id,"Búsqueda"); });
  vals(S.candidatos).forEach(c=>{ if(keyN(c.nombre+" "+(c.email||"")+" "+(c.empresaActual||"")).includes(k)) add(c.nombre,[c.rolActual,c.empresaActual].filter(Boolean).join(" · "),"openCandidato",c.id,"Candidato"); });
  if(canFin){ clienteStats().forEach(c=>{ if(keyN(c.nombre).includes(k)) add(c.nombre,`${c.total} búsquedas · ${c.estado}`,"openCliente",c.k,"Cliente"); });
    vals(S.leads).forEach(l=>{ if(keyN(l.empresa+" "+(l.contacto||"")).includes(k)) add(l.empresa,`${l.contacto||""} · ${l.etapa}`,"openLead",l.id,"Lead"); }); }
  const pri=x=>keyN(x.t).startsWith(k)?0:1; return sortBy(out,x=>pri(x)).slice(0,14);
}
function pintarBuscador(){ const inp=$("#gq"), box=$("#gres"); if(!inp||!box) return; const res=buscarGlobal(inp.value);
  if(!inp.value.trim()){ box.hidden=true; return; } box.hidden=false;
  box.innerHTML=res.length?res.map((r,i)=>`<button class="gitem${i===0?" on":""}" data-act="${r.act}" data-id="${esc(r.id)}"><span class="tag">${r.tipo}</span><b>${esc(r.t)}</b><span class="muted">${esc(r.sub||"")}</span></button>`).join(""):`<div class="muted" style="padding:8px 10px;font-size:13px">Sin resultados</div>`; }
document.addEventListener("input",e=>{ if(e.target.id==="gq") pintarBuscador(); });
document.addEventListener("keydown",e=>{
  if(e.key==="/"&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||"")){ e.preventDefault(); $("#gq")?.focus(); }
  if(e.target.id==="gq"){ if(e.key==="Escape"){ e.target.value=""; pintarBuscador(); e.target.blur(); } if(e.key==="Enter"){ $("#gres .gitem")?.click(); } }
});
document.addEventListener("click",e=>{ const it=e.target.closest&&e.target.closest(".gitem"); if(it){ setTimeout(()=>{ const i=$("#gq"); if(i){ i.value=""; pintarBuscador(); } },0); } else if(!e.target.closest?.(".gsearch")){ const b=$("#gres"); if(b) b.hidden=true; } });


// ================= WEEKLY: sección comercial (socios y administradora) =================
function wkComData(r){
  const L=vals(S.leads); const abierto=l=>!["Ganado","Perdido"].includes(l.etapa);
  const nuevos=L.filter(l=>inRange(l.fechaPrimerContacto,r));
  const movidos=L.filter(l=>inRange(l.fechaUltimoContacto,r)&&!inRange(l.fechaPrimerContacto,r));
  const propuestas=L.filter(l=>l.etapa==="Propuesta enviada"&&(inRange(l.fechaUltimoContacto,r)||inRange(l.fechaPrimerContacto,r)));
  const ganados=L.filter(l=>l.etapa==="Ganado"&&inRange(l.fechaUltimoContacto||l.fechaPrimerContacto,r));
  const perdidos=L.filter(l=>l.etapa==="Perdido"&&inRange(l.fechaUltimoContacto||l.fechaPrimerContacto,r));
  const seguir=sortBy(L.filter(l=>abierto(l)&&l.proximoSeguimiento&&l.proximoSeguimiento<=addDays(r.e,7)),l=>l.proximoSeguimiento);
  const F=vals(S.facturas); const emit=F.filter(f=>!f.historico&&inRange(f.fechaEmision,r)); const cob=F.filter(f=>f.cobrada&&inRange(f.fechaCobro,r));
  const vencidas=F.filter(f=>!f.cobrada&&days(f.fechaEmision,r.e)>30);
  const vistos=new Set(); const movs=[];
  for(const [t,arr] of [["ganado",ganados],["perdido",perdidos],["propuesta",propuestas],["nuevo",nuevos]]) for(const l of arr) if(!vistos.has(l.id)){ vistos.add(l.id); movs.push([t,l]); }
  return {nuevos,movidos,propuestas,ganados,perdidos,seguir,emit,cob,vencidas,movs,abiertos:L.filter(abierto).length};
}
function wkComercial(D){
  if(!canFin) return "";
  const {r}=D; const C=wkComData(r);
  const leadRow=(l,extra="")=>`<div class="row" data-act="openLead" data-id="${l.id}" style="cursor:pointer"><div class="grow"><b>${esc(l.empresa)}</b>${l.contacto?` · ${esc(l.contacto)}`:""}<div class="muted">${esc(l.etapa)}${extra}</div></div><button class="btn sm ghost" data-act="openLead" data-id="${l.id}">Abrir</button></div>`;
  const ETQ={nuevo:["Nuevo","lemon"],propuesta:["Propuesta","info"],ganado:["Ganado","ok"],perdido:["Perdido","crit"]};
  const venc=C.seguir.filter(l=>l.proximoSeguimiento<today());
  return `<div class="toolbar"><span class="chip"><b>${C.abiertos}</b> leads abiertos</span><span class="chip"><b>${C.nuevos.length}</b> nuevos</span><span class="chip"><b>${C.propuestas.length}</b> propuestas</span><span class="chip"><b>${C.ganados.length}</b> ganados · <b>${C.perdidos.length}</b> perdidos</span>${venc.length?`<span class="chip warn"><b>${venc.length}</b> seguimientos vencidos</span>`:""}<a class="btn sm ghost" href="#crm">Ir a Clientes y leads</a></div>
  <div class="grid2">
  <section class="panel"><div class="panel-head"><h2>Movimientos de la semana</h2></div><div class="list">${C.movs.map(([t,l])=>`<div class="row" data-act="openLead" data-id="${l.id}" style="cursor:pointer"><span class="pill ${ETQ[t][1]}">${ETQ[t][0]}</span><div class="grow"><b>${esc(l.empresa)}</b>${l.contacto?` · ${esc(l.contacto)}`:""}<div class="muted">${esc(l.etapa)}</div></div></div>`).join("")||`<div class="empty">Sin movimientos comerciales cargados esta semana.</div>`}</div></section>
  <section class="panel"><div class="panel-head"><h2>Seguimientos</h2><span class="muted">vencidos y próximos 7 días</span></div><div class="list">${C.seguir.length?C.seguir.slice(0,15).map(l=>leadRow(l,` · ${l.proximoSeguimiento<today()?`<span class="pill crit">vencido ${fd(l.proximoSeguimiento)}</span>`:`seguir ${fd(l.proximoSeguimiento)}`}`)).join(""):`<div class="empty">No hay seguimientos pendientes.</div>`}</div></section>
  </div>`;
}
function wkComercialPDF(D){
  if(!canFin||UI.wkRec) return "";
  const C=wkComData(D.r); const sumU=a=>a.reduce((s,f)=>s+fcUSD(f),0);
  const filas=C.movs.map(([t,l])=>[t[0].toUpperCase()+t.slice(1),l]);
  return `<h2>Comercial</h2><div class="kpis"><div class="kpi"><span>Leads nuevos</span><b>${C.nuevos.length}</b></div><div class="kpi"><span>Propuestas</span><b>${C.propuestas.length}</b></div><div class="kpi"><span>Ganados · perdidos</span><b>${C.ganados.length} · ${C.perdidos.length}</b></div><div class="kpi"><span>Facturado · cobrado</span><b>${usd(sumU(C.emit))} · ${usd(sumU(C.cob))}</b></div></div>
  ${filas.length?`<table><tbody>${filas.map(([t,l])=>`<tr><td><span class="tag">${t}</span></td><td><b>${esc(l.empresa)}</b>${l.contacto?` · ${esc(l.contacto)}`:""}</td><td>${esc(l.etapa)}</td></tr>`).join("")}</tbody></table>`:""}
  ${C.seguir.length?`<h3>Seguimientos</h3><table><tbody>${C.seguir.slice(0,15).map(l=>`<tr><td>${fd(l.proximoSeguimiento)}${l.proximoSeguimiento<today()?" (vencido)":""}</td><td><b>${esc(l.empresa)}</b>${l.contacto?` · ${esc(l.contacto)}`:""}</td><td>${esc(l.etapa)}</td></tr>`).join("")}</tbody></table>`:""}`;
}
function wkComercialTexto(D){
  if(!canFin||UI.wkRec) return "";
  const C=wkComData(D.r);
  let t=`\nComercial: ${C.nuevos.length} leads nuevos · ${C.propuestas.length} propuestas · ${C.ganados.length} ganados · ${C.perdidos.length} perdidos\n`;
  C.movs.forEach(([k,l])=>t+=`• ${k[0].toUpperCase()+k.slice(1)}: ${l.empresa}${l.contacto?" ("+l.contacto+")":""}\n`);
  const venc=C.seguir.filter(l=>l.proximoSeguimiento<today()); if(venc.length) t+=`• Seguimientos vencidos: ${venc.map(l=>l.empresa).join(", ")}\n`;
  return t;
}


// ================= SCORECARD (automático) y CALIDAD DE DATOS =================
const CORTE_FACTURAS = "2024-12"; // desde acá los ingresos salen de las facturas, no de la planilla Economics
function scPeriodos(){
  const n=8, out=[];
  if(UI.scPer==="mes"){ const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-(UI.mesOff||0));
    for(let i=n-1;i>=0;i--){ const x=new Date(d.getFullYear(),d.getMonth()-i,1); const k=`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}`; const fin=new Date(x.getFullYear(),x.getMonth()+1,0);
      out.push({s:k+"-01",e:`${k}-${String(fin.getDate()).padStart(2,"0")}`,k,l:fm(k)}); } }
  else { const ws=UI.wk||weekStart(); for(let i=n-1;i>=0;i--){ const s=addDays(ws,-7*i); out.push({s,e:addDays(s,6),l:fd(s).replace(/ \d+$/,"")}); } }
  return out;
}
const vivaAl = (b,e) => b.fechaInicio && b.fechaInicio<=e && (!b.fechaCierre||b.fechaCierre>e) && (e<today()? !( ["Cerrada","Cancelada"].includes(b.estado) && !b.fechaCierre) : b.estado==="Activa");
function scMetricas(){
  const BB=B(), L=vals(S.leads), F=vals(S.facturas), fin=S.fin||{}, P=vals(S.postulaciones), recs=recActivos(), o=obj(), esMes=UI.scPer==="mes";
  const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  const prorr=v=>v?(esMes?v:v*7/30.4):null;
  const feeDe=b=>{ const x=fin[b.id]||{}; const est=x.feeEstimadoARS||(x.sueldoBrutoARS&&x.feeMultiplo?x.sueldoBrutoARS*x.feeMultiplo:0); if(est) return est; const fc=F.filter(f=>f.busquedaId===b.id); return fc.length?fc.reduce((s,f)=>s+fcARS(f),0):null; };
  const clientesConBusq=e=>new Set(BB.filter(b=>vivaAl(b,e)).map(b=>keyN(b.cliente)));
  const primeraBusq={}; BB.forEach(b=>{ const k=keyN(b.cliente); if(b.fechaInicio&&(!primeraBusq[k]||b.fechaInicio<primeraBusq[k])) primeraBusq[k]=b.fechaInicio; });
  const emit=r=>F.filter(f=>!f.historico&&inRange(f.fechaEmision,r));
  const M=[
    {sec:"Comercial",fin:true},
    {l:"Leads nuevos",dir:1,fin:true,f:r=>L.filter(l=>inRange(l.fechaPrimerContacto,r)).length},
    {l:"Primer contacto comercial",dir:1,fin:true,f:r=>L.filter(l=>inRange(l.fechaPrimerContacto,r)&&!["Identificado","Nuevo"].includes(l.etapa)).length,n:"aprox."},
    {l:"Re-contactos",dir:1,fin:true,f:r=>L.filter(l=>inRange(l.fechaUltimoContacto,r)&&(l.fechaPrimerContacto||"")<r.s).length},
    {l:"Propuestas abiertas",dir:1,fin:true,f:r=>L.filter(l=>l.etapa==="Propuesta enviada"&&(l.fechaUltimoContacto||l.fechaPrimerContacto||"")<=r.e).length,n:"aprox. · al cierre del período"},
    {l:"Clientes nuevos",dir:1,fin:true,obj:()=>esMes?o.nuevosClientesMes:null,f:r=>Object.values(primeraBusq).filter(d=>inRange(d,r)).length,n:"primera búsqueda en el período"},
    {l:"Búsquedas nuevas",dir:1,f:r=>BB.filter(b=>inRange(b.fechaInicio,r)).length},
    {l:"Clientes con búsquedas activas",dir:1,f:r=>clientesConBusq(r.e).size},
    {l:"Clientes que se desactivaron",dir:-1,f:r=>{ const antes=clientesConBusq(addDays(r.s,-1)), desp=clientesConBusq(r.e); return [...antes].filter(k=>!desp.has(k)).length; },n:"tenían búsqueda activa al inicio y ya no"},
    {sec:"Facturación y fees",fin:true},
    {l:"Facturado (ARS eq.)",dir:1,fin:true,fmt:"ars",obj:()=>prorr(o.facturacionMensualARS),f:r=>emit(r).reduce((s,f)=>s+fcARS(f),0),n:"por fecha de emisión"+(esMes?"":" · objetivo mensual prorrateado")},
    {l:"Facturado (US$ eq.)",dir:1,fin:true,fmt:"usd",f:r=>emit(r).reduce((s,f)=>s+fcUSD(f),0)},
    {l:"Cobrado (US$ eq.)",dir:1,fin:true,fmt:"usd",f:r=>F.filter(f=>f.cobrada&&inRange(f.fechaCobro,r)).reduce((s,f)=>s+fcUSD(f),0),n:"por fecha de cobro"},
    {l:"Ticket promedio facturado",dir:1,fin:true,fmt:"usd",f:r=>avg(emit(r).map(fcUSD))},
    {l:"Fee promedio búsquedas cerradas",dir:1,fin:true,fmt:"ars",obj:()=>o.ticketPromedioARS,f:r=>avg(BB.filter(b=>b.estado==="Cerrada"&&inRange(b.fechaCierre,r)).map(feeDe).filter(x=>x>0))},
    {l:"Fee promedio búsquedas activas",dir:1,fin:true,fmt:"ars",f:r=>avg(BB.filter(b=>vivaAl(b,r.e)).map(feeDe).filter(x=>x>0)),n:"estimado o facturado"},
    {l:"Total fees en búsquedas activas",dir:1,fin:true,fmt:"ars",f:r=>BB.filter(b=>vivaAl(b,r.e)).reduce((s,b)=>s+(feeDe(b)||0),0),n:"lo que hay en juego"},
    {l:"Costos del mes (US$ eq.)",dir:-1,socio:true,mes:true,fmt:"usd",f:r=>pnl(r.k).gasTot},
    {l:"Resultado del mes (US$ eq.)",dir:1,socio:true,mes:true,fmt:"usd",f:r=>pnl(r.k).res},
    {sec:"Nivel de servicio"},
    {l:"Búsquedas cerradas con éxito",dir:1,f:r=>BB.filter(b=>b.estado==="Cerrada"&&inRange(b.fechaCierre,r)).length},
    {l:"Búsquedas canceladas",dir:-1,f:r=>BB.filter(b=>b.estado==="Cancelada"&&inRange(b.fechaCierre,r)).length},
    {l:"Tiempo de cierre (días)",dir:-1,obj:()=>o.timeToFillDias,f:r=>{const a=BB.filter(b=>b.estado==="Cerrada"&&inRange(b.fechaCierre,r)).map(ttf).filter(x=>x!=null); return a.length?Math.round(avg(a)):null;},n:"promedio de las cerradas en el período"},
    {l:"Candidatos presentados",dir:1,f:r=>P.filter(p=>inRange(p.fecha,r)&&["Presentado","Entrevista cliente","Oferta","Contratado"].includes(p.etapa)).length,n:"aprox."},
    {l:"Reemplazos por garantía",dir:-1,f:r=>BB.filter(b=>b.garantia&&inRange(b.fechaInicio,r)).length},
    {l:"Antigüedad promedio de las abiertas (días)",dir:-1,f:r=>{const a=BB.filter(b=>vivaAl(b,r.e)).map(b=>days(b.fechaInicio,r.e)); return a.length?Math.round(avg(a)):null;}},
    {l:"Abiertas hace más de 30 días",dir:-1,f:r=>BB.filter(b=>vivaAl(b,r.e)&&days(b.fechaInicio,r.e)>30).length},
    {l:"Estancadas (+7 días sin actualizar)",dir:-1,f:r=>r.e>=today()?activas().filter(b=>(days(lastTouch(b))??99)>7).length:null,n:"solo el período actual"},
    {sec:"Capacidad"},
    {l:"Búsquedas activas",dir:1,obj:()=>o.busquedasActivas,f:r=>BB.filter(b=>vivaAl(b,r.e)).length},
    {l:"Utilización de capacidad",dir:0,fmt:"pct",f:r=>{const cap=recs.reduce((s,x)=>s+(+x.capacidad||0),0); return cap?BB.filter(b=>vivaAl(b,r.e)).length/cap:null;},n:"búsquedas activas / capacidad del equipo"},
    {l:"Búsquedas en pausa",dir:-1,f:r=>r.e>=today()?BB.filter(b=>b.estado==="En pausa").length:null,n:"solo el período actual"},
    {l:"Recruiters activas",dir:0,f:r=>r.e>=today()?recs.length:null,n:"solo el período actual"},
    ...recs.map(x=>({l:"Activas · "+x.nombre,rec:true,f:r=>BB.filter(b=>vivaAl(b,r.e)&&b.recruiter===x.nombre).length})),
  ];
  // Detalle de cada número: qué registros lo componen en el período (se abre al tocar la tarjeta)
  const vivas=r=>BB.filter(b=>vivaAl(b,r.e)), feeTxt=b=>{ const v=feeDe(b); return canFin&&v?`fee ${short(v)}`:""; };
  const IB=(b,x)=>["b",b,x], IL=l=>["l",l], IF=f=>["f",f], IP=p=>["p",p];
  const IT={
    "Leads nuevos":r=>L.filter(l=>inRange(l.fechaPrimerContacto,r)).map(IL),
    "Primer contacto comercial":r=>L.filter(l=>inRange(l.fechaPrimerContacto,r)&&!["Identificado","Nuevo"].includes(l.etapa)).map(IL),
    "Re-contactos":r=>L.filter(l=>inRange(l.fechaUltimoContacto,r)&&(l.fechaPrimerContacto||"")<r.s).map(IL),
    "Propuestas abiertas":r=>L.filter(l=>l.etapa==="Propuesta enviada"&&(l.fechaUltimoContacto||l.fechaPrimerContacto||"")<=r.e).map(IL),
    "Clientes nuevos":r=>BB.filter(b=>inRange(b.fechaInicio,r)&&primeraBusq[keyN(b.cliente)]===b.fechaInicio).map(b=>IB(b,"primera búsqueda del cliente")),
    "Búsquedas nuevas":r=>BB.filter(b=>inRange(b.fechaInicio,r)).map(b=>IB(b)),
    "Clientes con búsquedas activas":r=>sortBy(vivas(r),b=>b.cliente).map(b=>IB(b)),
    "Clientes que se desactivaron":r=>{ const desp=clientesConBusq(r.e); return BB.filter(b=>vivaAl(b,addDays(r.s,-1))&&!desp.has(keyN(b.cliente))).map(b=>IB(b,"era su última búsqueda activa")); },
    "Facturado (ARS eq.)":r=>emit(r).map(IF), "Facturado (US$ eq.)":r=>emit(r).map(IF), "Ticket promedio facturado":r=>emit(r).map(IF),
    "Cobrado (US$ eq.)":r=>F.filter(f=>f.cobrada&&inRange(f.fechaCobro,r)).map(IF),
    "Fee promedio búsquedas cerradas":r=>BB.filter(b=>b.estado==="Cerrada"&&inRange(b.fechaCierre,r)).map(b=>IB(b,feeTxt(b))),
    "Fee promedio búsquedas activas":r=>vivas(r).map(b=>IB(b,feeTxt(b)||"sin fee cargado")),
    "Total fees en búsquedas activas":r=>sortBy(vivas(r),b=>-(feeDe(b)||0)).map(b=>IB(b,feeTxt(b)||"sin fee cargado")),
    "Búsquedas cerradas con éxito":r=>BB.filter(b=>b.estado==="Cerrada"&&inRange(b.fechaCierre,r)).map(b=>IB(b,b.candidatoFinal?"ingresó "+b.candidatoFinal:"")),
    "Búsquedas canceladas":r=>BB.filter(b=>b.estado==="Cancelada"&&inRange(b.fechaCierre,r)).map(b=>IB(b)),
    "Tiempo de cierre (días)":r=>sortBy(BB.filter(b=>b.estado==="Cerrada"&&inRange(b.fechaCierre,r)&&ttf(b)!=null),b=>-ttf(b)).map(b=>IB(b,`${ttf(b)} días`)),
    "Candidatos presentados":r=>P.filter(p=>inRange(p.fecha,r)&&["Presentado","Entrevista cliente","Oferta","Contratado"].includes(p.etapa)).map(IP),
    "Reemplazos por garantía":r=>BB.filter(b=>b.garantia&&inRange(b.fechaInicio,r)).map(b=>IB(b)),
    "Antigüedad promedio de las abiertas (días)":r=>sortBy(vivas(r),b=>b.fechaInicio||"").map(b=>IB(b,`${days(b.fechaInicio,r.e)} días`)),
    "Abiertas hace más de 30 días":r=>sortBy(vivas(r).filter(b=>days(b.fechaInicio,r.e)>30),b=>b.fechaInicio||"").map(b=>IB(b,`${days(b.fechaInicio,r.e)} días`)),
    "Estancadas (+7 días sin actualizar)":r=>activas().filter(b=>(days(lastTouch(b))??99)>7).map(b=>IB(b,`sin novedades hace ${days(lastTouch(b))??"—"} días`)),
    "Búsquedas activas":r=>vivas(r).map(b=>IB(b)), "Utilización de capacidad":r=>vivas(r).map(b=>IB(b)),
    "Búsquedas en pausa":r=>BB.filter(b=>b.estado==="En pausa").map(b=>IB(b)),
  };
  const GO={"Costos del mes (US$ eq.)":r=>drawerMes(r.k),"Resultado del mes (US$ eq.)":r=>drawerMes(r.k),"Recruiters activas":()=>{ location.hash="#recruiters"; }};
  M.forEach(m=>{ if(IT[m.l]) m.it=IT[m.l]; if(GO[m.l]) m.go=GO[m.l]; });
  return M.filter(m=>(!m.fin||canFin)&&(!m.socio||isAdmin)&&(!m.mes||esMes));
}
// Panel lateral con los registros que forman un número del período actual
function drawerMetrica(label){
  const m=scMetricas().find(x=>x.l===label); if(!m) return;
  const per=scPeriodos(), r=per[per.length-1];
  if(m.go){ m.go(r); return; }
  if(!m.it) return;
  const items=m.it(r);
  const fila=([k,o,x])=>{
    if(k==="b") return `<div class="row click" data-act="openBusqueda" data-id="${o.id}"><div class="grow" style="min-width:0"><b>${esc(o.puesto)}</b><div class="muted" style="font-size:12px">${esc(o.cliente)}${o.recruiter?" · "+esc(o.recruiter):""}${x?" · "+esc(x):""}</div></div>${pillEstado(o.estado)}</div>`;
    if(k==="l") return `<div class="row click" data-act="openLead" data-id="${o.id}"><div class="grow" style="min-width:0"><b>${esc(o.empresa)}</b><div class="muted" style="font-size:12px">${esc([o.contacto,o.fechaUltimoContacto||o.fechaPrimerContacto?fd(o.fechaUltimoContacto||o.fechaPrimerContacto):""].filter(Boolean).join(" · "))}</div></div>${pillLead(o.etapa)}</div>`;
    if(k==="f") return `<div class="row click" data-act="openFactura" data-id="${o.id}"><div class="grow" style="min-width:0"><b>${esc(o.cliente||"")}</b><div class="muted" style="font-size:12px">${esc(o.concepto||"")} · ${fd(o.fechaEmision)}</div></div><div style="text-align:right"><div class="num">${money(o.monto,o.moneda)}</div>${o.cobrada?'<span class="pill ok">Cobrada</span>':'<span class="pill warn">Por cobrar</span>'}</div></div>`;
    const c=S.candidatos[o.candidatoId]||{}, b=S.busquedas[o.busquedaId]||{};
    return `<div class="row click" data-act="openCandidato" data-id="${o.candidatoId}"><div class="grow" style="min-width:0"><b>${esc(c.nombre||"Candidato")}</b><div class="muted" style="font-size:12px">${esc(b.puesto||"")} · ${esc(b.cliente||"")} · ${fd(o.fecha)}</div></div>${pillEtapa(o.etapa)}</div>`;
  };
  const body=`<div class="kpis">${kpi(m.l,scFmt(m.f(r),m.fmt),`${r.l}${m.n?" · "+m.n:""}`)}</div>
    <div class="section"><span class="label">${items.length} ${items.length===1?"registro":"registros"}</span>${items.length?`<div class="list">${items.map(fila).join("")}</div>`:'<div class="muted" style="font-size:13px">No hay registros en este período.</div>'}</div>`;
  openDrawer(m.l,UI.scPer==="mes"?`Mes: ${r.l}`:`Semana del ${fd(r.s)} al ${fd(r.e)}`,body,{});
}
const scFmt=(v,f)=> v==null||isNaN(v)?"—": f==="ars"?short(v): f==="usd"?usd(v): f==="pct"?pct(v): nf0.format(v);
function datosScorecard(){ const per=scPeriodos(); return scMetricas().filter(m=>!m.sec).map(m=>Object.fromEntries([["Métrica",m.l.trim()],...per.map(p=>[p.l,(()=>{const v=m.f(p); return v==null||isNaN(v)?"":(m.fmt==="pct"?Math.round(v*100)+"%":Math.round(v));})()])])); }
function calidadDatos(){
  const out=[]; const F=vals(S.facturas); const BB=B();
  const ib=b=>({l:`${b.puesto} · ${b.cliente}`,s:`${b.estado}${b.recruiter?" · "+b.recruiter:""}${b.fechaInicio?" · inicio "+fd(b.fechaInicio):""}`,act:"openBusqueda",id:b.id});
  const iff=f=>({l:`${f.concepto||f.tipo||"Factura"} · ${f.cliente||""}`,s:`${fd(f.fechaEmision)} · ${money(f.monto,f.moneda)}${f.busquedaId&&S.busquedas[f.busquedaId]?" · búsqueda "+S.busquedas[f.busquedaId].estado.toLowerCase():""}`,act:"openFactura",id:f.id});
  const add=(t,d,items,sev="warn")=>out.push({t,d,items,sev});
  if(S.cliDocs){ const sd=clienteStats().filter(c=>c.act>0&&!tieneDoc(c.nombre)); if(sd.length) add(`${sd.length} clientes con búsquedas activas sin propuesta ni contrato`,"Es obligatorio: subí la propuesta comercial o el contrato en la ficha del cliente. Sin eso no se pueden abrir búsquedas nuevas.",sd.map(c=>({l:c.nombre,s:`${c.act} búsquedas activas`,act:"openCliente",id:c.k})),"crit"); }
  const sf=activas().filter(b=>{ const x=(S.fin||{})[b.id]||{}; return !(x.feeEstimadoARS||(x.sueldoBrutoARS&&x.feeMultiplo)); }); if(sf.length) add(`${sf.length} búsquedas activas sin fee estimado`,"Cargá sueldo y fee en la búsqueda: sin eso no suma al total de fees en juego del Weekly.",sf.map(ib));
  const sinBusq=F.filter(f=>!f.historico&&!f.busquedaId); if(sinBusq.length) add(`${sinBusq.length} facturas sin búsqueda vinculada`,"Sin el vínculo, el fee y el facturado de la búsqueda no cuadran. Abrí la factura y elegí la búsqueda.",sinBusq.map(iff),"crit");
  const desde=CORTE_FACTURAS+"-01"; const fx=b=>F.filter(f=>f.busquedaId===b.id);
  const d1=BB.filter(b=>b.estado==="Cerrada"&&(b.fechaCierre||"")>=desde&&!b.garantia&&!fx(b).some(f=>f.tipo==="Cierre")); if(d1.length) add(`${d1.length} búsquedas cerradas sin factura de cierre`,"Si se facturó, vinculá la factura a la búsqueda. Si no se facturó, hay que emitirla.",d1.map(ib),"crit");
  const d2=F.filter(f=>f.tipo==="Cierre"&&f.busquedaId&&S.busquedas[f.busquedaId]&&S.busquedas[f.busquedaId].estado!=="Cerrada"); if(d2.length) add(`${d2.length} facturas de cierre de búsquedas que no figuran cerradas`,"O la búsqueda está mal cancelada o la factura está vinculada a otra búsqueda.",d2.map(iff));
  const d3=BB.filter(b=>b.inicioAvance&&(b.fechaInicio||"")>=desde&&!fx(b).some(f=>/inicio|anticipo/i.test(f.tipo||""))); if(d3.length) add(`${d3.length} búsquedas con inicio y avance sin esa factura`,"La búsqueda dice que cobra inicio y avance pero no tiene esa factura vinculada.",d3.map(ib));
  const d4=F.filter(f=>f.busquedaId&&S.busquedas[f.busquedaId]&&keyN(S.busquedas[f.busquedaId].cliente)!==keyN(f.cliente)); if(d4.length) add(`${d4.length} facturas cuyo cliente no coincide con el de su búsqueda`,"Corregí el cliente en la factura o el vínculo con la búsqueda.",d4.map(iff));
  const c1=BB.filter(b=>b.estado==="Cerrada"&&!b.candidatoFinal); if(c1.length) add(`${c1.length} búsquedas cerradas sin candidato final`,"Cargá quién ingresó: se usa en garantías y en el historial del cliente.",c1.map(ib));
  const c2=BB.filter(b=>["Cerrada","Cancelada"].includes(b.estado)&&!b.fechaCierre); if(c2.length) add(`${c2.length} búsquedas cerradas o canceladas sin fecha de cierre`,"Sin fecha de cierre no entran en el tiempo de cierre ni en los números del período.",c2.map(ib));
  const c3=BB.filter(b=>!b.recruiter); if(c3.length) add(`${c3.length} búsquedas sin recruiter`,"Asigná la recruiter para que cuente en la capacidad y en las comisiones.",c3.map(ib));
  const nom=recruiters().map(r=>r.nombre); const c4=uniq(BB.filter(b=>b.recruiter&&!nom.includes(b.recruiter)).map(b=>b.recruiter)); if(c4.length) add("Recruiters en búsquedas que no están en el equipo",c4.join(", ")+". Agregalas en Equipo › Editar equipo o renombralas.",[]);
  const d5=F.filter(f=>f.comisionPagada&&f.comision>0&&!f.fechaPagoComision&&!f.historico); if(d5.length) add(`${d5.length} comisiones pagadas sin fecha de pago`,"Son de antes de que existiera el campo. Desde ahora se registra sola al marcar “Comisión pagada”.",d5.map(iff),"info");
  const h=hist(); const dif=Object.keys(h).filter(k=>k>=CORTE_FACTURAS).map(k=>{ const fs=F.filter(f=>!f.historico&&ym(f.fechaEmision)===k); const a=fs.filter(f=>f.moneda!=="USD").reduce((s,f)=>s+(f.monto||0),0), u=fs.filter(f=>f.moneda==="USD").reduce((s,f)=>s+(f.monto||0),0); return {k,da:a-(h[k].ingresosARS||0),du:u-(h[k].ingresosUSD||0)}; }).filter(x=>Math.abs(x.da)>1||Math.abs(x.du)>1);
  const fmtDif=x=>`${x.da?`ARS ${x.da>0?"+":""}${nf0.format(x.da)}`:""}${x.da&&x.du?" · ":""}${x.du?`USD ${x.du>0?"+":""}${nf0.format(x.du)}`:""}`;
  if(dif.length) add(`${dif.length} meses donde la planilla Economics no coincide con las facturas`,"El sistema usa las facturas. Diferencia (facturas − planilla) por mes:",dif.map(x=>({l:fm(x.k),s:fmtDif(x)})),"info");
  const dc=Object.keys(h).filter(k=>k>=CORTE_FACTURAS).map(k=>{ const pl=(h[k].gastos||[]).filter(g=>/recruiters? freelance/i.test(g.concepto||"")); const pa=pl.filter(g=>g.moneda!=="USD").reduce((s,g)=>s+(+g.monto||0),0), pu=pl.filter(g=>g.moneda==="USD").reduce((s,g)=>s+(+g.monto||0),0);
    const fs=F.filter(f=>ym(f.fechaEmision)===k&&f.comision>0); const fa=fs.filter(f=>f.monedaComision!=="USD").reduce((s,f)=>s+f.comision,0), fu2=fs.filter(f=>f.monedaComision==="USD").reduce((s,f)=>s+f.comision,0); return {k,da:fa-pa,du:fu2-pu}; }).filter(x=>Math.abs(x.da)>1||Math.abs(x.du)>1);
  if(dc.length) add(`${dc.length} meses donde las comisiones de la planilla no coinciden con las facturas`,"El sistema usa las comisiones de las facturas. Diferencia (facturas − planilla) por mes:",dc.map(x=>({l:fm(x.k),s:fmtDif(x)})),"info");
  const rev=vals(S.leads).filter(l=>/Revisar: figuraba como cliente/.test(l.notas||"")); if(rev.length) add(`${rev.length} leads para revisar`,"Figuraban como clientes activos pero no tienen búsquedas. Definí si siguen en conversación o pasan a perdido.",rev.map(l=>({l:l.empresa,s:l.etapa,act:"openLead",id:l.id})));
  return out;
}
function vCalidad(){
  const q=calidadDatos(); const total=q.reduce((s,x)=>s+(x.items.length||1),0);
  let h=`<div class="head"><div><h1>Calidad de datos</h1><p>Inconsistencias entre búsquedas, facturas, comisiones y leads. Abrí cada caso y corregilo ahí: la lista se actualiza sola.</p></div></div>`;
  if(!q.length) return h+`<div class="empty">Todo consistente: no hay inconsistencias detectadas.</div>`;
  const orden={crit:0,warn:1,info:2};
  h+=`<div class="toolbar"><span class="chip"><b>${q.length}</b> tipos de problema</span><span class="chip"><b>${total}</b> casos</span><span class="muted" style="font-size:12.5px">Rojo: afecta la facturación · Amarillo: afecta métricas · Azul: informativo</span></div>`;
  const fila=x=>`<div class="row"><div class="grow"><b>${esc(x.l)}</b>${x.s?`<div class="muted">${esc(x.s)}</div>`:""}</div>${x.act?`<button class="btn sm" data-act="${x.act}" data-id="${esc(x.id)}">Abrir</button>`:""}</div>`;
  for(const x of sortBy(q,x=>orden[x.sev])){
    h+=`<section class="panel cal ${x.sev}"><div class="panel-head"><h2>${esc(x.t)}</h2><span class="pill ${x.sev}">${x.sev==="crit"?"Facturación":x.sev==="warn"?"Métricas":"Info"}</span></div><p class="muted" style="margin:0 0 8px">${esc(x.d)}</p>
      ${x.items.length?`<div class="list">${x.items.slice(0,6).map(fila).join("")}${x.items.length>6?`<details class="more"><summary>Ver ${x.items.length-6} más</summary>${x.items.slice(6).map(fila).join("")}</details>`:""}</div>`:""}</section>`;
  }
  return h;
}
// ---- Propuesta comercial / contrato por cliente (obligatorio para abrir búsquedas nuevas) ----
async function cargarCliDocs(){ try{ const rows=await api("/api/archivos-resumen?coleccion=clientes"); const m={}; rows.forEach(a=>(m[a.registroId] ||= []).push(a)); S.cliDocs=m; schedule(); }catch(e){} }
const cliRecId = nombre => { const k=keyN(nombre); const c=vals(S.clientes).find(x=>keyN(x.nombre)===k); return c?c.id:("cl-"+k.slice(0,40)); };
const docsCliente = nombre => (S.cliDocs||{})[cliRecId(nombre)]||[];
const tieneDoc = nombre => docsCliente(nombre).length>0;
const MSG_SIN_DOC = n => `${n} no tiene cargada la propuesta comercial ni el contrato. Subilo en la ficha del cliente (Clientes y leads) y después abrí la búsqueda.`;
function docPill(nombre,activo){ if(S.cliDocs==null) return ""; const d=docsCliente(nombre); return d.length?`<span class="pill ok">${esc(d[0].etiqueta||"Cargado")}</span>`:`<span class="pill ${activo?"crit":""}">Falta</span>`; }
function docsSection(nombre){
  const ds=(S.cliDocs||{})[cliRecId(nombre)]||[];
  const fila=a=>`<div class="row"><span class="pill ${a.etiqueta==="Contrato"?"ok":"info"}">${esc(a.etiqueta||"Documento")}</span><div class="grow"><a href="/api/archivos/${a.id}?ver=1" target="_blank" rel="noopener">${esc(a.nombre||"Documento")}</a><div class="muted" style="font-size:12px">${fd(String(a.fecha||"").slice(0,10))} · ${esc(authorName(a.usuarioId))}</div></div><a class="btn sm ghost" href="/api/archivos/${a.id}" download>Descargar</a><button class="btn sm ghost" data-act="cliDocDel" data-id="${a.id}">Quitar</button></div>`;
  return `<div class="section" id="cl-docs"><div class="panel-head"><span class="label">Propuesta comercial o contrato <span class="pill ${ds.length?"ok":"crit"} plain">${ds.length?"cargado":"obligatorio"}</span></span>
    <span style="display:flex;gap:6px;align-items:center"><select id="cl-doc-tipo" aria-label="Tipo de documento"><option>Contrato</option><option>Propuesta</option></select><label class="btn sm${ds.length?"":" lemon"}" style="cursor:pointer">Subir documento<input type="file" data-cliupload="${esc(nombre)}" hidden accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"></label></span></div>
    ${S.cliDocs==null?`<div class="muted" style="font-size:13px">Cargando…</div>`:ds.length?`<div class="list">${ds.map(fila).join("")}</div>`:`<div class="note">Todavía no hay propuesta ni contrato. Es obligatorio: sin este documento no se pueden abrir búsquedas nuevas para este cliente. PDF, Word o imagen, hasta 8 MB.</div>`}</div>`;
}
function refrescarDocs(){ const el=document.getElementById("cl-docs"); if(el){ const n=(document.getElementById("cl-nom")?.value||"").trim(); el.outerHTML=docsSection(n); } }
document.addEventListener("change",async e=>{ const el=e.target; if(!el.dataset||el.dataset.cliupload==null) return; const f=el.files&&el.files[0]; if(!f) return;
  if(f.size>8*1024*1024){ toast("El archivo supera los 8 MB.",true); el.value=""; return; }
  const nombre=(document.getElementById("cl-nom")?.value||"").trim()||el.dataset.cliupload; if(!nombre){ toast("Primero completá el nombre del cliente.",true); el.value=""; return; }
  const did=cliRecId(nombre);
  if(!S.clientes[did]&&!await write("clientes/"+did,{nombre,contactos:"",notas:"",origen:"",oportunidades:[]})){ el.value=""; return; }
  const etq=document.getElementById("cl-doc-tipo")?.value||"Contrato";
  const b64=await new Promise((ok,ko)=>{ const r=new FileReader(); r.onload=()=>ok(String(r.result).split(",")[1]); r.onerror=ko; r.readAsDataURL(f); });
  try{ toast("Subiendo…"); const r=await api("/api/archivos",{method:"POST",body:JSON.stringify({coleccion:"clientes",registroId:did,nombre:f.name,tipo:f.type,base64:b64})});
    await api(`/api/archivos/${encodeURIComponent(r.id)}/etiqueta`,{method:"PATCH",body:JSON.stringify({etiqueta:etq})}); await cargarCliDocs(); refrescarDocs(); toast(etq+" cargado"); }
  catch(err){ if(err.code!==401) toast(err.message||"No se pudo subir.",true); } el.value=""; });
function clienteCanonico(nombre){ const k=keyN(nombre); return clientNames().find(n=>keyN(n)===k)||null; }

// Al elegir la búsqueda en una factura, se completan cliente, recruiter y concepto (quedan vinculados).
document.addEventListener("change",e=>{ if(e.target.id!=="fc-bid") return; const b=S.busquedas[e.target.value]; if(!b) return;
  const set=(id,v)=>{ const el=document.getElementById(id); if(el&&v) el.value=v; }; set("fc-cli",b.cliente); set("fc-rec",b.recruiter); const c=document.getElementById("fc-con"); if(c&&!c.value) c.value=b.puesto; });

// ---------- boot ----------
async function boot(){
  try{ me=await api("/api/me"); }catch(e){ return; }
  isAdmin = me.rol==="socio"; isAdm = me.rol==="admin"; canFin = isAdmin||isAdm;
  $(".rail").hidden=false;
  route();
  await refreshAll();
  setInterval(()=>{ if(document.visibilityState==="visible") refreshAll(); },20000);
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") refreshAll(); });
}
boot();
