# examples/agent-market — full-flavor demo

A small fake "shopping API for AI agents." Demonstrates STILE in a
realistic-shaped app: human landing page on `/`, a gated agent surface
under `/api/data` and `/api/order`, and a Discord notifier on every
verification + order.

## What this example demonstrates

- Combining `createStile` with custom downstream routes.
- `tier: 'strong'` — challenges require both the word AND a self-declared
  agent identifier. The agent-market wants to know *who* is ordering,
  even though the identifier is unverified.
- The `onVerify` hook used for app-specific notification (Discord
  formatting), distinct from the generic `webhook` channel.
- Multiple protected paths under one stile instance.
- A companion script `walk-as-claude.js` that performs the verify
  handshake from a script, simulating an AI client.

## What this example does NOT demonstrate

- A real, persistent store. Restart wipes the order log.
- A real production secret. The fallback string is a dev placeholder
  and STILE will warn at boot.
- Cross-process safety. One process only.
- Authentication of the agent identifier — `agent=acme/buyer-1` is not
  verified to be ACME.
- Authorization of orders. The example accepts any order from any
  verified agent. A real shopping API would have payment + identity
  layers behind STILE.

## Discord webhook

The example sends notifications to a Discord webhook **only if** the
env var `AGENT_MARKET_DISCORD_WEBHOOK` is set. Without it, Discord
calls are skipped — the rest of the example works fine.

If you previously had a hardcoded webhook in this file (earlier
versions did), **rotate it**: open the channel's Integrations →
Webhooks settings in Discord and delete the old hook before relying on
this code in any environment where the URL might leak.

## Run

```bash
node examples/agent-market/server.js
# → http://localhost:3001
```

Then walk the handshake as an agent:

```bash
node examples/agent-market/walk-as-claude.js
```

## Contract

Tracks the public API documented in
[`docs/API.md`](../../docs/API.md). The Discord notifier is example-
specific and has no contract beyond "fire-and-forget HTTP POST."
