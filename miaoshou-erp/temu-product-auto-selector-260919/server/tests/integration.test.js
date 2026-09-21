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
  const migrationsDir = new URL('../migrations/', import.meta.url);
  const schema = fs.readdirSync(migrationsDir).filter(x=>x.endsWith('.sql')).sort().map(x=>fs.readFileSync(new URL(x,migrationsDir),'utf8')).join('\n');
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
  assert.equal(requested.dev_code, requested.delivery.dev_code);
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

  await call(env,`/api/admin/models/${model.id}`,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({display_name:'CF Llama edited',enabled:false,capabilities:{vision:true}})});
  let listed=await call(env,'/api/models',{headers:auth});
  assert.equal(listed.channels.length,0,'停用模型后客户端不应继续看到');
  await call(env,`/api/admin/models/${model.id}`,{method:'PATCH',headers:adminHeaders,body:JSON.stringify({enabled:true})});
  listed=await call(env,'/api/models',{headers:auth});
  assert.equal(listed.channels[0].models[0].name,'CF Llama edited');
  assert.equal(listed.channels[0].models[0].capabilities.vision,true);

  await call(env,`/api/admin/models/${model.id}`,{method:'DELETE',headers:adminHeaders});
  listed=await call(env,'/api/models',{headers:auth});
  assert.equal(listed.channels.length,0,'删除模型后客户端不应继续看到');
  const usageAfterDelete=await call(env,'/api/admin/usage',{headers:adminHeaders});
  assert.equal(usageAfterDelete.rows.length,1,'删除模型不应删除历史用量');
  const usersAfterDelete=await call(env,'/api/admin/users',{headers:adminHeaders});
  assert.deepEqual(usersAfterDelete.users.find(x=>x.phone===phone).model_ids,[],'删除模型时应清理用户授权');

  const diag=await call(env,'/api/admin/diagnostics',{method:'POST',headers:adminHeaders,body:'{}'});
  assert.equal(diag.diagnostics.d1.ok,true);
  assert.equal(diag.diagnostics.r2.ok,true);
  assert.equal(diag.diagnostics.workers_ai.ok,true);
});

test('DEV mock OTP is returned even when R2 audit write fails', async () => {
  const migrationsDir = new URL('../migrations/', import.meta.url);
  const schema = fs.readdirSync(migrationsDir).filter(x=>x.endsWith('.sql')).sort().map(x=>fs.readFileSync(new URL(x,migrationsDir),'utf8')).join('\n');
  const env = {
    DB: new D1Mock(schema),
    AUDIT_BUCKET: { async put(){ throw new Error('R2 unavailable'); } },
    DEV_MODE:'true', WECHAT_DELIVERY:'mock', STORE_AI_PAYLOADS:'0', SESSION_TTL_DAYS:'30', OTP_TTL_MINUTES:'5', ALLOWED_ORIGINS:'*',
    ADMIN_TOKEN:'admin-test-token', LOGIN_CODE_SECRET:'otp-secret', UPSTREAM_MASTER_KEY:Buffer.alloc(32,7).toString('base64')
  };
  const phone='15922222222';
  await call(env,'/api/dev/register',{method:'POST',body:JSON.stringify({phone})});
  const requested=await call(env,'/api/auth/request-code',{method:'POST',body:JSON.stringify({phone})});
  assert.match(requested.dev_code,/^\d{6}$/);
  assert.equal(requested.dev_code,requested.delivery.dev_code);
});
