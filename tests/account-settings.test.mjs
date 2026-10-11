import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {betterAuth} from 'better-auth';
import test from 'node:test';
import {createMorrowAuth} from '../lib/auth-config.ts';
import {createAccountSettings} from '../lib/account-settings.ts';

function fixture(t,{realPassword=false}={}) {
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 t.after(()=>sqlite.close());
 const db={exec:async sql=>sqlite.exec(sql),prepare(sql){let values=[];return {bind(...args){values=args;return this;},async all(){const results=sqlite.prepare(sql).all(...values);const meta=sqlite.prepare('SELECT changes() AS changes').get();return {results,meta,success:true};},async first(){return sqlite.prepare(sql).get(...values)||null;},async run(){return this.all();}};},async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.all());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const env={DB:db,BETTER_AUTH_URL:'http://localhost:3001',BETTER_AUTH_SECRET:'morrow-account-test-secret-32-characters',RESEND_API_KEY:'test-only',MORROW_EMAIL_FROM:'Morrow <auth@example.test>'};
 const emails=[];let fail=false;
 const fetcher=async(_,request)=>{if(fail)return Response.json({}, {status:503});const value=JSON.parse(request.body);emails.push({...value,code:value.text.match(/code is (\d{6})/)[1]});return Response.json({id:crypto.randomUUID()});};
 const configured=createMorrowAuth(env,fetcher);
 const hash=async password=>createHash('sha256').update(password).digest('hex');
 const auth=realPassword?configured:betterAuth({...configured.options,emailAndPassword:{...configured.options.emailAndPassword,password:{hash,verify:async({hash:stored,password})=>stored===await hash(password)}}});
 const handle=createAccountSettings(env,auth,fetcher);
 const last=email=>emails.findLast(message=>message.to[0]===email);
 let counter=0;
 function client(email=`person-${++counter}@example.test`,password='Original-password-123') {
  const cookies=new Map();
  const headers=()=>({Origin:'http://localhost:3001','Content-Type':'application/json','cf-connecting-ip':`192.0.2.${counter+10}`,Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')});
  async function call(path,body) {
   const response=await auth.handler(new Request('http://localhost:3001/api/auth'+path,{method:body===undefined?'GET':'POST',headers:headers(),...(body===undefined?{}:{body:JSON.stringify(body)})}));
   for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('='),key=pair.slice(0,i),value=pair.slice(i+1);if(!value||/max-age=0/i.test(cookie))cookies.delete(key);else cookies.set(key,value);}
   const bodyResult=await response.json().catch(()=>null);return {status:response.status,body:bodyResult};
  }
  async function account(body,overrides={}) {
   const response=await handle(new Request('http://localhost:3001/api/account',{method:'POST',headers:{...headers(),...overrides},body:typeof body==='string'?body:JSON.stringify(body)}));
   return {status:response.status,body:await response.json()};
  }
  async function register(){assert.equal((await call('/sign-up/email',{email,password,name:'Test Person'})).status,200);assert.equal((await call('/email-otp/verify-email',{email,password,otp:last(email).code})).status,200);}
  async function login(){assert.equal((await call('/sign-in/email',{email,password})).body.twoFactorRedirect,true);assert.equal((await call('/two-factor/send-otp',{})).status,200);assert.equal((await call('/two-factor/verify-otp',{code:last(email).code})).status,200);}
  return {cookies,call,account,register,login,email,password};
 }
 const age=id=>sqlite.prepare('UPDATE account_change_challenges SET last_sent_at=? WHERE id=?').run(Date.now()-61_000,id);
 const clearAuthRate=()=>sqlite.exec("DELETE FROM auth_rate_limits WHERE key NOT LIKE 'account-%'");
 return {sqlite,emails,last,client,age,clearAuthRate,failProvider:value=>{fail=value;}};
}
const wrong=code=>code==='000000'?'111111':'000000';

test('name changes save without a code or an email and validate input',async t=>{
 const f=fixture(t),c=f.client();await c.register();const before=f.emails.length;
 assert.equal((await c.account({action:'update-name',name:'  New Name  '})).status,200);
 assert.equal((await c.call('/get-session')).body.user.name,'New Name');assert.equal(f.emails.length,before);
 for(const name of ['', 'a'.repeat(101), 'Bad\u0000Name'])assert.equal((await c.account({action:'update-name',name})).status,400);
 assert.equal((await c.account({action:'update-name',name:'X'},{Origin:'https://evil.example'})).status,403);
 assert.equal((await c.account({action:'update-name',name:'X'},{Origin:''})).status,403);
 assert.equal((await c.account({action:'update-name',name:'X'},{'Content-Type':'text/plain'})).status,415);
 assert.equal((await f.client().account({action:'update-name',name:'X'})).status,401);
 assert.equal((await c.account('{bad json')).status,400);
 assert.equal((await c.account({action:'update-name',name:'x'.repeat(5000)})).status,400);
});

test('password change requires its code, rejects replay, and revokes other sessions and pending logins',async t=>{
 const f=fixture(t),c=f.client();await c.register();
 const second=f.client(c.email,c.password);await second.login();
 const pending=f.client(c.email,c.password);assert.equal((await pending.call('/sign-in/email',{email:c.email,password:c.password})).status,200);
 await pending.call('/two-factor/send-otp',{});const pendingCode=f.last(c.email).code;
 const request=await c.account({action:'request-code',purpose:'password'});assert.equal(request.status,200);const id=request.body.challenge.id,code=f.last(c.email).code;
 assert.match(code,/^\d{6}$/);assert.ok(!f.sqlite.prepare('SELECT code_hash FROM account_change_challenges').get().code_hash.includes(code));
 const body={action:'change-password',challengeId:id,newPassword:'Replacement-password-123',code};
 assert.equal((await c.account({...body,code:wrong(code)})).status,400);
 assert.equal((await c.account({...body,newPassword:'short'})).status,400);
 assert.equal((await c.account(body)).status,200);
 assert.equal((await c.account(body)).status,400);
 assert.ok((await c.call('/get-session')).body);assert.equal((await second.call('/get-session')).body,null);
 assert.notEqual((await pending.call('/two-factor/verify-otp',{code:pendingCode})).status,200);
 f.clearAuthRate();const login=f.client(c.email);
 assert.notEqual((await login.call('/sign-in/email',{email:c.email,password:c.password})).status,200);
 const next=await login.call('/sign-in/email',{email:c.email,password:body.newPassword});assert.equal(next.body.twoFactorRedirect,true);
 assert.equal((await login.call('/get-session')).body,null);await login.call('/two-factor/send-otp',{});
 assert.equal((await login.call('/two-factor/verify-otp',{code:f.last(c.email).code})).status,200);
});

test('email changes need separate old and new proofs and never change the address early',async t=>{
 const f=fixture(t),c=f.client();await c.register();const newEmail='new-address@example.test';
 const result=await c.account({action:'request-code',purpose:'email',newEmail});assert.equal(result.status,200);const id=result.body.challenge.id,oldCode=f.last(c.email).code;
 assert.equal((await c.call('/get-session')).body.user.email,c.email);assert.equal(f.last(newEmail),undefined);
 assert.equal((await c.account({action:'confirm-new-email',challengeId:id,code:oldCode})).status,400);
 assert.equal((await c.account({action:'change-password',challengeId:id,code:oldCode,newPassword:'Another-password-123'})).status,400);
 const proof=await c.account({action:'verify-current-email',challengeId:id,code:oldCode});assert.equal(proof.status,200);assert.equal(proof.body.challenge.stage,'new-email');
 const newCode=f.last(newEmail).code;
 assert.equal((await c.call('/get-session')).body.user.email,c.email);
 assert.equal((await c.account({action:'verify-current-email',challengeId:id,code:oldCode})).status,400);
 assert.equal((await c.account({action:'confirm-new-email',challengeId:id,code:wrong(newCode)})).status,400);
 assert.equal((await c.account({action:'confirm-new-email',challengeId:id,code:newCode,newEmail:'injected@example.test'})).status,200);
 const session=(await c.call('/get-session')).body;assert.equal(session.user.email,newEmail);assert.equal(session.user.emailVerified,true);assert.equal(session.user.twoFactorEnabled,true);
 assert.equal((await c.account({action:'confirm-new-email',challengeId:id,code:newCode})).status,400);
 await c.call('/sign-out',{});f.clearAuthRate();
 assert.notEqual((await c.call('/sign-in/email',{email:c.email,password:c.password})).status,200);
 assert.equal((await c.call('/sign-in/email',{email:newEmail,password:c.password})).body.twoFactorRedirect,true);
 await c.call('/two-factor/send-otp',{});assert.equal(f.emails.at(-1).to[0],newEmail);
 assert.equal((await c.call('/two-factor/verify-otp',{code:f.last(newEmail).code})).status,200);
});

test('codes are bound to the user and originating session',async t=>{
 const f=fixture(t),c=f.client();await c.register();const other=f.client();await other.register();const second=f.client(c.email,c.password);await second.login();
 const r=await c.account({action:'request-code',purpose:'password'});const body={action:'change-password',challengeId:r.body.challenge.id,code:f.last(c.email).code,newPassword:'Replacement-password-123'};
 assert.equal((await other.account(body)).status,400);assert.equal((await second.account(body)).status,400);
 assert.equal((await c.account(body)).status,200);
 assert.ok((await other.call('/get-session')).body);
});

test('expiry and the five-attempt limit are enforced, including resends',async t=>{
 const f=fixture(t),c=f.client();await c.register();const r=await c.account({action:'request-code',purpose:'password'}),id=r.body.challenge.id,code=f.last(c.email).code;
 f.sqlite.prepare('UPDATE account_change_challenges SET expires_at=? WHERE id=?').run(Date.now()-1,id);
 const body={action:'change-password',challengeId:id,code,newPassword:'Replacement-password-123'};
 assert.equal((await c.account(body)).status,400);f.age(id);assert.equal((await c.account({action:'resend-code',challengeId:id})).status,200);const fresh=f.last(c.email).code;
 for(let i=0;i<5;i++)assert.equal((await c.account({...body,code:wrong(fresh)})).status,400);
 assert.equal((await c.account({...body,code:fresh})).status,400);f.age(id);
 assert.equal((await c.account({action:'resend-code',challengeId:id})).status,400);
});

test('resend has a cooldown, replaces the old code and keeps failures counted',async t=>{
 const f=fixture(t),c=f.client();await c.register();const r=await c.account({action:'request-code',purpose:'password'}),id=r.body.challenge.id,old=f.last(c.email).code;
 assert.equal((await c.account({action:'resend-code',challengeId:id})).status,429);
 assert.equal((await c.account({action:'request-code',purpose:'password'})).status,429);
 const body={action:'change-password',challengeId:id,newPassword:'Replacement-password-123'};
 await c.account({...body,code:wrong(old)});f.age(id);
 assert.equal((await c.account({action:'resend-code',challengeId:id})).status,200);
 assert.equal(f.sqlite.prepare('SELECT attempts FROM account_change_challenges').get().attempts,1);
 assert.equal((await c.account({...body,code:old})).status,400);
 assert.equal((await c.account({...body,code:f.last(c.email).code})).status,200);
});

test('delivery failures cannot approve changes and both stages recover with resend',async t=>{
 const f=fixture(t),c=f.client();await c.register();f.failProvider(true);
 const r=await c.account({action:'request-code',purpose:'email',newEmail:'new@example.test'});assert.equal(r.status,503);let id=r.body.challenge.id;
 assert.equal(f.sqlite.prepare('SELECT ready FROM account_change_challenges').get().ready,0);
 assert.equal((await c.call('/get-session')).body.user.email,c.email);
 f.failProvider(false);f.age(id);assert.equal((await c.account({action:'resend-code',challengeId:id})).status,200);
 const oldCode=f.last(c.email).code;f.failProvider(true);
 const newStage=await c.account({action:'verify-current-email',challengeId:id,code:oldCode});assert.equal(newStage.status,503);assert.equal(newStage.body.challenge.stage,'new-email');
 assert.equal((await c.call('/get-session')).body.user.email,c.email);
 assert.equal((await c.account({action:'verify-current-email',challengeId:id,code:oldCode})).status,400);
 f.failProvider(false);f.age(id);assert.equal((await c.account({action:'resend-code',challengeId:id})).status,200);
 assert.equal((await c.account({action:'confirm-new-email',challengeId:id,code:f.last('new@example.test').code})).status,200);
});

test('duplicate-email races roll back approval and session revocation atomically',async t=>{
 const f=fixture(t),c=f.client();await c.register();const second=f.client(c.email,c.password);await second.login();
 const newEmail='taken@example.test',r=await c.account({action:'request-code',purpose:'email',newEmail}),id=r.body.challenge.id;
 await c.account({action:'verify-current-email',challengeId:id,code:f.last(c.email).code});const code=f.last(newEmail).code;
 const other=f.client(newEmail);await other.register();
 assert.equal((await c.account({action:'confirm-new-email',challengeId:id,code})).status,409);
 assert.equal((await c.call('/get-session')).body.user.email,c.email);assert.ok((await second.call('/get-session')).body);
 assert.equal(f.sqlite.prepare('SELECT claim_token FROM account_change_challenges WHERE id=?').get(id).claim_token,null);
});

test('concurrent successful code submissions consume exactly one approval',async t=>{
 const f=fixture(t),c=f.client();await c.register();const r=await c.account({action:'request-code',purpose:'password'});
 const body={action:'change-password',challengeId:r.body.challenge.id,code:f.last(c.email).code,newPassword:'Replacement-password-123'};
 const responses=await Promise.all([c.account(body),c.account(body)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,400]);
});

test('replacement challenges, cancellation and rate limits prevent code reuse and unlimited mail',async t=>{
 const f=fixture(t),c=f.client();await c.register();let r=await c.account({action:'request-code',purpose:'password'});const oldId=r.body.challenge.id,oldCode=f.last(c.email).code;f.age(oldId);
 r=await c.account({action:'request-code',purpose:'password'});const id=r.body.challenge.id;
 assert.equal((await c.account({action:'change-password',challengeId:oldId,code:oldCode,newPassword:'Replacement-password-123'})).status,400);
 assert.equal((await c.account({action:'cancel-change',challengeId:id})).status,200);
 assert.equal((await c.account({action:'change-password',challengeId:id,code:f.last(c.email).code,newPassword:'Replacement-password-123'})).status,400);
 for(let i=0;i<8;i++){r=await c.account({action:'request-code',purpose:'password'});assert.equal(r.status,200);f.age(r.body.challenge.id);}
 assert.equal((await c.account({action:'request-code',purpose:'password'})).status,429);
});

test('default auth mutations cannot bypass account-code requirements',async t=>{
 const f=fixture(t),c=f.client();await c.register();
 for(const path of ['/change-password','/set-password','/change-email','/email-otp/change-email','/email-otp/request-email-change','/update-user','/request-password-reset','/reset-password','/forget-password','/email-otp/reset-password']) {
  assert.equal((await c.call(path,{name:'Bypass',newEmail:'bypass@example.test',currentPassword:c.password,newPassword:'Bypass-password-123',email:c.email})).status,404,path);
 }
 assert.equal((await c.call('/get-session')).body.user.name,'Test Person');
});

test('email validation rejects invalid, unchanged and occupied addresses without sending mail',async t=>{
 const f=fixture(t),c=f.client();await c.register();const other=f.client();await other.register();const count=f.emails.length;
 for(const newEmail of ['invalid','bad address@example.test',c.email,'x'.repeat(255)+'@example.test'])assert.equal((await c.account({action:'request-code',purpose:'email',newEmail})).status,400);
 assert.equal((await c.account({action:'request-code',purpose:'email',newEmail:other.email.toUpperCase()})).status,409);
 assert.equal(f.emails.length,count);
});

test('new-email expiry and resend require a fresh new-address code',async t=>{
 const f=fixture(t),c=f.client();await c.register();const r=await c.account({action:'request-code',purpose:'email',newEmail:'new@example.test'}),id=r.body.challenge.id;
 await c.account({action:'verify-current-email',challengeId:id,code:f.last(c.email).code});const old=f.last('new@example.test').code;
 f.sqlite.prepare('UPDATE account_change_challenges SET expires_at=? WHERE id=?').run(Date.now()-1,id);
 assert.equal((await c.account({action:'confirm-new-email',challengeId:id,code:old})).status,400);
 f.age(id);await c.account({action:'resend-code',challengeId:id});assert.equal(f.emails.at(-1).to[0],'new@example.test');
 assert.equal((await c.account({action:'confirm-new-email',challengeId:id,code:old})).status,400);
 assert.equal((await c.account({action:'confirm-new-email',challengeId:id,code:f.last('new@example.test').code})).status,200);
});

test('database failures roll back password updates, code consumption and session revocation',async t=>{
 const f=fixture(t),c=f.client();await c.register();const other=f.client(c.email,c.password);await other.login();
 const r=await c.account({action:'request-code',purpose:'password'}),id=r.body.challenge.id;
 const body={action:'change-password',challengeId:id,code:f.last(c.email).code,newPassword:'Replacement-password-123'};
 const previous=f.sqlite.prepare('SELECT password FROM accounts').get().password;
 f.sqlite.exec("CREATE TRIGGER account_write_failure BEFORE UPDATE OF password ON accounts BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
 assert.equal((await c.account(body)).status,500);assert.equal(f.sqlite.prepare('SELECT password FROM accounts').get().password,previous);
 assert.ok((await other.call('/get-session')).body);assert.equal(f.sqlite.prepare('SELECT claim_token FROM account_change_challenges').get().claim_token,null);
 f.sqlite.exec('DROP TRIGGER account_write_failure');assert.equal((await c.account(body)).status,200);
});

test('concurrent code requests send only one email and revoked sessions cannot finish a change',async t=>{
 const f=fixture(t),c=f.client();await c.register();const count=f.emails.length;
 const results=await Promise.all([c.account({action:'request-code',purpose:'password'}),c.account({action:'request-code',purpose:'password'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,429]);assert.equal(f.emails.length,count+1);
 const challenge=results.find(r=>r.status===200).body.challenge;
 f.sqlite.exec('DELETE FROM sessions');assert.equal((await c.account({action:'change-password',challengeId:challenge.id,code:f.last(c.email).code,newPassword:'Replacement-password-123'})).status,401);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS count FROM account_change_challenges').get().count,0);
});

test('production password hashing remains compatible with subsequent logins',async t=>{
 const f=fixture(t,{realPassword:true}),c=f.client();await c.register();const r=await c.account({action:'request-code',purpose:'password'}),newPassword='New-production-password-123';
 assert.equal((await c.account({action:'change-password',challengeId:r.body.challenge.id,code:f.last(c.email).code,newPassword})).status,200);
 await c.call('/sign-out',{});f.clearAuthRate();assert.equal((await c.call('/sign-in/email',{email:c.email,password:newPassword})).body.twoFactorRedirect,true);
});
