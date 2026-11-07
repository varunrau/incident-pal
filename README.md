# Incident Pal

A local TypeScript and Fastify demo for [Incident collaborator](https://app.notion.com/p/4113f4780ef48027b672ea7e37a6d41d). The UI follows the compact [dashboard](https://app.paper.design/file/01M6VHFGCTHKNCWPS5MDAE31JH/p-3-0) and [chat](https://app.paper.design/file/01M6VHFGCTHKNCWPS5MDAE31JH/p-2-0) Paper layouts.

## Run locally

Use Node.js 22 or newer. Set `AMPERSAND_API_KEY` in `.env` or the shell before starting the server.

```sh
npm ci
npm start
```

Open [the dashboard](http://127.0.0.1:3000). Set `PORT` to change the port. Run `npm run check` for a type check.

1. Open **Request logs** to watch four shoppers send real HTTP requests to `GET /shop/products`, `POST /shop/cart`, and `POST /shop/checkout`.
2. Open **Feature flags** and turn on **Strict payment validation**. Some payments start returning HTTP 502 while others continue to succeed.
3. Open **Errors** and select a failed payment. Use its flow ID to compare the cart and payment logs, then compare with a successful checkout. The chart stacks error and non-error entries in 5-second buckets.
4. Return to **Feature flags** and turn off **Strict payment validation** to restore successful payments. The chart marks both flag changes, and earlier errors age out after two minutes.

| Flag | Default | Effect when on |
| --- | --- | --- |
| Order receipts | On | Adds a receipt ID to the checkout response. |
| Cart item details | Off | Adds the product and quantity to the cart response. |
| Strict payment validation | Off | Checks the payment currency against the cart quote. |

Flags apply to new requests immediately. Each request captures a snapshot for its handler and log entry. Flag state, change history, carts, and the most recent 10,000 request logs are held in memory and reset on restart. The server binds to loopback by default.

## Multiplayer chat

Open [Chat](http://127.0.0.1:3000/chat) in two browsers and join with different display names. Choose a channel and press **Enter** to send. Messages appear in the other browser as they arrive, with the sender and timestamp.

Choose **New channel** (the plus next to the channel list) to create a channel. It appears in every connected browser, and the new channel opens for you. Custom channels are stored in memory and reset on restart.

Use `#incident-response` for technical discussion and `#global-incident-status` for stakeholder updates. `#all-water-cooler`, `#eng-core-payments`, `#eng-growth`, and `#eng-fulfillment` each start with example messages. The server keeps the latest 100 messages per channel in memory and resets the chat to its initial state on restart.

For a demo with people on the same trusted network, run `HOST=0.0.0.0 npm start` and share `http://<your-local-ip>:3000/chat`. Display names are per browser tab. Anyone who can reach the demo can join its channels and use the dashboard.

## Ampersand incident agent

The app uses one [Ampersand](https://ampersand.humansand.ai/docs/GUIDES.html) agent by default. Set `AMPERSAND_MODE=multi` to enable delegation in the same session. Hosted multi-agent runs can stall on a provider-owned group action. `AMPERSAND_BASE_URL` and `AMPERSAND_MODEL` default to the hosted API and `ampersand-v0.1`.

1. Open **Chat** and join with a display name. Turn on **Strict payment validation** in **Feature flags**.
2. Ask Ampersand to investigate in **#incident-response** once failures appear in **Request logs**.
3. Ampersand can disable **Strict payment validation** if it finds that the flag caused the failures.
4. Ask Ampersand to check the payment logs after mitigation. Look in **#global-incident-status** for impact or recovery updates based on what it observed.
5. Unrelated messages can receive a silent pass.

Ampersand can turn any feature flag on or off at its discretion. Flag history records changes made by the agent. Chat and delivery receipts are held in memory.

One Ampersand session receives new human messages across all channels. The agent reads retained chat history, payment logs, and flag history as needed and decides whether to post a status update. Agent posts return as tool receipts.

### Tool interface

`GET /api/tools` lists the Ampersand tool schemas. The read-only HTTP endpoints support `POST /api/tools/<name>` with a JSON object.

| Tool | Example input |
| --- | --- |
| `list_channels` | `{}` |
| `read_channel` | `{"channel":"incident-response","limit":10}` |
| `query_logs` | `{"level":"error","step":"Pay","limit":10}` |
| `tail_logs` | `{"level":"error"}`, then `{"level":"error","after":42}` using the returned cursor |
| `get_flags` | `{}` |
| `get_flag_history` | `{"flag":"strict_payment_validation"}` |

`read_channel` and `query_logs` return newest first. Pass `nextBefore` as `before` for older results. `tail_logs` returns oldest first within a batch. Poll with the returned cursor and the same filters. `missed` indicates that some entries aged out. Use `snapshotId` from `get_flags` as `expectedSnapshotId` for `update_flag`.

`update_flag`, `send_message`, and `pass` run inside the authenticated Ampersand session bridge.
