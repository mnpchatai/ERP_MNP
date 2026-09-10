import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate} from './rb-calc.mjs';
import {saveCloudPlan,listCloudPlans,validateSnapshot} from './rb-cloud.mjs';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input={quantity:100,stock:0,perFg:2,yield:10,weight:100,setup:3,joint:1,scrap:2,batch:80,increment:10};
const record={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',reference:'TEST-ONLY',product:{id:'DEMO-RB-001',formula:'DEMO'},inputs:input,result:calculate(input),created:'2026-09-09T00:00:00Z',ruleVersion:'trial-0.1',seStock:null};
function mock(responses){
  const calls=[];
  const client={from(table){calls.push(['from',table]);const chain={};for(const name of ['insert','select','eq','order'])chain[name]=(...args)=>{calls.push([name,...args]);return chain;};
    for(const name of ['single','range'])chain[name]=async(...args)=>{calls.push([name,...args]);return responses.shift();};return chain;}};
  return {client,calls};
}
test('snapshot accepts pilot, rejects wrong totals and nonblank SE',()=>{
  assert.equal(validateSnapshot(record),record);
  assert.throws(()=>validateSnapshot({...record,result:{...record.result,total:999}}));
  assert.throws(()=>validateSnapshot({...record,seStock:0}));
});
test('save preserves owner and snapshot, no update or delete',async()=>{
  const {client,calls}=mock([{data:{id:record.id},error:null}]);
  await saveCloudPlan(client,record,owner);
  const row=calls.find(c=>c[0]==='insert')[1];assert.equal(row.owner_id,owner);assert.equal(row.snapshot.seStock,null);
  assert.equal(row.id,record.id);assert.notEqual(row.snapshot,record);
});
test('retry after duplicate verifies identical snapshot despite JSON key order',async()=>{
  const existing=Object.fromEntries(Object.entries(record).reverse());
  const {client}=mock([{error:{code:'23505'}},{data:{id:record.id,snapshot:existing},error:null}]);
  assert.deepEqual(await saveCloudPlan(client,record,owner),{id:record.id});
});
test('duplicate with different snapshot fails instead of overwriting',async()=>{
  const {client}=mock([{error:{code:'23505'}},{data:{id:record.id,snapshot:{...record,reference:'DIFFERENT'}},error:null}]);
  await assert.rejects(saveCloudPlan(client,record,owner));
});
test('permission or network errors propagate; no local fallback',async()=>{
  const {client,calls}=mock([{error:{code:'42501'}}]);
  await assert.rejects(saveCloudPlan(client,record,owner),error=>error.code==='42501');
  assert.equal(calls.filter(c=>c[0]==='from').length,1);
});
test('history filters owner, stable ordering, limited pagination',async()=>{
  const {client,calls}=mock([{data:[],error:null}]);
  assert.deepEqual(await listCloudPlans(client,owner,2),[]);
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='owner_id'&&c[2]===owner));
  assert.deepEqual(calls.find(c=>c[0]==='range'),['range',40,59]);
});
test('missing owner is rejected without network',async()=>{
  const {client,calls}=mock([]);await assert.rejects(saveCloudPlan(client,record,''));assert.equal(calls.length,0);
});
