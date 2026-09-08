import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createInitialChatwootBootstrap, isInitialChatwootContextResponse } from "./chatwoot-initial-bootstrap.mjs";
import { canonicalSimpleInlineStyle as canonical, projectPairedJourneyInlineStyles as project } from "../journey-inline-style-pair.mjs";

export function createCiV10Cases(fixtureDirectory) {
  assert.ok(path.isAbsolute(fixtureDirectory), "Explicit absolute fixture directory is required");
  const caddy = readFileSync(path.join(fixtureDirectory, "Caddyfile"), "utf8");
  const widget = /respond @widget `([\s\S]*?)` 200/.exec(caddy)[1].match(/<script>([\s\S]*?)<\/script>/)[1];
  const sdk = /respond @sdk `([\s\S]*?)` 200/.exec(caddy.slice(caddy.indexOf("https://chatwoot.browser")))[1];
  const cases = [], add = (name, run) => cases.push({ name: "v10 " + name, run });
  const widgetCase = () => {
    const sent=[], timers=[], listeners=[];
    const parent={postMessage:(data,origin)=>sent.push({data,origin})};
    runInNewContext(widget,{parent,addEventListener:(_name,fn)=>listeners.push(fn),setTimeout:(fn,delay)=>timers.push({fn,delay})},{timeout:1000});
    return {sent,timers,parent,emit:(data,source=parent,origin="https://pay.ci.clean-pay.dev")=>listeners.forEach(fn=>fn({data,source,origin}))};
  };
  add("ownership-only delivery never schedules a full acknowledgement",()=>{
    const w=widgetCase();w.emit({method:"identify",deliveryId:1,ownershipOnly:true});
    assert.equal(w.timers.length,0);assert.equal(w.sent.length,1); // loaded only
  });
  add("ownership-only has precedence over conflicting fast ACK flags",()=>{
    const w=widgetCase();w.emit({method:"identify",deliveryId:1,ownershipOnly:true,confirmBeforeProbe:true});assert.equal(w.timers.length,0);
  });
  add("ordinary deliveries retain 1200ms and replacement delivery retains 0ms",()=>{
    const w=widgetCase();for(const flag of [undefined,false,"true",1,true])w.emit({method:"identify",deliveryId:1,confirmBeforeProbe:flag});
    assert.deepEqual(w.timers.map(t=>t.delay),[1200,1200,1200,1200,0]);
  });
  add("only boolean ownership-only changes the fixture protocol",()=>{
    const w=widgetCase();for(const value of [undefined,false,"true",1])w.emit({method:"identify",deliveryId:1,ownershipOnly:value});assert.deepEqual(w.timers.map(t=>t.delay),[1200,1200,1200,1200]);
  });
  add("invalid origin, source and delivery identifiers remain rejected",()=>{
    const w=widgetCase();w.emit({method:"identify",deliveryId:1},{ });w.emit({method:"identify",deliveryId:1},w.parent,"https://other.invalid");
    for(const id of [0,-1,1.5,"1",null])w.emit({method:"identify",deliveryId:id});assert.equal(w.timers.length,0);assert.equal(w.sent.length,1);
  });
  function sdkCase({phaseProof=false,pathname="/profile",owned=false,replacement=false}={}) {
    const messages=[],listeners=[],microtasks=[];let frame;
    class Frame {style={};contentWindow={postMessage:(message,origin)=>messages.push({message,origin})};}
    const document={cookie:owned?"cw_conversation=owned":"",createElement:()=>new Frame(),getElementById:()=>frame,body:{appendChild:f=>frame=f}};
    const window={__cleanPayChatwootFixtureReadiness:"eager",__cleanPayChatwootFixtureConfirmation:phaseProof?"phase-proof":undefined,dispatchEvent(){}};
    runInNewContext(sdk,{window,document,location:{pathname},URL,HTMLIFrameElement:Frame,CustomEvent:class{},queueMicrotask:fn=>microtasks.push(fn),localStorage:{getItem:key=>owned&&key==="clean-pay:chatwoot-ownership:v1"?"proof":null},addEventListener:(_name,fn)=>listeners.push(fn)},{timeout:1000});
    window.chatwootSDK.run({baseUrl:"https://chatwoot.browser.clean-pay.dev",websiteToken:"a".repeat(64)});
    if(replacement)frame.src+="&cw_conversation=owned";
    window.$chatwoot.setUser("csyntheticbrowserjourney01",{});
    for(const fn of listeners)fn({origin:"https://chatwoot.browser.clean-pay.dev",source:frame.contentWindow,data:'chatwoot-widget:{"event":"loaded"}'});
    while(microtasks.length)microtasks.shift()();
    assert.equal(messages.length,1);return messages[0].message;
  }
  for(const [name,options,ownership,fast] of [
    ["ordinary SDK never enables ownership-only",{},false,false],
    ["profile seeds only ownership",{phaseProof:true},true,false],
    ["initial owned cabinet seeds only ownership",{phaseProof:true,pathname:"/cabinet",owned:true},true,false],
    ["replacement cabinet asks for correlated full ACK",{phaseProof:true,pathname:"/cabinet",owned:true,replacement:true},false,true],
    ["recreated cabinet asks for correlated full ACK",{phaseProof:true,pathname:"/cabinet"},false,true],
  ])add(name,()=>{const m=sdkCase(options);assert.equal(m.ownershipOnly===true,ownership);assert.equal(m.confirmBeforeProbe===true,fast)});
  add("SDK transport cannot begin before real profile context delivery",async()=>{
    const s=createInitialChatwootBootstrap();let ready=false;const p=s.profileReady().then(()=>{ready=true});await Promise.resolve();assert.equal(ready,false);assert.throws(()=>s.assertProfileReady());s.profileContextDelivered();await p;assert.equal(ready,true);s.assertProfileReady();
  });
  add("cabinet bootstrap is claimed exactly once after the profile",()=>{
    const s=createInitialChatwootBootstrap();assert.throws(()=>s.claimInitialCabinetContext());s.profileContextDelivered();assert.equal(s.claimInitialCabinetContext(),true);assert.equal(s.claimInitialCabinetContext(),false);s.assertCabinetContextClaimed();
  });
  add("missing cabinet context and bootstrap failure never become success",async()=>{
    const s=createInitialChatwootBootstrap();s.profileContextDelivered();assert.throws(()=>s.assertCabinetContextClaimed());const e=new Error("fixture failure");s.fail(e);assert.throws(()=>s.profileReady(),x=>x===e);assert.throws(()=>s.claimInitialCabinetContext(),x=>x===e);
    const t=createInitialChatwootBootstrap();const pending=t.profileReady();t.fail(e);await assert.rejects(pending,x=>x===e);
  });
  add("context recognition requires the bounded support context envelope",()=>{
    const body='0:{"customAttributes":{"subscription_context_status":"ready","payment_context_status":"stale"},"managedLabels":[]}';assert.equal(isInitialChatwootContextResponse(body),true);
    for(const bad of [null,"",'0:"confirmed"',body.replace('"managedLabels":[]','"labels":[]'),'x'.repeat(2*1024*1024+1)])assert.equal(isInitialChatwootContextResponse(bad),false);
  });
  add("profile readiness rejects a full identity and requires persistent ownership",()=>{
    const source=readFileSync(path.join(fixtureDirectory,"chatwoot-phase-browser-capture.ts"),"utf8");
    const sf=ts.createSourceFile("capture.ts",source,ts.ScriptTarget.Latest,true);const fn=sf.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="waitForInitialProfileSupportContext");assert.ok(fn);
    let callback;function find(n){if(ts.isCallExpression(n)&&n.expression.getText(sf)==="page.waitForFunction")callback=n.arguments[0].getText(sf);ts.forEachChild(n,find)}find(fn);assert.ok(callback);
    const js=ts.transpileModule("const check = "+callback+"; check();",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    function check(phase,ownership,identity){return runInNewContext(js,{window:{$chatwoot:{user:{custom_attributes:{payment_context_status:"stale"}}},__cleanPayChatwootBoundaryCalls:[{method:"removeLabel",label:"subscription_expired"}],cleanPayChatwootPendingIdentity:phase?{phase}:undefined},localStorage:{getItem:key=>key.includes("ownership")?(ownership?"proof":null):(identity?"proof":null)}},{timeout:1000})}
    assert.equal(check("ownership_confirmed",true,false),true);for(const input of [[undefined,false,true],["sent",true,false],["waiting_for_frame",true,false],["ownership_confirmed",false,false],["ownership_confirmed",true,true]])assert.equal(check(...input),false);
  });
  add("simple CSS whitespace normalizes without sorting declarations",()=>{
    assert.equal(canonical("width: 2.5rem; height: 2.5rem;"),canonical("width:2.5rem;height:2.5rem"));assert.equal(canonical("overflow: auto;"),"overflow:auto;");assert.notEqual(canonical("width:1px;width:2px"),canonical("width:2px;width:1px"));
  });
  add("CSS expressions, comments, custom properties and unknown styles are not normalized",()=>{
    for(const x of ['--x:1','color:red','width:calc(1px + 2px)','width:var(--x)','width:1px/*x*/','width:1px;;height:2px','content:"a;b"','width:NaN','WIDTH:1px',''])assert.equal(canonical(x),null,x);
  });
  function manifest(style){return{schemaVersion:2,project:"journey-1440x900",journey:"x",checkpoints:[{label:"cabinet",dom:{type:"element",tag:"div",attributes:[{name:"style",value:style}],children:[]}}],network:{requests:[{url:"/secret",status:200}]},cookies:[{secure:true}]}}
  add("paired formatting normalization leaves evidence input fields intact",()=>{
    const a=manifest("width:2.5rem;height:2.5rem"),b=manifest("width: 2.5rem; height: 2.5rem;");assert.equal(project(a,b),1);assert.deepEqual(a,b);assert.deepEqual(a.network,{requests:[{url:"/secret",status:200}]});
  });
  for(const [name,change]of [
    ["changed size",b=>b.checkpoints[0].dom.attributes[0].value="width:3rem;height:2.5rem"],
    ["changed priority",b=>b.checkpoints[0].dom.attributes[0].value="width:2.5rem!important;height:2.5rem"],
    ["changed element",b=>b.checkpoints[0].dom.tag="span"],
    ["changed label",b=>b.checkpoints[0].label="other"],
    ["duplicate style",b=>b.checkpoints[0].dom.attributes.push({name:"style",value:"width:2.5rem;height:2.5rem"})],
  ])add("pair leaves "+name+" observable",()=>{const a=manifest("width:2.5rem;height:2.5rem"),b=structuredClone(a);change(b);const before=structuredClone([a,b]);assert.equal(project(a,b),0);assert.deepEqual([a,b],before);assert.notDeepEqual(a,b)});
  add("formatting exception never hides an extra request or insecure cookie",()=>{
    const a=manifest("width:2.5rem"),b=manifest("width: 2.5rem;");b.network.requests.push({url:"/other",status:200});b.cookies[0].secure=false;assert.equal(project(a,b),1);assert.notDeepEqual(a,b);assert.equal(b.network.requests.length,2);assert.equal(b.cookies[0].secure,false);
  });
  return cases;
}
