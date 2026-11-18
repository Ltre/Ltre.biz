import {SAMPLE,DEFAULTS,normalizeSettings,normalizeSku,evaluate,summarize,importCsv,exportCsv} from "./core.mjs";
const KEY="marginpilot:workspace:v1";
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const escapeHTML=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let data=SAMPLE.map((p,i)=>normalizeSku(p,i));
let settings=normalizeSettings(DEFAULTS);
let stress=false,filter="all",query="",currency="USD",demo=true,editing=-1,toastTimer;
function load(){
  try{
    const parsed=JSON.parse(localStorage.getItem(KEY)||"null");
    if(!parsed||parsed.version!==1)return;
    if(Array.isArray(parsed.items)&&parsed.items.length<=5000)data=parsed.items.map((x,i)=>normalizeSku(x,i));
    settings=normalizeSettings(parsed.settings||DEFAULTS);
    if(["USD","EUR","SGD","JPY","THB","CNY"].includes(parsed.currency))currency=parsed.currency;
    demo=parsed.demo===true;
  }catch(error){console.warn("Could not read saved workspace:",error)}
}
function save(){
  try{
    localStorage.setItem(KEY,JSON.stringify({version:1,items:data,settings,currency,demo}));
  }catch(error){toast("Storage was full or blocked — changes work until this tab closes. Export a CSV backup.")}
}
function toast(message){
  const el=$("#toast");el.textContent=message;el.classList.add("visible");
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("visible"),4300);
}
function money(x){
  const abs=Math.abs(x);
  try{return new Intl.NumberFormat("en-US",{style:"currency",currency,maximumFractionDigits:currency==="JPY"?0:2}).format(x)}
  catch{return (x<0?"-":"")+abs.toFixed(2)+" "+currency}
}
function percent(x){return (Number.isFinite(x)?x:0).toFixed(1)+"%"}
function mode(next){
  stress=Boolean(next);
  $("#baseMode").classList.toggle("selected",!stress);
  $("#stressMode").classList.toggle("selected",stress);
  $("#baseMode").setAttribute("aria-pressed",String(!stress));
  $("#stressMode").setAttribute("aria-pressed",String(stress));
  render();
}
function metric(label,value,foot,accent,icon){
  return '<article class="metric-card'+(accent?' highlight':'')+'"><div class="metric-title"><span>'+escapeHTML(label)+'</span><span class="metric-icon">'+icon+'</span></div><div class="metric-value">'+escapeHTML(value)+'</div><div class="metric-foot">'+escapeHTML(foot)+'</div></article>';
}
function render(){
  $("#currency").value=currency;
  $("#demoBanner").hidden=!demo;
  const total=summarize(data,settings,stress);
  const base=summarize(data,settings,false);
  const delta=total.monthlyNet-base.monthlyNet;
  $("#metricCards").innerHTML=
    metric("Monthly contribution",money(total.monthlyNet),stress?("Scenario difference: "+money(delta)):"Based on entered monthly unit volumes",true,"↗")+
    metric("Weighted portfolio margin",percent(total.portfolioMargin),"Revenue-weighted, not a simple average",false,"◉")+
    metric("SKUs losing money",String(total.lossCount),"Of "+total.skuCount+" SKUs · contribution ≤ 0",false,"⚠")+
    metric("Negative monthly impact",money(total.monthlyAtRisk),"Sum of negative SKU contributions",false,"⌁");
  const ordered=[...total.analyses].sort((a,b)=>a.monthlyProfit-b.monthlyProfit);
  const filtered=ordered.filter(x=>(filter==="all"||x.state===filter)&&[x.name,x.sku].join(" ").toLowerCase().includes(query));
  $("#allCount").textContent=String(data.length);
  $("#skuRows").innerHTML=filtered.map(row=>{
    const index=data.findIndex((p)=>p.sku===row.sku);
    const tone=row.unitProfit<=0?"num-negative":"num-positive";
    const length=Math.max(0,Math.min(100,Math.abs(row.margin)));
    return '<tr data-index="'+index+'" tabindex="0" title="Edit this SKU">'+
      '<td><span class="sku-name">'+escapeHTML(row.name)+'</span><span class="sku-id">'+escapeHTML(row.sku)+'</span></td>'+
      '<td>'+escapeHTML(money(row.price))+'</td>'+
      '<td class="'+tone+'">'+escapeHTML(money(row.unitProfit))+'</td>'+
      '<td><strong>'+escapeHTML(percent(row.margin))+'</strong><div class="bar-track"><div class="bar-fill'+(row.margin<0?' negative':'')+'" style="width:'+length+'%"></div></div></td>'+
      '<td class="'+(row.monthlyProfit<0?'num-negative':'num-positive')+'">'+escapeHTML(money(row.monthlyProfit))+'</td>'+
      '<td><span class="badge '+row.state+'">'+(row.state==="loss"?"LOSS":row.state==="watch"?"WATCH":"HEALTHY")+'</span></td><td class="edit-arrow">↗</td></tr>';
  }).join("");
  $("#rowInfo").textContent=filtered.length+" shown · "+data.length+" total";
  $("#emptyState").hidden=filtered.length>0;
  const issues=ordered.filter(x=>x.state!=="healthy").slice(0,3);
  const signalRows=issues.map(x=>{
    const headline=x.state==="loss"?"Negative contribution":"Below target margin";
    const detail=x.state==="loss"?money(x.monthlyProfit)+"/month · "+percent(x.margin):percent(x.margin)+" margin vs "+percent(settings.targetMargin)+" goal";
    return '<div class="signal"><span class="signal-icon '+x.state+'">'+(x.state==="loss"?"!":"⌁")+'</span><div><strong>'+escapeHTML(x.sku)+' · '+escapeHTML(headline)+'</strong><p>'+escapeHTML(detail)+'</p></div></div>';
  }).join("");
  $("#priorityList").innerHTML=issues.length?signalRows:'<div class="signal"><span class="signal-icon healthy">✓</span><div><strong>No SKU below target</strong><p>Under the current assumptions, all products pass. Check your inputs regularly.</p></div></div>';
  $$(".filters button").forEach(el=>{
    const selected=el.dataset.filter===filter;
    el.classList.toggle("chosen",selected);
    el.setAttribute("aria-pressed",String(selected));
  });
  $("#tryStress").textContent=stress?"Return to baseline →":"Run stress scenario →";
}
function openProduct(index){
  editing=index;
  const p=index===-1?normalizeSku({sku:"",name:"",price:29,cogs:8,shipping:4,fulfillment:1,adCpa:4,returnRate:5,returnLoss:12,units:100},data.length):data[index];
  $("#dialogTitle").textContent=index===-1?"Add a SKU":"Edit "+p.sku;
  for(const input of $("#editForm").querySelectorAll("[name]")){
    input.value=index===-1&&["sku","name"].includes(input.name)?"":String(p[input.name]??"");
  }
  $("#editError").textContent="";
  $("#deleteSku").hidden=index===-1;
  $("#editDialog").showModal();
}
function openSettings(){
  for(const input of $("#settingsForm").querySelectorAll("[name]"))input.value=String(settings[input.name]??"");
  $("#settingsError").textContent="";
  $("#settingsDialog").showModal();
}
load();
render();
$("#baseMode").addEventListener("click",()=>mode(false));
$("#stressMode").addEventListener("click",()=>mode(true));
$("#tryStress").addEventListener("click",()=>mode(!stress));
$("#search").addEventListener("input",e=>{query=e.target.value.trim().toLowerCase();render()});
$$(".filters button").forEach(el=>el.addEventListener("click",()=>{filter=el.dataset.filter;render()}));
$("#currency").addEventListener("change",e=>{currency=e.target.value;save();render();toast("Currency label changed only. Convert all input amounts yourself before comparing.")});
$("#importButton").addEventListener("click",()=>$("#csvInput").click());
$("#csvInput").addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    if(file.size>2000000)throw Error("CSV exceeds 2 MB.");
    const incoming=importCsv(await file.text());
    if(!confirm("Replace all "+data.length+" current products with "+incoming.length+" imported products? Export your existing data first if needed."))return;
    data=incoming;demo=false;filter="all";query="";$("#search").value="";save();render();
    toast("Imported "+incoming.length+" products locally. No file was uploaded.");
  }catch(error){toast("CSV import failed: "+error.message)}
  finally{e.target.value=""}
});
$("#exportButton").addEventListener("click",()=>{
  if(data.length===0){toast("No products to export.");return}
  const blob=new Blob([exportCsv(data)],{type:"text/csv;charset=utf-8"});
  const u=URL.createObjectURL(blob),anchor=document.createElement("a");
  anchor.href=u;anchor.download="marginpilot-products.csv";document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(u),1500);
  toast("Exported your products and assumptions per SKU. Global fees are not included.");
});
$("#resetSample").addEventListener("click",()=>{
  if(!confirm("Replace current workspace with sample products?"))return;
  data=SAMPLE.map((x,i)=>normalizeSku(x,i));demo=true;settings=normalizeSettings(DEFAULTS);stress=false;save();mode(false);toast("Sample restored.");
});
$("#addButton").addEventListener("click",()=>openProduct(-1));
$("#skuRows").addEventListener("click",e=>{const tr=e.target.closest("tr[data-index]");if(tr)openProduct(Number(tr.dataset.index))});
$("#skuRows").addEventListener("keydown",e=>{if(e.key==="Enter"){const tr=e.target.closest("tr[data-index]");if(tr)openProduct(Number(tr.dataset.index))}});
$("#closeDialog").addEventListener("click",()=>$("#editDialog").close());
$("#cancelDialog").addEventListener("click",()=>$("#editDialog").close());
$("#editForm").addEventListener("submit",e=>{
  e.preventDefault();
  const fd=new FormData(e.target),obj={};
  for(const [key,value] of fd.entries())obj[key]=value;
  for(const key of ["price","cogs","shipping","fulfillment","adCpa","returnRate","returnLoss","units"]){
    const value=Number(obj[key]);
    if(!Number.isFinite(value)||value<0||value>1000000000||(key==="returnRate"&&value>100)||(key==="units"&&!Number.isInteger(value))){$("#editError").textContent="Invalid "+key;return}
  }
  if(Number(obj.price)<=0){$("#editError").textContent="Selling price must be positive.";return}
  const normalized=normalizeSku(obj,editing>=0?editing:data.length);
  if(!normalized.sku||!normalized.name){$("#editError").textContent="SKU and product name are required.";return}
  if(data.some((x,i)=>i!==editing&&x.sku.toLowerCase()===normalized.sku.toLowerCase())){$("#editError").textContent="SKU must be unique.";return}
  if(editing<0){if(data.length>=5000){$("#editError").textContent="Maximum 5000 SKUs.";return}data.push(normalized)}
  else data[editing]=normalized;
  demo=false;save();render();$("#editDialog").close();toast("SKU saved on this device.");
});
$("#deleteSku").addEventListener("click",()=>{
  if(editing<0||!confirm("Delete "+data[editing].sku+"?"))return;
  data.splice(editing,1);demo=false;save();render();$("#editDialog").close();toast("SKU deleted.");
});
$("#settingsButton").addEventListener("click",openSettings);
$("#closeSettings").addEventListener("click",()=>$("#settingsDialog").close());
$("#cancelSettings").addEventListener("click",()=>$("#settingsDialog").close());
$("#settingsForm").addEventListener("submit",e=>{
  e.preventDefault();const obj=Object.fromEntries(new FormData(e.target));
  for(const [key,raw] of Object.entries(obj)){
    const n=Number(raw),max=key==="stressAdPercent"?500:key==="paymentFixed"?1000000000:100;
    if(!Number.isFinite(n)||n<0||n>max){$("#settingsError").textContent="Invalid setting: "+key;return}
    obj[key]=n;
  }
  settings=normalizeSettings(obj);save();render();$("#settingsDialog").close();toast("Assumptions updated.");
});
$("#clearData").addEventListener("click",()=>{
  if(!confirm("Permanently erase local MarginPilot data, including all products and settings?"))return;
  try{localStorage.removeItem(KEY)}catch{}
  data=[];settings=normalizeSettings(DEFAULTS);demo=false;stress=false;render();toast("Local workspace erased.");
});
if("serviceWorker" in navigator && (location.protocol==="https:"||location.hostname==="localhost")){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
