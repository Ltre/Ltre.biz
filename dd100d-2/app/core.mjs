// MarginPilot — pure, deterministic unit-economics engine. No dependencies and no network.
// Amounts are denominated in the merchant-selected single reporting currency.
// Percentage assumptions are deliberately editable, never represented as live marketplace rates.
export const DEFAULTS = Object.freeze({
  marketFee: 11, paymentFee: 2.9, paymentFixed: 0.3, fxLoss: 1.5,
  targetMargin: 15, stressAdPercent: 25, stressReturnPoints: 5, stressFxPoints: 2
});
export const SAMPLE = [
  {sku:"CANVAS-TOTE",name:"Canvas Weekend Tote",price:32,cogs:9.5,shipping:4.2,fulfillment:1.2,adCpa:5.5,returnRate:4,returnLoss:12,units:145},
  {sku:"DESK-LAMP",name:"Foldable Desk Light",price:49,cogs:22.5,shipping:8.3,fulfillment:1.7,adCpa:11,returnRate:11,returnLoss:27,units:83},
  {sku:"CERAMIC-MUG",name:"Ceramic Travel Mug",price:26,cogs:8.7,shipping:5.6,fulfillment:1.1,adCpa:5.6,returnRate:6,returnLoss:17,units:119},
  {sku:"LINEN-SET",name:"Linen Bedding Set",price:89,cogs:37,shipping:10.5,fulfillment:2.4,adCpa:13.2,returnRate:9,returnLoss:40,units:56},
  {sku:"PHONE-STAND",name:"Minimal Phone Stand",price:17,cogs:3.7,shipping:3.4,fulfillment:0.9,adCpa:3.1,returnRate:3,returnLoss:7,units:192},
  {sku:"WIRELESS-CHGR",name:"Compact Wireless Charger",price:34,cogs:16.2,shipping:4.7,fulfillment:1.3,adCpa:5.8,returnRate:12,returnLoss:20,units:78},
  {sku:"PET-MAT",name:"Washable Pet Mat",price:39,cogs:14.8,shipping:7.9,fulfillment:1.6,adCpa:5.9,returnRate:7,returnLoss:20,units:106},
  {sku:"POSTER-SET",name:"Art Print Set",price:22,cogs:5.2,shipping:3.1,fulfillment:0.9,adCpa:4.2,returnRate:3,returnLoss:9,units:121}
];
export function number(value, fallback=0, min=0, max=1000000000) {
  if(value === "" || value === null || value === undefined) return fallback;
  const n=Number(value);
  return Number.isFinite(n) && n>=min && n<=max ? n : fallback;
}
export function normalizeSettings(o={}) {
  const d={...DEFAULTS,...o};
  const pct=k=>number(d[k],DEFAULTS[k],0,100);
  return {
    marketFee:pct("marketFee"), paymentFee:pct("paymentFee"), paymentFixed:number(d.paymentFixed,DEFAULTS.paymentFixed),
    fxLoss:pct("fxLoss"), targetMargin:pct("targetMargin"),
    stressAdPercent:number(d.stressAdPercent,DEFAULTS.stressAdPercent,0,500),
    stressReturnPoints:pct("stressReturnPoints"), stressFxPoints:pct("stressFxPoints")
  };
}
export function normalizeSku(p={},index=0) {
  return {
    sku:String(p.sku||("SKU-"+(index+1))).trim().slice(0,80),
    name:String(p.name||p.sku||("Product "+(index+1))).trim().slice(0,160),
    price:number(p.price,0), cogs:number(p.cogs,0), shipping:number(p.shipping,0),
    fulfillment:number(p.fulfillment,0), adCpa:number(p.adCpa,0),
    returnRate:number(p.returnRate,0,0,100), returnLoss:number(p.returnLoss,0),
    units:Math.floor(number(p.units,0,0,10000000))
  };
}
const round=x=>Math.round((x+Number.EPSILON)*100)/100;
export function evaluate(input,options={},stress=false) {
  const s=normalizeSettings(options),p=normalizeSku(input);
  const adCpa=p.adCpa*(stress?1+s.stressAdPercent/100:1);
  const returnRate=Math.min(100,p.returnRate+(stress?s.stressReturnPoints:0));
  const fxLoss=Math.min(100,s.fxLoss+(stress?s.stressFxPoints:0));
  const percent=(s.marketFee+s.paymentFee+fxLoss)/100;
  const fixed=s.paymentFixed+p.cogs+p.shipping+p.fulfillment+adCpa+p.returnLoss*returnRate/100;
  const variable=p.price*percent;
  const profit=p.price*(1-percent)-fixed;
  const margin=p.price>0 ? profit/p.price*100 : 0;
  const denominator=1-percent;
  const breakEvenPrice=denominator>0 ? fixed/denominator : null;
  const breakEvenCpa=p.price*(1-percent)-(fixed-adCpa);
  const targetPrice=1-percent-s.targetMargin/100>0 ? fixed/(1-percent-s.targetMargin/100) : null;
  // CPA ceiling is theoretical: profit before advertising with other inputs held fixed.
  // ROI denominator includes all expenses including expected returns and sales-based fees.
  const spend=fixed+variable;
  const roi=spend>0?profit/spend*100:0;
  const state=profit<=0?"loss":margin<s.targetMargin?"watch":"healthy";
  return {
    ...p,stress,adCpaActual:round(adCpa),returnRateActual:round(returnRate),fxLossActual:round(fxLoss),
    feeCost:round(variable+s.paymentFixed),expectedReturnCost:round(p.returnLoss*returnRate/100),
    unitProfit:round(profit),margin:round(margin),roi:round(roi),monthlyProfit:round(profit*p.units),
    breakEvenPrice:breakEvenPrice===null?null:round(breakEvenPrice),
    targetPrice:targetPrice===null?null:round(targetPrice),
    maxCpa:round(breakEvenCpa),breakEvenRoas:breakEvenCpa>0?round(p.price/breakEvenCpa):null,
    state
  };
}
export function summarize(rows,settings,stress=false) {
  const analyses=rows.map(p=>evaluate(p,settings,stress));
  const monthlyNet=round(analyses.reduce((sum,r)=>sum+r.unitProfit*r.units,0));
  const monthlyRevenue=round(analyses.reduce((sum,r)=>sum+r.price*r.units,0));
  return {
    analyses, skuCount:analyses.length, totalUnits:analyses.reduce((n,r)=>n+r.units,0),
    lossCount:analyses.filter(r=>r.state==="loss").length,
    watchCount:analyses.filter(r=>r.state==="watch").length,
    healthyCount:analyses.filter(r=>r.state==="healthy").length,
    monthlyNet,monthlyRevenue,portfolioMargin:monthlyRevenue>0?round(monthlyNet/monthlyRevenue*100):0,
    monthlyAtRisk:round(analyses.filter(r=>r.state==="loss").reduce((sum,r)=>sum+r.monthlyProfit,0))
  };
}
export function csvRows(text,maxRows=5000) {
  if(typeof text!=="string"||text.length>2000000)throw Error("CSV must be under 2 MB.");
  const rows=[];let row=[],field="",quoted=false,afterQuote=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted) {
      if(c==='"'&&text[i+1]==='"'){field+='"';i++}
      else if(c==='"'){quoted=false;afterQuote=true}
      else field+=c;
    } else if(c==='"' && field===""){quoted=true;afterQuote=false}
    else if(c===","||c==="\n"||c==="\r"){
      if(c==="\r"&&text[i+1]==="\n")i++;
      row.push(field);field="";afterQuote=false;
      if(c!==","){if(row.some(x=>x.trim()!==""))rows.push(row);row=[];if(rows.length>maxRows+1)throw Error("CSV row limit: "+maxRows)}
    } else if(afterQuote&&c===" "){continue}
    else if(afterQuote)throw Error("Malformed CSV: text after a closing quote.");
    else field+=c;
  }
  if(quoted)throw Error("Malformed CSV: unterminated quoted field.");
  row.push(field);
  if(row.some(x=>x.trim()!==""))rows.push(row);
  if(rows.length>maxRows+1)throw Error("CSV row limit: "+maxRows);
  return rows;
}
const ALIASES = {
  sku:["sku","id","item_id","itemid","product_id"],
  name:["name","product","product_name","title"],
  price:["price","selling_price","sale_price","revenue","unit_price"],
  cogs:["cogs","cost","product_cost","unit_cost","purchase_cost"],
  shipping:["shipping","shipping_cost","ship_cost"],
  fulfillment:["fulfillment","fulfilment","fulfillment_cost","packing"],
  adCpa:["ad_cpa","ads","ad_cost","cost_per_acquisition","marketing_cost"],
  returnRate:["return_rate","returns_percent","return_pct","return_percentage"],
  returnLoss:["return_loss","loss_per_return","return_cost"],
  units:["units","monthly_units","volume","qty","quantity"]
};
const numericKeys=["price","cogs","shipping","fulfillment","adCpa","returnRate","returnLoss","units"];
function strictlyParseNumber(s,row,name){
  if(s===undefined||String(s).trim()==="")return undefined;
  const n=Number(String(s).trim());
  if(!Number.isFinite(n)||n<0||n>1000000000||(name==="returnRate"&&n>100)||(name==="units"&&!Number.isInteger(n)))throw Error("Row "+row+": invalid "+name);
  return n;
}
export function importCsv(text) {
  const rows=csvRows(text);
  if(rows.length<2)throw Error("CSV requires a header and at least one product.");
  const header=rows[0].map(x=>x.replace(/^\ufeff/,"").trim().toLowerCase().replace(/[ -]/g,"_"));
  const fields=Object.fromEntries(Object.entries(ALIASES).map(([key,names])=>[key,header.findIndex(h=>names.includes(h))]));
  if(fields.price<0||fields.cogs<0)throw Error("CSV must have price and cogs (or cost) columns.");
  const used=new Set();
  return rows.slice(1).map((row,i)=>{
    if(row.length>header.length)throw Error("Row "+(i+2)+": too many columns.");
    const r={};
    for(const [name,index] of Object.entries(fields)){
      if(index<0)continue;
      const raw=row[index];
      if(numericKeys.includes(name))r[name]=strictlyParseNumber(raw,i+2,name);
      else if(raw!==undefined)r[name]=raw;
    }
    const item=normalizeSku(r,i);
    if(item.price<=0)throw Error("Row "+(i+2)+": price must be greater than zero.");
    const id=item.sku.toLowerCase();
    if(used.has(id))throw Error("Duplicate SKU: "+item.sku);
    used.add(id);
    return item;
  });
}
export function csvEscape(value) {
  let s=String(value??"");
  // Prevent spreadsheet formula execution, including leading whitespace.
  if(/^[\s]*[=+@\-]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
export function exportCsv(items) {
  const keys=["sku","name","price","cogs","shipping","fulfillment","adCpa","returnRate","returnLoss","units"];
  return "\ufeff"+keys.join(",")+"\r\n"+items.map(x=>keys.map(k=>csvEscape(x[k])).join(",")).join("\r\n");
}
