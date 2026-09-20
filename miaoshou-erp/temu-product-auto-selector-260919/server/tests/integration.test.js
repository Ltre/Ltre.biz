import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import worker from '../src/index.js';

class D1Prepared {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { const p = new D1Prepared(this.db, this.sql); p.args = args; return p; }
  async first() { return this.db.prepare(this.sql).get(...this.args) || null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
  }
}
class D1Mock {
  constructor(schema) { this.db = new DatabaseSync(':memory:'); this.db.exec(schema); }
  prepare(sql) { return new D1Prepared(this.db, sql); }
  async batch(stmts) { const out = []; this.db.exec('BEGIN'); try { for (const s of stmts) out.push(await s.run()); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
}
class R2Mock {
  constructor(){ this.map = new Map(); }
  async put(k,v){ this.map.set(k, typeof v === 'string' ? v : String(v)); }
  async get(k){ const v=this.map.get(k); return v==null?null:{ text: async()=>v }; }
  async delete(k){ this.map.delete(k); }
}

async function call(env, path, init={}) {
  const r = await worker.fetch(new Request(`http://local.test${path}`, { ...init, headers: { 'content-type':'application/json', ...(init.headers||{}) } }), env);
  const text = await r.text(); let data={}; try{data=JSON.parse(text)}catch{data={text}};
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(data)}`);
  return data;
}

test('full auth -> model permission -> inference -> usage flow', async () => {
  const schema = fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
  const env = {
    DB: new D1Mock(schema), AUDIT_BUCKET: new R2Mock(),
    AI: { async run(model, input) { return { response: input?.messages?.[0]?.content === 'Reply with OK only.' ? 'OK' : 'relay-ok', usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }; } },
    DEV_MODE:'true', WECHAT_DELIVERY:'mock', STORE_AI_PAYLOADS:'1', SESSION_TTL_DAYS:'30', OTP_TTL_MINUTES:'5', ALLOWED_ORIGINS:'*',
    ADMIN_TOKEN:'admin-test-token', LOGIN_CODE_SECRET:'otp-secret', UPSTREAM_MASTER_KEY:Buffer.alloc(32,5).toString('base64')
  };

  const phone='15911111111';
  assert.equal((await call(env,'/api/dev/register',{method:'POST',body:JSON.stringify({phone})})).ok,true);
  const requested=await call(env,'/api/auth/request-code',{method:'POST',body:JSON.stringify({phone})});
  assert.match(requested.delivery.dev_code,/^\d{6}$/);
  const login=await call(env,'/api/auth/verify-code',{method:'POST',body:JSON.stringify({phone,code:requested.delivery.dev_code})});
  assert.ok(login.token.startsWith('air_'));

  const adminHeaders={'x-admin-token':'admin-test-token'};
  const ch=await call(env,'/api/admin/channels',{method:'POST',headers:adminHeaders,body:JSON.stringify({name:'Workers AI',slug:'cf',protocol:'workers_ai'})});
  assert.ok(ch.id>0);
  const modelId='@cf/meta/llama-3.2-3b-instruct';
  const model=await call(env,`/api/admin/channels/${ch.id}/models`,{method:'POST',headers:adminHeaders,body:JSON.stringify({model_id:modelId,display_name:'CF Llama',capabilities:{vision:false},input_cost_per_million:0.1,output_cost_per_million:0.2})});
  const users=await call(env,'/api/admin/users',{headers:adminHeaders});
  const uid=users.users.find(x=>x.phone===phone).id;
  await call(env,`/api/admin/users/${uid}/permissions`,{method:'PUT',headers:adminHeaders,body:JSON.stringify({model_ids:[model.id]})});

  const auth={authorization:`Bearer ${login.token}`};
  const list=await call(env,'/api/models',{headers:auth});
  assert.equal(list.channels[0].id,'cf');
  assert.equal(list.channels[0].models[0].id,`cf/${modelId}`);

  const completion=await call(env,'/v1/chat/completions',{method:'POST',headers:auth,body:JSON.stringify({model:`cf/${modelId}`,messages:[{role:'user',content:'hello'}]})});
  assert.equal(completion.choices[0].message.content,'relay-ok');
  assert.equal(completion.model,`cf/${modelId}`);

  const usage=await call(env,'/api/admin/usage',{headers:adminHeaders});
  assert.equal(usage.rows.length,1);
  assert.equal(Number(usage.rows[0].calls),1);
  assert.equal(Number(usage.rows[0].total_tokens),15);

  const diag=await call(env,'/api/admin/diagnostics',{method:'POST',headers:adminHeaders,body:'{}'});
  assert.equal(diag.diagnostics.d1.ok,true);
  assert.equal(diag.diagnostics.r2.ok,true);
  assert.equal(diag.diagnostics.workers_ai.ok,true);
});

test('admin can edit/toggle/delete models and channel delete is guarded by usage', async () => {
  const schema = fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');
  const env = {
    DB: new D1Mock(schema), AUDIT_BUCKET: new R2Mock(),
    AI: { async run() { return { response: 'ok', usage: {} }; } },
    DEV_MODE:'true', WECHAT_DELIVERY:'mock', STORE_AI_PAYLOADS:'0', SESSION_TTL_DAYS:'30', OTP_TTL_MINUTES:'5', ALLOWED_ORIGINS:'*',
    ADMIN_TOKEN:'admin-test-token', LOGIN_CODE_SECRET:'otp-secret', UPSTREAM_MASTER_KEY:Buffer.alloc(32,5).toString('base64')
  };
  const h = { 'x-admin-token': 'admin-test-token' };

  const ch = await call(env, '/api/admin/channels', { method:'POST', headers:h, body: JSON.stringify({ name:'Test', slug:'test', protocol:'workers_ai' }) });
  assert.ok(ch.id > 0);
  const m = await call(env, `/api/admin/channels/${ch.id}/models`, { method:'POST', headers:h, body: JSON.stringify({ model_id:'@cf/test/model', display_name:'GPT X', capabilities:{ vision:true }, input_cost_per_million:0.1, output_cost_per_million:0.2 }) });
  const m2 = await call(env, `/api/admin/channels/${ch.id}/models`, { method:'POST', headers:h, body: JSON.stringify({ model_id:'@cf/test/model-2', display_name:'GPT Y' }) });

  // 编辑模型（改名/停用/去掉视觉）
  await call(env, `/api/admin/models/${m.id}`, { method:'PATCH', headers:h, body: JSON.stringify({ display_name:'GPT X2', enabled:false, capabilities:{ vision:false } }) });
  let list = await call(env, '/api/admin/channels', { headers:h });
  let mm = list.channels.find(c=>c.id===ch.id).models.find(x=>x.id===m.id);
  assert.equal(mm.display_name,'GPT X2');
  assert.equal(mm.enabled,0);
  assert.equal(mm.capabilities.vision,false);

  // 停用后用户不可见/不可调用
  const phone='15922222222';
  await call(env,'/api/dev/register',{method:'POST',body:JSON.stringify({phone})});
  const req=await call(env,'/api/auth/request-code',{method:'POST',body:JSON.stringify({phone})});
  const login=await call(env,'/api/auth/verify-code',{method:'POST',body:JSON.stringify({phone,code:req.delivery.dev_code})});
  const users=await call(env,'/api/admin/users',{headers:h});
  const uid=users.users.find(x=>x.phone===phone).id;
  await call(env,`/api/admin/users/${uid}/permissions`,{method:'PUT',headers:h,body:JSON.stringify({model_ids:[m.id]})});
  const userList=await call(env,'/api/models',{headers:{authorization:`Bearer ${login.token}`}});
  assert.equal((userList.channels||[]).length,0,'disabled model must not appear for users');

  // 重新启用后可调用
  await call(env, `/api/admin/models/${m.id}`, { method:'PATCH', headers:h, body: JSON.stringify({ enabled:true }) });
  await call(env,'/v1/chat/completions',{method:'POST',headers:{authorization:`Bearer ${login.token}`},body:JSON.stringify({model:'test/@cf/test/model',messages:[{role:'user',content:'hi'}]})});

  // 有调用记录的渠道不能删除
  let blocked=false;
  try { await call(env, `/api/admin/channels/${ch.id}`, { method:'DELETE', headers:h }); } catch (e) { blocked = /409/.test(String(e.message)); }
  assert.ok(blocked,'channel with usage must not be deletable');

  // 有调用记录的模型不能删除
  let blockedModel=false;
  try { await call(env, `/api/admin/models/${m.id}`, { method:'DELETE', headers:h }); } catch (e) { blockedModel = /409/.test(String(e.message)); }
  assert.ok(blockedModel,'model with usage must not be deletable');

  // 无调用记录的模型可删除，删除后从渠道与用户模型列表移除
  await call(env, `/api/admin/models/${m2.id}`, { method:'DELETE', headers:h });
  list = await call(env, '/api/admin/channels', { headers:h });
  assert.equal(list.channels.find(c=>c.id===ch.id).models.length,1);
  assert.equal(list.channels.find(c=>c.id===ch.id).models[0].id,m.id);
  const userList2=await call(env,'/api/models',{headers:{authorization:`Bearer ${login.token}`}});
  assert.equal((userList2.channels||[]).length,1,'remaining enabled model must still be visible');
  assert.equal(userList2.channels[0].models[0].id,'test/@cf/test/model');

  // 删除不存在的模型/渠道返回 404
  let nf=false;
  try { await call(env, '/api/admin/models/9999', { method:'DELETE', headers:h }); } catch (e) { nf = /404/.test(String(e.message)); }
  assert.ok(nf,'deleting a missing model must 404');
});
