import {test} from 'node:test';import assert from 'node:assert/strict';import {calculate} from './rb-calc.mjs';
const x={quantity:100,stock:0,perFg:2,yield:10,weight:100,setup:3,joint:1,scrap:2,batch:80,increment:10};
test('normal RB calculation and rounding',()=>{const r=calculate(x);assert.equal(r.required,20);assert.equal(r.net,2);assert.ok(Math.abs(r.total-5.06)<1e-10);assert.equal(r.rounded,10);assert.equal(r.batches,.125)});
test('stock covers demand: no production or setup',()=>{const r=calculate({...x,stock:20});assert.equal(r.produce,0);assert.equal(r.total,0);assert.equal(r.rounded,0)});
test('round required rods before stock deduction',()=>assert.equal(calculate({...x,quantity:101,stock:2}).produce,19));
test('reject zero divisor and invalid counts',()=>{assert.throws(()=>calculate({...x,yield:0}));assert.throws(()=>calculate({...x,quantity:1.5}));assert.throws(()=>calculate({...x,stock:-1}));assert.throws(()=>calculate({...x,weight:NaN}))});
