"use strict";
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const sample = {
  source:"Fictional demo",url:"https://sample-store.example/",scannedAt:null,
  title:"Thoughtfully made essentials | Sample Store",description:"Quality products.",
  h1:["A better everyday"],canonical:"",lang:"en",viewport:true,images:12,missingAlt:3,jsonld:true,robots:"index,follow",
  checks:null
};
function checksFor(d){
  return [
    {name:"HTML document",ok:d.document!==false,detail:"Document markup can be analyzed."},
    {name:"Page title",ok:d.title.length>=15&&d.title.length<=65,detail:d.title ? `${d.title.length} characters — ${d.title}` : "Missing title tag"},
    {name:"Meta description",ok:d.description.length>=70&&d.description.length<=170,detail:d.description ? `${d.description.length} characters; suggested heuristic 70–170` : "Missing description"},
    {name:"H1 heading",ok:d.h1.length===1,detail:`${d.h1.length} headings found`},
    {name:"Canonical link",ok:!!d.canonical,detail:d.canonical || "No rel=canonical link found"},
    {name:"Document language",ok:!!d.lang,detail:d.lang || "Missing html lang attribute"},
    {name:"Mobile viewport",ok:d.viewport,detail:d.viewport?"Viewport meta found":"No viewport meta tag"},
    {name:"Image alt attributes",ok:d.missingAlt===0,detail:`${d.missingAlt} of ${d.images} images missing alt`},
    {name:"Structured data",ok:d.jsonld,detail:d.jsonld?"JSON-LD script detected":"No JSON-LD markup found"},
    {name:"Indexing meta",ok:!d.robots.toLowerCase().includes("noindex"),detail:d.robots || "No page-level noindex directive found (HTTP headers not checked)"}
  ];
}
function analyze(markup,url="Local HTML source"){
  if(typeof markup!=="string"||markup.trim().length<15||!/<\s*(?:!doctype|html|head|body|title|h1|div|main|section|meta|p|article|img)\b/i.test(markup))throw Error("Please provide an HTML document or meaningful HTML snippet.");
  if(markup.length>1000000)throw Error("Document too large. Maximum preview size: 1 MB.");
  const doc=new DOMParser().parseFromString(markup,"text/html");
  const meta=name=>doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() || "";
  const images=[...doc.images],robots=meta("robots");
  const d={source:"Browser-local analysis",url,title:doc.title?.trim()||"",description:meta("description"),h1:[...doc.querySelectorAll("h1")].map(x=>x.textContent.trim()),canonical:doc.querySelector('link[rel~="canonical"]')?.getAttribute("href")?.trim()||"",lang:doc.documentElement.getAttribute("lang")||"",viewport:!!doc.querySelector('meta[name="viewport"]'),images:images.length,missingAlt:images.filter(x=>!x.hasAttribute("alt")).length,jsonld:!!doc.querySelector('script[type="application/ld+json"]'),robots,document:true,scannedAt:new Date().toISOString()};
  d.checks=checksFor(d);
  d.score=d.checks.filter(c=>c.ok).length*10;
  return d;
}
const sampleReport={...sample,document:true,checks:checksFor(sample)};
sampleReport.score=sampleReport.checks.filter(x=>x.ok).length*10;
function render(result,mount){
  const items=result.checks.map(c=>`<div class="result-check"><span class="result-bullet ${c.ok?"pass":"warn"}">${c.ok?"✓":"!"}</span><div><strong>${esc(c.name)}</strong><code>${esc(c.detail)}</code></div><strong class="${c.ok?"pass-text":"warn-text"}">${c.ok?"PASS":"REVIEW"}</strong></div>`).join("");
  const grade=result.score>=90?"Looking strong":result.score>=70?"Good foundation":"Several opportunities";
  mount.innerHTML=`<div class="result-summary"><div class="result-number">${result.score}<small>/100</small></div><div class="result-label">${grade}<p>${result.checks.filter(c=>c.ok).length} passing · ${result.checks.filter(c=>!c.ok).length} to review · 10 checks</p></div></div><div class="results-list">${items}</div>`;
}
function showToast(message){
  const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove("show"),5200);
}
function exportResult(report){
  const data=new Blob([JSON.stringify(report,null,2)],{type:"application/json;charset=utf-8"});
  const url=URL.createObjectURL(data),a=document.createElement("a");
  a.href=url;a.download="sitesignal-audit.json";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function setTab(name){
  const mapping={demo:["Example report","#demoPanel"],html:["Analyze HTML","#htmlPanel"],url:["Live URL check","#urlPanel"]};
  if(!mapping[name])return;
  $$(".side-tab").forEach(t=>{const active=t.dataset.tab===name;t.classList.toggle("active",active);t.setAttribute("aria-pressed",String(active))});
  for(const [key,config] of Object.entries(mapping))$(config[1]).classList.toggle("hidden",key!==name);
  $("#viewTitle").textContent=mapping[name][0];
}
render(sampleReport,$("#demoReport"));
$$(".side-tab").forEach(t=>t.addEventListener("click",()=>setTab(t.dataset.tab)));
$("#downloadDemo").addEventListener("click",()=>exportResult(sampleReport));
$("#analyzeHtml").addEventListener("click",()=>{
  try{const result=analyze($("#htmlInput").value);render(result,$("#htmlReport"));$("#htmlStatus").textContent=`Analyzed ${result.checks.length} signals at ${new Date().toLocaleTimeString()}. Results reflect source markup only.`;showToast("Analysis complete — no content was uploaded.")}catch(e){$("#htmlStatus").textContent=e.message;$("#htmlReport").replaceChildren()}
});
$("#htmlFile").addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;
  if(file.size>1000000){showToast("Maximum HTML file size is 1 MB.");return}
  $("#htmlInput").value=await file.text();
  $("#htmlStatus").textContent=`Loaded ${file.name} — click Analyze document.`;
});
$("#urlForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const mount=$("#urlReport"),msg=$("#urlMessage"),btn=$("#scanUrl");
  mount.replaceChildren();btn.disabled=true;msg.textContent="Trying to fetch the page using browser CORS rules…";
  try{
    const raw=$("#urlInput").value,url=new URL(raw);
    if(url.protocol!=="https:")throw Error("Only HTTPS URLs are supported in the preview.");
    const response=await fetch(url.toString(),{credentials:"omit",mode:"cors",headers:{"accept":"text/html"}});
    if(!response.ok)throw Error(`HTTP ${response.status}. The page could not be read.`);
    if(!(response.headers.get("content-type")||"").toLowerCase().includes("text/html"))throw Error("The address did not return HTML.");
    const contentLength=Number(response.headers.get("content-length")||0);
    if(contentLength>1000000)throw Error("Page is larger than 1 MB.");
    const reader=response.body?.getReader();if(!reader)throw Error("Page body unavailable.");
    const decoder=new TextDecoder();let content="",total=0;
    try{while(true){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.length;if(total>1000000)throw Error("Page is larger than 1 MB.");content+=decoder.decode(chunk.value,{stream:true});}content+=decoder.decode()}finally{reader.releaseLock()}
    const result=analyze(content,url.href);render(result,mount);msg.textContent="Page fetched successfully. Source-only checks; no server-side tests or HTTP robots headers.";
  }catch(error){msg.textContent=`Unable to complete browser scan: ${error.message} Most public sites block cross-origin browser reads. You can still use Analyze HTML with View Source.`}
  finally{btn.disabled=false}
});
$("#checkoutButton").addEventListener("click",()=>showToast("Checkout is intentionally disabled in this Pages preview. No payment details are requested."));
$("#mobileToggle").addEventListener("click",()=>{const nav=$(".site-header nav"),expanded=nav.classList.toggle("is-open");$("#mobileToggle").setAttribute("aria-expanded",String(expanded))});
$$(".site-header nav a").forEach(a=>a.addEventListener("click",()=>{$(".site-header nav").classList.remove("is-open");$("#mobileToggle").setAttribute("aria-expanded","false")}));
