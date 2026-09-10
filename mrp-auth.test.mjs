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

import {linkError, linkCallbackError} from './supabase-client.mjs';

test('magic link: says the address has no account rather than "check your password"', () => {
  assert.match(linkError({status: 422, message: 'Signups not allowed for otp'}), /ไม่พบบัญชีของอีเมลนี้/);
});

test('magic link: names the free-tier email limit when throttled', () => {
  assert.match(linkError({status: 429, message: 'For security purposes, you can only request this after 51 seconds'}), /ถี่เกินไป/);
});

test('magic link: points at the redirect allowlist when the URL is rejected', () => {
  assert.match(linkError({message: 'Redirect URL not allowed'}), /Redirect URLs/);
});

test('magic link: points at SMTP when the mail itself fails', () => {
  assert.match(linkError({message: 'Error sending magic link email'}), /SMTP/);
});

test('magic link: passes an unknown message through', () => {
  assert.match(linkError({message: 'Something new from GoTrue'}), /Something new from GoTrue/);
});

test('callback: an expired link asks for a new one', () => {
  const hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  assert.match(linkCallbackError(hash), /หมดอายุ/);
});

test('callback: a clean return reports no problem', () => {
  assert.equal(linkCallbackError('#access_token=abc&type=magiclink'), null);
  assert.equal(linkCallbackError(''), null);
});

test('callback: an unrecognised error still surfaces its description', () => {
  assert.match(linkCallbackError('#error=server_error&error_description=Database+error'), /Database error/);
});
