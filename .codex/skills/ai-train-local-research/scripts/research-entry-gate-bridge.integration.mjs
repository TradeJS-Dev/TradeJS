import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { fork, execFileSync } from 'node:child_process';
import {
  checkActivation,
  installEntryGateBridge,
  validateExecutionObservationOptions,
  secretFreeProcessReceipt,
  verifyExecutionObservationModules,
} from './research-entry-gate-bridge.mjs';
import {
  canonicalJson,
  objectSha256,
  sha256,
} from './decision-capture-join.mjs';
import {
  createShardedCaptureSink,
  readStorageManifest,
} from './decision-capture-storage.mjs';

const installedRoot = process.env.TRADEJS_BETA268_FIXTURE_ROOT;
if (!installedRoot || !path.isAbsolute(installedRoot)) throw new Error('TRADEJS_BETA268_FIXTURE_ROOT must name an isolated exact beta268 installation');
const executionOptions = () => ({
  schema: 'tradejs-entry-execution-observations/v1',
  enabled: true,
  runtimeVersion: '3.1.29-beta.268',
  runtimeModule: {
    relativePath: 'dist/chunk-SKY2HNZU.mjs',
    sha256: 'a471d1def1ca8f8ae5956539ae5de6efbe909f5f03d2b012b29c4e819dba003e',
  },
  publicModule: {
    relativePath: 'dist/strategies.mjs',
    sha256: 'fe4c6de6260ca322060d3128caa5020792064a123ba879aa21155cb783dfb768',
  },
  typesModule: {
    relativePath: 'dist/index.d.ts',
    sha256: '4cfa0d2af91b3e37d51d7cdf7f7f8d8d9245535adfbec931850b79063385e9d3',
  },
  maxPendingInvocations: 2,
  maxPendingBytes: 8192,
  maxIdentityBytes: 256,
  maxResultBytes: 1024,
});
test('installed beta268 module/types SHA binds modeled hook context and public export', () => {
  const base =
    path.join(installedRoot, 'node_modules/@tradejs/');
  const options = executionOptions();
  for (const [name, pkg] of [
    ['runtimeModule', 'node'],
    ['publicModule', 'node'],
    ['typesModule', 'types'],
  ])
    assert.equal(
      sha256(fs.readFileSync(base + pkg + '/' + options[name].relativePath)),
      options[name].sha256,
    );
  const runtime = fs.readFileSync(
    base + 'node/' + options.runtimeModule.relativePath,
    'utf8',
  );
  const types = fs.readFileSync(
    base + 'types/' + options.typesModule.relativePath,
    'utf8',
  );
  assert.match(runtime, /order:\s*\{\s*result: signal/);
  assert.match(runtime, /order:\s*\{\s*result: decision.code/);
  assert.match(runtime, /const projectBlock = projectResults.find/);
  assert.match(types, /result: Signal \| string/);
  assert.ok(
    runtime.indexOf('await invokeProjectHooks(stage, params, errorContext)') <
      runtime.indexOf('return invokeHook(stage, hook, params, errorContext)'),
  );
});
for (const [delay, projectVeto] of [
  [0, false],
  [1, false],
  [0, true],
  [0, 'prior-manifest'],
])
  test(
    'isolated actual public createStrategyRuntime fixture delay=' +
      delay +
      ' ProjectVeto=' +
      projectVeto,
    (t) => {
      const root = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'public-runtime-bridge-unit-')),
      );
      t.after(() => fs.rmSync(root, { recursive: true }));
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'synthetic-research-only' }),
        { flag: 'wx' },
      );
      fs.writeFileSync(
        path.join(root, 'tradejs.config.ts'),
        'export default {strategies:[],indicators:[],connectors:[],hooks:{beforePlaceOrder:async p=>{p.decision.signal.unitProjectBefore=(p.decision.signal.unitProjectBefore||0)+1;},afterPlaceOrder:async p=>{p.decision.signal.unitProjectAfter=(p.decision.signal.unitProjectAfter||0)+1;},' +
          (projectVeto === true
            ? 'beforeEntryGate:async()=>({allow:false,reason:"UNIT_PROJECT_VETO"})'
            : '') +
          '}};',
        { flag: 'wx' },
      );
      const fixture = path.join(root, 'fixture.mjs');
      fs.writeFileSync(
        fixture,
        "// Unit fixture only: public installed export, own synthetic config/connector/data.\nimport fs from 'node:fs';\nimport net from 'node:net';\nimport assert from 'node:assert/strict';\nimport {pathToFileURL} from 'node:url';\nimport {installEntryGateBridge} from BRIDGE_URL;\nimport {objectSha256,sha256} from JOIN_URL;\nconst base=FROZEN_NODE_DIST;\nassert.equal(sha256(fs.readFileSync(base+'chunk-SKY2HNZU.mjs')),'a471d1def1ca8f8ae5956539ae5de6efbe909f5f03d2b012b29c4e819dba003e');\nassert.equal(sha256(fs.readFileSync(base+'strategies.mjs')),'fe4c6de6260ca322060d3128caa5020792064a123ba879aa21155cb783dfb768');\nlet networkAttempts=0;\n// Test-only denial at OS socket seam, before public package import. No runtime/private module patch.\nnet.Socket.prototype.connect=function(){networkAttempts++;throw Error('UNIT_NETWORK_DENIED');};\nconst {createStrategyRuntime}=await import(pathToFileURL(base+'strategies.mjs'));\nconst delay=Number(process.argv[2]);const projectVeto=process.argv[3]==='veto';const priorManifestVeto=process.argv[3]==='prior-veto';\nconst candle=ts=>({timestamp:ts,dt:new Date(ts).toISOString(),open:100,close:100,high:101,low:99,volume:100,turnover:10000});\nconst firstTs=300*900000;const data=Array.from({length:300},(_,i)=>candle(i*900000));\nconst signal={signalId:'synthetic-public-signal',symbol:'BTCUSDT',direction:'LONG',timestamp:firstTs,interval:'15',strategy:'SyntheticBridge',prices:{currentPrice:100,stopLossPrice:99,takeProfitPrice:102},figures:{},indicators:{},additionalIndicators:{},userName:'synthetic'};\nconst decision={kind:'entry',code:'UNIT_ENTRY',signal,entryContext:{strategy:'SyntheticBridge',direction:'LONG',timestamp:firstTs,prices:signal.prices},orderPlan:{qty:1,stopLossPrice:99,takeProfits:[{price:102,percentage:100}]},runtime:{ai:{enabled:false,minQuality:4},ml:{enabled:false}}};\nconst calls=[],records=[],executions=[];let cfg,gateParams,beforeParams;let placed=0;let coreCalls=0;\nconst manifest={name:'SyntheticBridge',hooks:{onInit:p=>{cfg=p.ctx.strategyConfig;},beforeEntryGate:async p=>{gateParams=p;if(priorManifestVeto)return {allow:false,reason:'UNIT_PRIOR_MANIFEST_VETO'};},beforePlaceOrder:async p=>{assert.equal(p.decision.signal.unitProjectBefore,1);for(const field of ['ctx','decision','policy','ml','ai'])assert.equal(p[field],gateParams[field]);assert.equal(p.entry===gateParams.entry,delay===0);assert.equal(p.market===gateParams.market,delay===0);beforeParams=p;calls.push({stage:'manifest-before',timestamp:p.market.candle.timestamp,signal:p.decision.signal.signalId,entryTimestamp:p.decision.entryContext.timestamp});},afterPlaceOrder:async p=>{assert.equal(p.decision.signal.unitProjectAfter,1);for(const field of ['ctx','decision','entry','policy','ml','ai','market'])assert.equal(p[field],beforeParams[field]);calls.push({stage:'manifest-after',timestamp:p.market.candle.timestamp,result:p.order.result===signal});}}};\nconst creator=createStrategyRuntime({strategyName:'SyntheticBridge',defaults:{ENV:'BACKTEST',INTERVAL:'15',MIN_AI_QUALITY:4,MAX_LOSS_VALUE:1,BACKTEST_ENTRY_DELAY_BARS:delay},manifest,createCore:async()=>async()=>{coreCalls++;return coreCalls===1?decision:{kind:'skip',code:'UNIT_SKIP'};}});\nconst connector={universe:'crypto',getPosition:async()=>placed?{qty:1,price:100,direction:'LONG'}:null,placeOrder:async()=>{placed++;return true;},setTakeProfits:async()=>true,setStopLoss:async()=>true,closePosition:async()=>{throw Error('Unexpected close');}};\nconst strategy=await creator({userName:'synthetic',symbol:'BTCUSDT',connector,data,btcData:data,config:{},runtimeConfigSnapshot:{userConfig:{}}});\nconst composition={strategyName:'SyntheticBridge',researchRunId:'synthetic-only',configId:'fixture',symbols:['BTCUSDT'],windowStart:0,windowEnd:1000000000,mode:'capture-pass-all',config:{resolved:cfg,sha256:objectSha256(cfg),minAiQuality:4,nativeMinQuality:4,interval:'15',directionPolicy:'both'},storage:{schema:'tradejs-capture-stream-storage/v1',helperSha256:'d'.repeat(64),reclaimPlain:false},executionObservations:{schema:'tradejs-entry-execution-observations/v1',enabled:true,runtimeVersion:'3.1.29-beta.268',runtimeModule:{relativePath:'dist/chunk-SKY2HNZU.mjs',sha256:'a471d1def1ca8f8ae5956539ae5de6efbe909f5f03d2b012b29c4e819dba003e'},publicModule:{relativePath:'dist/strategies.mjs',sha256:'fe4c6de6260ca322060d3128caa5020792064a123ba879aa21155cb783dfb768'},typesModule:{relativePath:'dist/index.d.ts',sha256:'4cfa0d2af91b3e37d51d7cdf7f7f8d8d9245535adfbec931850b79063385e9d3'},maxPendingInvocations:2,maxPendingBytes:8192,maxIdentityBytes:256,maxResultBytes:1024}};\nconst controller=installEntryGateBridge({manifest,composition,compositionSha256:'a'.repeat(64),observation:{sha256:'b'.repeat(64)},publicAi:{buildAiPayload:s=>({signal:s}),runAiPromptLocal:async()=>{throw Error('No gate search');}},collectFeatures:()=>({}),sink:{append:r=>records.push(r),close(){},abort(){}},executionSink:{append:r=>executions.push(r),close(){},abort(){}}});\nconst first=candle(firstTs);await strategy(first,first);\nif(delay&&!projectVeto){const next=candle(firstTs+900000);await strategy(next,next);}\ncontroller.close();assert.equal(networkAttempts,0);\nif(projectVeto){assert.equal(placed,0);assert.equal(executions.filter(r=>r.stage==='gate-invocation-link').length,0);assert.equal(executions.at(-1).capturedWithoutManifestGate,1);}\nelse if(priorManifestVeto){assert.equal(placed,0);assert.equal(records.filter(r=>r.schema==='tradejs-entry-gate-observation/v1').length,0);assert.equal(executions[0].ownGateCalled,false);assert.equal(executions[0].gateObservationSha256,null);assert.equal(executions[0].gateObservationStatus,'absent-prior-manifest-veto');assert.deepEqual(executions.map(r=>r.observationSequence),[0,1]);}\nelse{assert.equal(placed,1);assert.deepEqual(calls.map(x=>x.stage),['manifest-before','manifest-after']);assert.equal(calls[0].timestamp,firstTs+delay*900000);assert.equal(calls[0].entryTimestamp,firstTs+delay*900000);assert.equal(calls[1].result,true);assert.deepEqual(executions.slice(0,3).map(x=>x.stage),['gate-invocation-link','before-place-order-attempt','after-place-order-executed']);assert.equal(executions[1].executionTimestamp,firstTs+delay*900000);assert.equal(executions[1].timestamp,firstTs);assert.equal(executions.at(-1).unresolved.length,0);const gate=records.find(r=>r.schema==='tradejs-entry-gate-observation/v1');assert.equal(executions[0].gateObservationSha256,objectSha256(gate));assert.deepEqual(executions.map(r=>r.observationSequence),[0,1,2,3]);assert.ok(executions.slice(0,3).every(r=>r.workerObservationSha256==='b'.repeat(64)));}\nconsole.log(JSON.stringify({schema:'tradejs-isolated-public-runtime-fixture/v1',delay,projectVeto,placed,networkAttempts,stages:executions.map(x=>x.stage),publicModuleSha256:composition.executionObservations.publicModule.sha256}));\nprocess.exit(0);\n"
          .replace('FROZEN_NODE_DIST', JSON.stringify(path.join(installedRoot, 'node_modules/@tradejs/node/dist/')))
          .replace(
            'BRIDGE_URL',
            JSON.stringify(
              new URL('./research-entry-gate-bridge.mjs', import.meta.url).href,
            ),
          )
          .replace(
            'JOIN_URL',
            JSON.stringify(
              new URL('./decision-capture-join.mjs', import.meta.url).href,
            ),
          ),
        { flag: 'wx' },
      );
      const output = execFileSync(
        process.execPath,
        [
          fixture,
          String(delay),
          projectVeto === 'prior-manifest'
            ? 'prior-veto'
            : projectVeto
              ? 'veto'
              : 'allow',
        ],
        {
          cwd: root,
          env: {
            PATH: path.dirname(process.execPath),
            PROJECT_CWD: root,
            BINANCE_MARKET_CONTEXT_ENABLED: 'false',
            COINMARKETCAP_CONTEXT_ENABLED: 'false',
            DERIVATIVES_CONTEXT_ENABLED: 'false',
            HYPERLIQUID_WHALE_CONTEXT_ENABLED: 'false',
            BACKTEST_LOWER_TIMEFRAME_EXECUTION_ENABLED: 'false',
            NODE_ENV: 'test',
          },
          encoding: 'utf8',
          maxBuffer: 1048576,
          timeout: 10000,
        },
      );
      const result = JSON.parse(output.trim().split('\n').at(-1));
      assert.equal(result.networkAttempts, 0);
      assert.equal(result.placed, projectVeto ? 0 : 1);
    },
  );
