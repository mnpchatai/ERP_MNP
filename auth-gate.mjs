// Shared "log in once a day" + admin-only visibility used by every page.
// Supabase's own refresh token would keep a session alive far longer than a
// day; the user asked for a hard once-per-24h re-login regardless of that,
// so a login timestamp is tracked here and checked independently.
const LOGIN_AT_KEY = 'mnp-erp-login-at';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function markLoginNow() {
  try { localStorage.setItem(LOGIN_AT_KEY, String(Date.now())); } catch {}
}

export function clearLoginMark() {
  try { localStorage.removeItem(LOGIN_AT_KEY); } catch {}
}

function loginMarkExpired() {
  let at;
  try { at = Number(localStorage.getItem(LOGIN_AT_KEY)); } catch { at = NaN; }
  return !at || (Date.now() - at) > SESSION_TTL_MS;
}

// Call once at boot, before trusting any existing session: signs out a
// session whose login mark is missing or older than 24h, even though
// Supabase itself would still consider it valid.
export async function enforceSessionTtl(client) {
  const {data} = await client.auth.getSession();
  if (data.session && loginMarkExpired()) {
    await client.auth.signOut();
    clearLoginMark();
  }
}

// Keeps the login mark in step with the session for as long as the page
// lives, including sign-ins/outs that happen after boot.
export function watchLoginMarks(client) {
  client.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_IN') markLoginNow();
    if (event === 'SIGNED_OUT') clearLoginMark();
  });
}

// org_is_admin() is a security-definer RPC granted to `authenticated`
// (see docs/DATA-LAYER.md) — safe to call directly from the browser.
export async function isAdmin(client) {
  try {
    const {data, error} = await client.rpc('org_is_admin');
    if (error) throw error;
    return data === true;
  } catch { return false; }
}
