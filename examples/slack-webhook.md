# Slack Webhook Integration

Pipe Slack messages into Open Brain via the capture Edge Function.

## How it works

```
Slack Channel -> Outgoing Webhook -> Open Brain /capture endpoint
```

Slack sends the message text to your Supabase Edge Function. The function authenticates via HMAC signature, generates embeddings and metadata, and stores the memory.

## Setup

### 1. Get your capture endpoint URL

```
https://<your-project>.supabase.co/functions/v1/capture
```

### 2. Generate a webhook secret

```bash
openssl rand -hex 32
```

Set this as `CAPTURE_WEBHOOK_SECRET` in your Supabase secrets:

```bash
supabase secrets set CAPTURE_WEBHOOK_SECRET=<your-generated-secret>
```

### 3. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app.
2. Under **Event Subscriptions**, enable events and set the Request URL to your capture endpoint.
3. Alternatively, use **Outgoing Webhooks** (legacy) if you prefer channel-specific triggers.

### 4. Sign requests with HMAC + timestamp

Your integration must include two headers for replay-protected authentication:

- `X-OpenBrain-Timestamp` — current Unix epoch in seconds
- `X-OpenBrain-Signature` — HMAC-SHA256 of `<timestamp>.<body>` (not just the body)

The signature format:

```
sha256=<hex-encoded HMAC-SHA256 of "<timestamp>.<request-body>" using your webhook secret>
```

Requests older than 5 minutes are rejected.

### 5. Request format

```bash
TIMESTAMP=$(date +%s)
BODY='{"text": "The message content", "source": "slack"}'
SIGNATURE=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "<your-webhook-secret>" | awk '{print $2}')

curl -X POST https://<your-project>.supabase.co/functions/v1/capture \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Timestamp: ${TIMESTAMP}" \
  -H "X-OpenBrain-Signature: sha256=${SIGNATURE}" \
  -d "${BODY}"
```

### 6. Middleware option

If your Slack app cannot compute HMAC signatures directly, deploy a small middleware (Cloudflare Worker, AWS Lambda, etc.) that:

1. Receives Slack's webhook payload
2. Extracts the message text
3. Computes the HMAC signature with timestamp (sign `<timestamp>.<body>`)
4. Forwards to your capture endpoint with both headers

This keeps your webhook secret out of Slack's configuration.
