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

### 4. Sign requests with HMAC

Your integration must include an `X-OpenBrain-Signature` header with the format:

```
sha256=<hex-encoded HMAC-SHA256 of request body using your webhook secret>
```

### 5. Request format

```bash
curl -X POST https://<your-project>.supabase.co/functions/v1/capture \
  -H "Content-Type: application/json" \
  -H "X-OpenBrain-Signature: sha256=<computed-hmac>" \
  -d '{"text": "The message content", "source": "slack"}'
```

### 6. Middleware option

If your Slack app cannot compute HMAC signatures directly, deploy a small middleware (Cloudflare Worker, AWS Lambda, etc.) that:

1. Receives Slack's webhook payload
2. Extracts the message text
3. Computes the HMAC signature
4. Forwards to your capture endpoint

This keeps your webhook secret out of Slack's configuration.
