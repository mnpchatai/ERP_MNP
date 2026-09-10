import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authError} from './supabase-client.mjs';

test('names a wrong password rather than blaming the connection', () => {
  assert.match(authError({message: 'Invalid login credentials', status: 400}), /อีเมลหรือรหัสผ่านไม่ถูกต้อง/);
});

test('points at the provider setting when email sign-in is off', () => {
  assert.match(authError({message: 'Email logins are disabled', status: 422}), /Providers/);
});

test('tells the admin to auto-confirm when the address is unconfirmed', () => {
  assert.match(authError({code: 'email_not_confirmed', message: 'Email not confirmed'}), /Auto Confirm User/);
});

test('recognises rate limiting from the status alone', () => {
  assert.match(authError({status: 429, message: 'Request rate limit reached'}), /ถี่เกินไป/);
});

test('separates a blocked request from a rejected credential', () => {
  assert.match(authError(new TypeError('Failed to fetch')), /ตรวจอินเทอร์เน็ต/);
});

test('passes an unrecognised message through instead of hiding it', () => {
  assert.match(authError({message: 'Signups not allowed for this instance'}), /Signups not allowed/);
});

test('still says something useful when there is no message at all', () => {
  assert.match(authError(undefined), /เข้าสู่ระบบไม่สำเร็จ/);
});
