// Native regressions for fixture scheduling and fail-closed runtime diagnostics.
// These do not replace the full journey-contract project or a live application run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { observeSyntheticChatwootConfirmationDelays as observe } from './chatwoot-fixture-timing.mjs';
import { assertJourneyOneShotLifecycle as validate,
  collectJourneyOneShotLifecycleFailureEvidence as collect } from './journey-compose-runtime-attestation.mjs';

const caddy = readFileSync(new URL('./Caddyfile', import.meta.url), 'utf8');
const timing = { fallbackDelaysMs: [1200, 1200, 1200, 1200],
  identityConfirmationDelayMs: 1200, fastIdentityConfirmationDelayMs: 0 };
const message = 'Journey one-shot event history differs from inspected state timestamps.';
function exactTiming(source) { assert.deepEqual(observe(source), timing); }
test('v7 real checked-in widget keeps 1200 ms fallback and boolean-only zero delay', () => exactTiming(caddy));
test('v7 reproduces the obsolete v6 timing regex yielding NaN', () => {
  const match = /\}\), ([0-9_]+)\);\n    \}\);\n    send\(\{ event: "loaded" \}\);/.exec(caddy);
  assert.ok(Number.isNaN(Number(match?.[1].replaceAll('_', ''))));
});
test('v7 unchanged behavior is independent of timing expression formatting', () => {
  exactTiming(caddy.replace('event.data.confirmBeforeProbe === true ? 0 : 1200',
    'event.data.confirmBeforeProbe === true\n        ? 0\n        : 1_200'));
});
test('v7 wrong fallback remains a failing contract', () => {
  assert.throws(() => exactTiming(caddy.replace('? 0 : 1200', '? 0 : 500')), assert.AssertionError);
});
test('v7 delayed phase confirmation remains a failing contract', () => {
  assert.throws(() => exactTiming(caddy.replace('? 0 : 1200', '? 75 : 1200')), assert.AssertionError);
});
test('v7 truthy string or number cannot activate early confirmation unnoticed', () => {
  assert.throws(() => exactTiming(caddy.replace('event.data.confirmBeforeProbe === true ?',
    'event.data.confirmBeforeProbe ?')), assert.AssertionError);
});
test('v7 missing widget and duplicate scripts are rejected', () => {
  assert.throws(() => observe(''), /exactly one/);
  assert.throws(() => observe(caddy.replace('</script></body>', '</script><script></script></body>')), /exactly one/);
});
test('v7 absent confirmation timer is rejected instead of returning NaN', () => {
  assert.throws(() => observe(caddy.replace('setTimeout(() => send({', 'void (() => send({')), /timer/);
});

