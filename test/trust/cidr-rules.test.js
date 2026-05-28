'use strict';

// CIDR rule validation and pre-parsing. Ensures invalid CIDR syntax throws at
// createRules() time rather than silently returning false during evaluation,
// and that pre-parsed BigInt matching produces the same results as the original.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRules, parseCIDR, matchCIDR } = require('../../lib/rules');

// --- parseCIDR ---

test('parseCIDR returns null for an exact-match IP (no prefix)', () => {
  assert.equal(parseCIDR('192.168.1.1'), null);
  assert.equal(parseCIDR('::1'), null);
});

test('parseCIDR returns { mask, maskedBase } for a valid IPv4 CIDR', () => {
  const p = parseCIDR('10.0.0.0/8');
  assert.ok(p !== null);
  assert.equal(typeof p.mask, 'bigint');
  assert.equal(typeof p.maskedBase, 'bigint');
});

test('parseCIDR returns parsed data for a valid IPv6 CIDR', () => {
  const p = parseCIDR('2001:db8::/32');
  assert.ok(p !== null);
  assert.equal(typeof p.mask, 'bigint');
});

test('parseCIDR throws on invalid IPv4 prefix (> 32)', () => {
  assert.throws(() => parseCIDR('10.0.0.0/33'), /Invalid CIDR prefix/);
});

test('parseCIDR throws on negative prefix', () => {
  assert.throws(() => parseCIDR('10.0.0.0/-1'), /Invalid CIDR prefix/);
});

test('parseCIDR throws on invalid IPv6 prefix (> 128)', () => {
  assert.throws(() => parseCIDR('::1/129'), /Invalid CIDR prefix/);
});

test('parseCIDR throws on a malformed base address', () => {
  assert.throws(() => parseCIDR('999.0.0.0/8'), /Invalid CIDR base/);
});

test('parseCIDR throws on a completely invalid string', () => {
  assert.throws(() => parseCIDR('not-an-ip'), /Invalid IP address/);
});

// --- createRules validation ---

test('createRules throws immediately on an ip rule with invalid CIDR', () => {
  assert.throws(
    () => createRules({ deny: [{ kind: 'ip', value: '10.0.0.0/33' }] }),
    /Invalid CIDR prefix/
  );
});

test('createRules throws immediately on an ip rule with bad base', () => {
  assert.throws(
    () => createRules({ deny: [{ kind: 'ip', value: '256.0.0.1/24' }] }),
    /Invalid CIDR/
  );
});

test('createRules does not throw for non-ip rule kinds', () => {
  assert.doesNotThrow(() => createRules({
    deny: [{ kind: 'country', value: 'XX' }],
    allow: [{ kind: 'agent', value: 'mybot/1.0' }],
  }));
});

// --- pre-parsed matching produces same results as original matchCIDR ---

const CASES = [
  { cidr: '10.0.0.0/8',    inRange: '10.1.2.3',   outRange: '11.0.0.1'   },
  { cidr: '192.168.1.0/24',inRange: '192.168.1.99',outRange: '192.168.2.1'},
  { cidr: '172.16.0.0/12', inRange: '172.20.1.1',  outRange: '172.32.0.1' },
];

for (const { cidr, inRange, outRange } of CASES) {
  test(`pre-parsed rule matches ${inRange} in ${cidr} (same as matchCIDR)`, () => {
    const rules = createRules({ deny: [{ kind: 'ip', value: cidr }] });
    const fakeReq = { headers: { 'x-forwarded-for': inRange }, socket: {} };
    assert.equal(rules.evaluate(fakeReq, {}).decision, 'deny');
    assert.equal(matchCIDR(inRange, cidr), true);
  });

  test(`pre-parsed rule correctly excludes ${outRange} from ${cidr}`, () => {
    const rules = createRules({ deny: [{ kind: 'ip', value: cidr }] });
    const fakeReq = { headers: { 'x-forwarded-for': outRange }, socket: {} };
    assert.equal(rules.evaluate(fakeReq, {}).decision, 'pass');
    assert.equal(matchCIDR(outRange, cidr), false);
  });
}
