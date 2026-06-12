/* STILE — client-side preview accounts.
 *
 * Local-only auth: account state lives in localStorage. There is no server
 * verifying the password; this exists so the site can preview a SaaS-shaped
 * flow (signup → login → dashboard) without standing up a backend.
 *
 * If you treat anything stored here as a real secret you will be sad.
 *
 * API:
 *   await Auth.signUp({ email, password, projectName }) → account
 *   await Auth.logIn({ email, password })               → account
 *   Auth.logOut()
 *   Auth.session()        → email | null
 *   Auth.account()        → account | null
 *   Auth.saveAccount(a)   → persists, returns a
 *   Auth.requireAuth()    → redirects to /login if no session
 *   Auth.guestRedirect()  → redirects to /dashboard if already logged in
 */
(function (global) {
  'use strict';

  const enc = new TextEncoder();
  const SESSION_KEY = 'stile_session';
  const ACCOUNT_PREFIX = 'stile_account:';

  function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function genSalt() {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  }

  function genSecret() {
    return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  }

  async function hashPassword(password, salt) {
    // Web Crypto (crypto.subtle) is only exposed in a secure context — HTTPS
    // or localhost. Over plain http:// (e.g. a LAN/Tailscale IP) it's
    // undefined, which would otherwise surface as a cryptic
    // "Cannot read properties of undefined (reading 'importKey')".
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('Secure connection required: open this site over https:// (or http://localhost). ' +
        'Your browser only provides the Web Crypto API needed for accounts in a secure context.');
    }
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: 120000, hash: 'SHA-256' },
      keyMaterial, 256
    );
    return bytesToHex(new Uint8Array(bits));
  }

  function normalizeEmail(s) {
    return String(s || '').trim().toLowerCase();
  }

  function accountKey(email) {
    return ACCOUNT_PREFIX + normalizeEmail(email);
  }

  function loadAccount(email) {
    try { return JSON.parse(localStorage.getItem(accountKey(email)) || 'null'); }
    catch { return null; }
  }

  function saveAccount(account) {
    localStorage.setItem(accountKey(account.email), JSON.stringify(account));
    return account;
  }

  async function signUp({ email, password, projectName }) {
    email = normalizeEmail(email);
    if (!email || !email.includes('@')) throw new Error('Enter a valid email.');
    if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
    if (loadAccount(email)) throw new Error('An account with that email already exists.');
    const salt = genSalt();
    const passwordHash = await hashPassword(password, salt);
    const account = {
      email,
      salt,
      passwordHash,
      projectName: (projectName || email.split('@')[0]).slice(0, 60),
      secret: genSecret(),
      tier: 'easy',
      paths: '/agents,/api/data',
      ttl: 3600,
      honeypot: true,
      reputationFloor: 0,
      webhookOn: false,
      webhook: '',
      createdAt: Date.now(),
    };
    saveAccount(account);
    sessionStart(email);
    return account;
  }

  async function logIn({ email, password }) {
    email = normalizeEmail(email);
    const account = loadAccount(email);
    if (!account) throw new Error('No account found for that email.');
    const hash = await hashPassword(password, account.salt);
    if (hash !== account.passwordHash) throw new Error('Wrong password.');
    sessionStart(email);
    return account;
  }

  function sessionStart(email) {
    localStorage.setItem(SESSION_KEY, normalizeEmail(email));
  }

  function logOut() {
    localStorage.removeItem(SESSION_KEY);
  }

  function session() {
    return localStorage.getItem(SESSION_KEY) || null;
  }

  function account() {
    const s = session();
    return s ? loadAccount(s) : null;
  }

  function requireAuth() {
    if (!session()) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.replace('/login?next=' + next);
    }
  }

  function guestRedirect() {
    if (session()) location.replace('/dashboard');
  }

  function deleteAccount() {
    const s = session();
    if (s) localStorage.removeItem(accountKey(s));
    logOut();
  }

  function rotateSecret() {
    const a = account();
    if (!a) return null;
    a.secret = genSecret();
    saveAccount(a);
    return a;
  }

  global.Auth = {
    signUp, logIn, logOut, session, account, saveAccount,
    requireAuth, guestRedirect, deleteAccount, rotateSecret,
    genSecret,
  };
}(window));