const start = Date.parse('2026-09-07T00:01:00.000Z');
const end = start + 60_000;
const ns = ms => (BigInt(ms) * 1_000_000n).toString();
const iso = ms => new Date(ms).toISOString();
function fixture(startDelta = 0, dieDelta = 0) {
  const id = 'a'.repeat(64);
  const container = { Id: id, Config: { Labels: { 'com.docker.compose.service': 'migration' },
    Env: ['SECRET=do-not-export'] }, State: { Status: 'exited', ExitCode: 0 }, RestartCount: 0 };
  const value = { lifecycleNotBefore: iso(start - 120_000), createdAt: iso(start - 60_000),
    startedAt: iso(start), finishedAt: iso(end), attestedAt: iso(end + 120_000),
    events: ['create', 'start', 'die'].map((action, i) => ({ action,
      containerIdSha256: createHash('sha256').update(id).digest('hex'),
      timeNano: ns([start - 60_000, start + startDelta, end + dieDelta][i]),
    })) };
  return { value, container };
}
function failure(f) {
  try { validate(f.value, f.container); } catch (error) { return error; }
  throw new Error('Expected lifecycle rejection');
}
test('v7 exact lifecycle and existing inclusive 10000 ms boundary still pass', () => {
  for (const [s, d] of [[0,0],[10000,10000],[-10000,-10000]]) {
    const f = fixture(s,d); assert.equal(validate(f.value,f.container),f.value);
  }
});
for (const [name,s,d] of [['start-late',10001,0],['start-early',-10001,0],
  ['die-late',0,10001],['die-early',0,-10001]]) {
  test(`v7 ${name} is rejected with exact signed timing diagnostics`, () => {
    const error = failure(fixture(s,d)); assert.equal(error.message,message);
    assert.equal(createHash('sha256').update(error.message).digest('hex'),
      'a0af5ff33d8f4df922ce6682bd7b92c3a9066eac2c9cc64b586683c1f26968e9');
    const [e] = collect(new AggregateError([new AggregateError([error])]));
    assert.equal(e.service,'migration'); assert.equal(e.exitCode,0);
    assert.deepEqual(e.actions,['create','start','die']);
    assert.deepEqual(e.timestampComparison,{ maximumDeltaMs:10000,
      stateStartedAtUnixMs:start,stateFinishedAtUnixMs:end,
      startEventUnixMs:start+s,dieEventUnixMs:end+d,startDeltaMs:s,dieDeltaMs:d });
    assert.ok(!JSON.stringify(e).includes('SECRET'));
    assert.ok(Object.isFrozen(e) && Object.isFrozen(e.timestampComparison));
  });
}
test('v7 runtime evidence excludes arbitrary service labels and environment values', () => {
  const f = fixture(10001,0); f.container.Config.Labels['com.docker.compose.service']='private-token';
  const [e] = collect(failure(f)); assert.equal(e.service,'unknown');
  assert.doesNotMatch(JSON.stringify(e), /private-token|SECRET|do-not-export/);
});
test('v7 missing events keep the pre-existing strict error and diagnostic shape', () => {
  const f=fixture();f.value.events.shift();const error=failure(f);
  assert.match(error.message,/missing, truncated, or repeated/);
  assert.deepEqual(collect(error),[{actions:['start','die'],eventCountTruncated:false,
    exitCode:0,observedEventCount:2,restartCount:0,service:'migration',stateStatus:'exited'}]);
});
test('v7 malformed event identity and reordered events still fail', () => {
  const f=fixture();f.value.events[1].containerIdSha256='b'.repeat(64);
  assert.match(failure(f).message,/exactly once/);
  const g=fixture();g.value.events.reverse();assert.match(failure(g).message,/exactly once/);
});
test('v7 Chatwoot entrypoint emits timing evidence before its hashed error', () => {
  const source=readFileSync(new URL('./prove-chatwoot-phase-stability.mjs',import.meta.url),'utf8');
  assert.ok(source.includes('collectJourneyOneShotLifecycleFailureEvidence(error)'));
  assert.ok(source.indexOf('status: "chatwoot_runtime_attestation_failed"') <
    source.indexOf('status: "dual_image_chatwoot_phase_stability_failed"'));
});
test('v7 actual synthetic generator still creates identical role environments', () => {
  const roots=[mkdtempSync(path.join(tmpdir(),'clean-pay-v7-a-')),mkdtempSync(path.join(tmpdir(),'clean-pay-v7-b-'))];
  try {
    const outputs=roots.map(root=>{
      const p=spawnSync(process.execPath,[fileURLToPath(new URL('./prepare-synthetic-env.mjs',import.meta.url))],{
        encoding:'utf8',timeout:15000,env:{...process.env,CLEAN_PAY_BROWSER_JOURNEY_ENV_DIR:root,
          CLEAN_PAY_BROWSER_COMPOSE_PROJECT:'clean-pay-browser-journey-contract-test',
          CLEAN_PAY_BROWSER_APP_IMAGE:'clean-pay:synthetic-app',
          CLEAN_PAY_BROWSER_MIGRATION_IMAGE:'clean-pay:synthetic-migration',
          CLEAN_PAY_BROWSER_SOURCE_REVISION:'f5cb6f543d85256e7733a1ade6a4f451d86cf378'}});
      assert.equal(p.status,0,p.stderr);
      const status=JSON.parse(p.stdout);assert.equal(status.status,'prepared');assert.equal(status.roleFileCount,7);
      return Object.fromEntries(readdirSync(root).sort().map(name=>[name,
        readFileSync(path.join(root,name),'utf8').replaceAll(root,'<OUTPUT_DIR>')]));
    });
    assert.equal(Object.keys(outputs[0]).length,11);assert.deepEqual(outputs[0],outputs[1]);
  } finally { for(const root of roots) rmSync(root,{recursive:true,force:true}); }
});
