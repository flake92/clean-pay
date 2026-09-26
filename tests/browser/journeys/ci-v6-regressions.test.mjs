// These are deterministic unit/fixture regressions, NOT an application/browser proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { chatwootProviderExpectedEffects } from './chatwoot-provider-ledger-order.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
function sourceModule(relative) {
  const url = new URL(relative, import.meta.url);
  const compiled = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    fileName: fileURLToPath(url), reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const exports = {};
  runInNewContext(compiled.outputText, {exports, require: createRequire(url)}, {timeout: 5000});
  return exports;
}
const {projectExactMergeChatwootGeneratedPair: merge, projectExactJourneyGeneratedValues: generated} =
  sourceModule('../journey-comparison-projection.ts');
const {assertSyntheticCaddyRouteOrder, syntheticChatwootSdkSource} = sourceModule('./caddy-route-policy.ts');
const caddy = readFileSync(new URL('./Caddyfile', import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.parse(JSON.stringify(value));
const itemDigest = (value,bytes) => ({bytes,sha256:digest(value)});
function fixture(side) {
  return {schemaVersion:2, baselineCommit:'f5cb6f543d85256e7733a1ade6a4f451d86cf378',
    project:'journey-1440x900',journey:'email-account-links-and-merges-telegram',
    source:{fixtureContract:{version:'journey-v5',sha256:'a'.repeat(64)}},
    checkpoints:['link-account-merge-confirmation','link-account-merged-cabinet'].map((label,index)=>({
      label,cookies:[
        {name:'cw_conversation',value:itemDigest(side,25),domain:'<app-host>',path:'/',httpOnly:false,secure:true,sameSite:'Lax'},
        {name:'cw_user_'+digest('website-token'),value:itemDigest('synthetic-chatwoot-user',23),domain:'<app-host>',path:'/',httpOnly:false,secure:true,sameSite:'Lax'}],
      storage:{local:[{key:'clean-pay:chatwoot-ownership:v1',value:itemDigest(side+index,86)}],
        session:[],cacheNames:[],serviceWorkerScopes:[]}})),
    boundaries:[{label:'telegram-account-merge',value:{confirmed:true,dryRunCount:2,mergeCount:1,redirectPath:'/cabinet'}}],
    providerEffects:{entries:[{effect:'users_merge_dry_run'},{effect:'users_merge_dry_run'},{effect:'users_merged'}]},
  };
}
test('v6 merge generated identifiers compare equal with unchanged equality graph',()=>{
  const a=fixture('a'),b=fixture('b');merge(a,b);assert.deepEqual(a,b);
});
test('v6 merge supports each declared viewport',()=>{
  for(const project of ['journey-1440x900','journey-390x844','journey-768x1024']) {
    const a=fixture('a'),b=fixture('b');a.project=b.project=project;merge(a,b);assert.deepEqual(a,b);
  }
});
for(const [name, mutate] of [
  ['secure flag',b=>{b.checkpoints[0].cookies[0].secure=false;}],
  ['cookie domain',b=>{b.checkpoints[0].cookies[0].domain='other';}],
  ['cookie path',b=>{b.checkpoints[0].cookies[0].path='/other';}],
  ['cookie size',b=>{b.checkpoints[0].cookies[0].value.bytes=26;}],
  ['duplicate conversation',b=>{b.checkpoints[0].cookies.push(json(b.checkpoints[0].cookies[0]));}],
  ['rotation between checkpoints',b=>{b.checkpoints[1].cookies[0].value.sha256=digest('rotated');}],
  ['identity credential change',b=>{b.checkpoints[0].cookies[1].value.sha256=digest('wrong-user');}],
  ['ownership equality change',b=>{b.checkpoints[1].storage.local[0].value=b.checkpoints[0].storage.local[0].value;}],
  ['unexpected storage',b=>{b.checkpoints[0].storage.local.push({key:'unapproved',value:itemDigest('other',86)});}],
  ['different journey',b=>{b.journey='telegram-webapp-browser-boundary';}],
  ['missing checkpoint',b=>{b.checkpoints.pop();}],
  ['missing successful merge',b=>{b.providerEffects.entries.pop();}],
  ['false merge boundary',b=>{b.boundaries[0].value.confirmed=false;}],
]) test('v6 merge refuses '+name,()=>{
  const a=fixture('a'),b=fixture('b');mutate(b);const aa=json(a),bb=json(b);
  merge(a,b);assert.deepEqual(a,aa);assert.deepEqual(b,bb);assert.notDeepEqual(a,b);
});
test('v6 unrelated provider changes remain visible after merge normalization',()=>{
  const a=fixture('a'),b=fixture('b');b.providerEffects.entries[0].credential='wrong';merge(a,b);assert.notDeepEqual(a,b);
});
function receipt(side,path='/auth/telegram/callback') {
  const m=fixture(side);m.checkpoints.forEach(c=>{c.cookies=[{name:'clean_pay_tg_callback_receipt',
    domain:'<app-host>',httpOnly:true,secure:true,sameSite:'Lax',path,value:itemDigest(side,326)}];c.storage.local=[];});return m;
}
test('v6 callback receipt uses its real restricted cookie path',()=>{
  const a=receipt('a'),b=receipt('b');generated(a);generated(b);assert.deepEqual(a,b);
});
test('v6 callback receipt never normalizes an incorrect path or flags',()=>{
  for(const mutate of [c=>c.path='/',c=>c.httpOnly=false,c=>c.secure=false,c=>c.sameSite='None']){
    const a=receipt('a');mutate(a.checkpoints[0].cookies[0]);const hash=a.checkpoints[0].cookies[0].value.sha256;
    generated(a);assert.equal(a.checkpoints[0].cookies[0].value.sha256,hash);
  }
});
test('v6 callback receipt preserves rotation, size and presence',()=>{
  const a=receipt('a'),b=receipt('b');b.checkpoints[1].cookies[0].value.sha256=digest('rotation');
  generated(a);generated(b);assert.notDeepEqual(a,b);
});

function sdkFixture({mode,pathname='/cabinet',owned=false,replacement=false}={}) {
  const listeners=[], microtasks=[], delivered=[]; let frame;
  class Frame {style={};contentWindow={postMessage:(message,origin)=>delivered.push({message:json(message),origin})};}
  const document={cookie:owned?'cw_conversation=owned':'',createElement:()=>new Frame(),
    getElementById:()=>frame,body:{appendChild:value=>{frame=value;}}};
  const window={__cleanPayChatwootFixtureReadiness:'eager',__cleanPayChatwootFixtureConfirmation:mode,
    dispatchEvent(){}};
  const origin='https://chatwoot.browser.clean-pay.dev';
  const context={window,document,location:{pathname},URL,HTMLIFrameElement:Frame,CustomEvent:class {},
    localStorage:{getItem:key=>owned&&key==='clean-pay:chatwoot-ownership:v1'?'stored':null},
    queueMicrotask:fn=>microtasks.push(fn),addEventListener:(_,fn)=>listeners.push(fn)};
  runInNewContext(syntheticChatwootSdkSource(caddy),context,{timeout:5000});
  window.chatwootSDK.run({baseUrl:origin,websiteToken:digest('token')});
  if(replacement)frame.src+='&cw_conversation=owned';
  const emit=(message,source=frame.contentWindow,messageOrigin=origin)=>{
    for(const fn of listeners)fn({source,origin:messageOrigin,data:'chatwoot-widget:'+JSON.stringify(message)});
    while(microtasks.length)microtasks.shift()();
  };
  return {window,delivered,emit,frame,origin};
}
for(const [name,options,fast] of [
  ['ordinary SDK keeps original timing',{},false],
  ['initial profile proves ownership',{mode:'phase-proof',pathname:'/profile'},false],
  ['initial owned cabinet remains delayed',{mode:'phase-proof',owned:true},false],
  ['replacement cabinet requests full acknowledgement',{mode:'phase-proof',owned:true,replacement:true},true],
  ['recreated cabinet requests full acknowledgement',{mode:'phase-proof'},true],
  ['near-miss mode cannot change timing',{mode:'phase-prooF',replacement:true},false],
])test('v6 fixture '+name,()=>{
  const s=sdkFixture(options);s.window.$chatwoot.setUser('c'+'a'.repeat(24),{});
  assert.equal(s.delivered.length,0);s.emit({event:'loaded'});assert.equal(s.delivered.length,1);
  assert.equal(s.delivered[0].message.confirmBeforeProbe===true,fast);
  assert.equal(s.delivered[0].origin,s.origin);
});
test('v6 stale frame or foreign origin cannot load or confirm SDK identity',()=>{
  const s=sdkFixture({mode:'phase-proof'});s.window.$chatwoot.setUser('c'+'a'.repeat(24),{});
  s.emit({event:'loaded'},{});s.emit({event:'loaded'},s.frame.contentWindow,'https://wrong.invalid');
  assert.equal(s.delivered.length,0);s.emit({event:'loaded'});
  const ack={event:'setAuthCookie',data:{deliveryId:s.delivered[0].message.deliveryId}};
  s.emit(ack,{});s.emit(ack,s.frame.contentWindow,'https://wrong.invalid');
  assert.equal(s.window.__cleanPayChatwootBoundaryCalls.filter(c=>c.method==='identity.confirmed').length,0);
  s.emit(ack);assert.equal(s.window.__cleanPayChatwootBoundaryCalls.filter(c=>c.method==='identity.confirmed').length,1);
  s.emit(ack);assert.equal(s.window.__cleanPayChatwootBoundaryCalls.filter(c=>c.method==='identity.confirmed').length,1);
});
function widgetFixture(){
  const emitted=[],timers=[],listeners=[];
  const parent={postMessage:(message,origin)=>emitted.push({message:JSON.parse(message.slice('chatwoot-widget:'.length)),origin})};
  const source=caddy.slice(caddy.indexOf('    respond @widget `')).split('<script>')[1].split('</script>')[0];
  runInNewContext(source,{parent,addEventListener:(_,fn)=>listeners.push(fn),setTimeout:(fn,delay)=>timers.push({fn,delay})},{timeout:5000});
  const emit=(data,source=parent,origin='https://pay.ci.clean-pay.dev')=>listeners.forEach(fn=>fn({data,source,origin}));
  return{emitted,timers,parent,emit};
}
test('v6 widget maintains original delay unless the boolean flag is exact',()=>{
  const w=widgetFixture();for(const flag of [undefined,false,'true',true])w.emit({method:'identify',deliveryId:1,confirmBeforeProbe:flag});
  assert.deepEqual(w.timers.map(t=>t.delay),[1200,1200,1200,0]);w.timers.at(-1).fn();
  assert.equal(w.emitted.at(-1).message.data.deliveryId,1);
});
test('v6 widget rejects foreign parent, origin and invalid delivery',()=>{
  const w=widgetFixture();w.emit({method:'identify',deliveryId:1,confirmBeforeProbe:true},{});
  w.emit({method:'identify',deliveryId:1,confirmBeforeProbe:true},w.parent,'https://wrong.invalid');
  for(const deliveryId of [0,-1,1.5,'1',null])w.emit({method:'identify',deliveryId,confirmBeforeProbe:true});
  assert.equal(w.timers.length,0);assert.equal(w.emitted.length,1);
});
test('v6 fixture source still passes exact routing and frame correlation policy',()=>{
  assert.equal(assertSyntheticCaddyRouteOrder(caddy).chatwootIdentityDelivery.confirmation,'matching-current-frame-delivery');
});
test('v6 phase provider counts and schema agree, without weakening final acknowledgement',()=>{
  const schema=JSON.parse(readFileSync(new URL('./chatwoot-phase-proof.schema.json',import.meta.url),'utf8'));
  for(const [phase,count] of [['gap',28],['stable',28],['recreated',42]]){
    const effects=chatwootProviderExpectedEffects(phase);assert.equal(effects.length,count);
    assert.equal(effects.filter(e=>e==='contact_identity_probed').length,2);
  }
  const text=JSON.stringify(schema);assert.ok(text.includes('"contactProbeCount":{"const":2}'));
  const capture=readFileSync(new URL('./chatwoot-phase-browser-capture.ts',import.meta.url),'utf8');
  assert.ok(capture.includes('await waitForPhaseState(page, null);'));
});
