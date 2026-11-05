import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// Exports only allowlisted metadata. Never reads .env, browser storage state,
// request headers or provider response bodies.
const root='docs/reviews/recovery';
const ledger=JSON.parse(readFileSync('.qa/provider-ledger.json','utf8'));
const requests=ledger.requests.map(r=>({startedAt:r.startedAt,model:r.model,status:r.status??null,transportError:!!r.transportError,promptTokens:r.usage?.prompt_tokens??0,cachedPromptTokens:r.usage?.prompt_tokens_details?.cached_tokens??0,completionTokens:r.usage?.completion_tokens??0,estimatedCostUsd:r.estimatedCostUsd??null,conservativeUpperBoundUsd:r.upperBoundUsd}));
const byModel={};
for(const r of requests){const entry=byModel[r.model]??={requests:0,promptTokens:0,cachedPromptTokens:0,completionTokens:0,estimatedCostUsd:0};entry.requests++;entry.promptTokens+=r.promptTokens;entry.cachedPromptTokens+=r.cachedPromptTokens;entry.completionTokens+=r.completionTokens;entry.estimatedCostUsd+=r.estimatedCostUsd??r.conservativeUpperBoundUsd;}
const usage={generatedAt:new Date().toISOString(),ceilingUsd:5,pricingSource:'https://console.river.ai/api/public/pricing',modelPricing:ledger.modelPricing,estimatedTotalUsd:requests.reduce((n,r)=>n+(r.estimatedCostUsd??r.conservativeUpperBoundUsd),0),byModel,requests};
writeFileSync(`${root}/provider-usage.json`,JSON.stringify(usage,null,2));
const checks=JSON.parse(readFileSync('.qa/final-checks.json','utf8'));
const browser=JSON.parse(readFileSync('test-results/recovery-browser.json','utf8'));
const testLog=readFileSync('.qa/tests-final.log','utf8');
const summary={generatedAt:new Date().toISOString(),implementationCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),checks,unitTests:Number(/ℹ tests (\d+)/.exec(testLog)?.[1]),unitPass:Number(/ℹ pass (\d+)/.exec(testLog)?.[1]),unitFail:Number(/ℹ fail (\d+)/.exec(testLog)?.[1]),unitSkipped:Number(/ℹ skipped (\d+)/.exec(testLog)?.[1]),browser:browser.stats,nativeZoom:JSON.parse(readFileSync(`${root}/native-zoom-extension.json`,'utf8')),providerEstimatedUsd:usage.estimatedTotalUsd};
writeFileSync(`${root}/verification.json`,JSON.stringify(summary,null,2));
const files=[];
function walk(dir){for(const name of readdirSync(dir)){const path=`${dir}/${name}`;if(statSync(path).isDirectory())walk(path);else if(!path.endsWith('/artifact-manifest.json'))files.push({path:path.slice(root.length+1),bytes:statSync(path).size,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});}}
walk(root);writeFileSync(`${root}/artifact-manifest.json`,JSON.stringify({generatedAt:new Date().toISOString(),files},null,2));
console.log(JSON.stringify({unitPass:summary.unitPass,browserPass:summary.browser.expected,providerEstimatedUsd:usage.estimatedTotalUsd,artifacts:files.length}));
