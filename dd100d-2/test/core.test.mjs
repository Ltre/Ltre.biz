import {test} from "node:test";
import assert from "node:assert/strict";
import {evaluate,summarize,importCsv,exportCsv,csvRows,normalizeSettings,SAMPLE} from "../app/core.mjs";

test("basic unit economics and break-even",()=>{
  const x=evaluate({sku:"A",price:100,cogs:40,shipping:10,fulfillment:0,adCpa:10,returnRate:0,returnLoss:0,units:30},
    {marketFee:10,paymentFee:0,paymentFixed:0,fxLoss:0,targetMargin:20});
  assert.equal(x.unitProfit,30);assert.equal(x.margin,30);
  assert.equal(x.breakEvenPrice,66.67);assert.equal(x.maxCpa,40);
  assert.equal(x.monthlyProfit,900);assert.equal(x.state,"healthy");
});
test("stressed return, advertising and FX change net margin",()=>{
  const p={sku:"A",price:100,cogs:40,shipping:10,fulfillment:0,adCpa:10,returnRate:5,returnLoss:40,units:3};
  const s={marketFee:10,paymentFee:0,paymentFixed:0,fxLoss:0,targetMargin:20,stressAdPercent:100,stressReturnPoints:10,stressFxPoints:5};
  const base=evaluate(p,s),stress=evaluate(p,s,true);
  assert.equal(base.unitProfit,28);assert.equal(stress.unitProfit,9);
  assert.equal(stress.returnRateActual,15);assert.equal(stress.adCpaActual,20);assert.equal(stress.fxLossActual,5);
  assert.equal(stress.state,"watch");
});
test("negative margin is marked as loss",()=>{
  const x=evaluate({sku:"L",price:10,cogs:13,units:5},{marketFee:0,paymentFee:0,paymentFixed:0,fxLoss:0});
  assert.equal(x.unitProfit,-3);assert.equal(x.state,"loss");assert.equal(x.monthlyProfit,-15);
});
test("no valid break-even when combined percent fees >= 100",()=>{
  const x=evaluate({sku:"A",price:100,cogs:50},{marketFee:90,paymentFee:10,fxLoss:5,paymentFixed:0});
  assert.equal(x.breakEvenPrice,null);assert.equal(x.targetPrice,null);
});
test("summarize weights by unit volume",()=>{
  const s=summarize([{sku:"P",price:20,cogs:10,units:100},{sku:"L",price:20,cogs:25,units:10}],
    {marketFee:0,paymentFee:0,paymentFixed:0,fxLoss:0,targetMargin:10});
  assert.equal(s.monthlyNet,950);assert.equal(s.monthlyRevenue,2200);
  assert.equal(s.portfolioMargin,43.18);assert.equal(s.lossCount,1);assert.equal(s.monthlyAtRisk,-50);
});
test("CSV parser handles multiline quoted names, BOM and escaped quotes",()=>{
  const r=importCsv('\ufeffSKU,Name,price,cogs,units\r\nABC,"Cool, ""smart""\ncase",25,12,14\r\nB,Second,45,20,2\r\n');
  assert.equal(r.length,2);assert.equal(r[0].name,'Cool, "smart"\ncase');assert.equal(r[1].units,2);
});
test("CSV import refuses duplicate SKU, missing columns and invalid figures",()=>{
  assert.throws(()=>importCsv("sku,price,cogs\na,10,1\na,20,2"),/Duplicate/);
  assert.throws(()=>importCsv("sku,name\na,test"),/price and cogs/);
  assert.throws(()=>importCsv("sku,price,cogs\na,abc,12"),/invalid price/);
  assert.throws(()=>importCsv("sku,price,cogs,units\na,10,2,-10"),/invalid units/);
});
test("Spreadsheet export protects against CSV formula injection",()=>{
  const output=exportCsv([{sku:"=1+2",name:"@bad",price:50,cogs:20}]);
  assert.ok(output.includes('"\'=1+2"'));
  assert.ok(output.includes('"\'@bad"'));
});
test("CSV parser rejects unterminated quote",()=>{
  assert.throws(()=>csvRows('a,b\n"missing,quote'),/unterminated/);
});
test("sample portfolio is valid and nonempty",()=>{
  const s=summarize(SAMPLE,normalizeSettings());
  assert.equal(s.skuCount,8);assert.ok(s.monthlyRevenue>0);
});
