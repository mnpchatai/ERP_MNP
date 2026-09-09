import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateExcelRow} from './rb-excel.mjs';
const input = {G:500,H:100,J:3,K:0.01,M:0.02,S:80,U:40,V:10};
test('transcribes I/L/N/O/P/Q, including fractional strips and whole batches', () => {
  assert.deepEqual(calculateExcelRow(input), {I:50,L:0.5,N:1,O:54.5,P:1.5,Q:1});
});
test('preserves setup at zero quantity, as Excel does', () => {
  assert.equal(calculateExcelRow({...input,H:0}).O,3);
});
test('does not infer missing values or accept Excel errors', () => {
  for (const value of [null,undefined,'#N/A',NaN,Infinity,-1])
    assert.throws(() => calculateExcelRow({...input,G:value}));
});
test('rejects division by zero', () => {
  for (const key of ['S','U','V']) assert.throws(() => calculateExcelRow({...input,[key]:0}));
});
test('rounds batches upward beyond one batch', () => {
  assert.equal(calculateExcelRow({...input,H:200}).Q,2);
});
