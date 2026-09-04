# Kick Developer Documentation

## App Setup

1. **Sign up** for a KICK account and review [Developer Terms](https://kick.com/terms/developer)
2. **Enable 2FA** in Kick Account settings
3. **Navigate** to [Developer tab](https://kick.com/settings/developer)
4. **Create an app** → generates `client_id`, `client_secret`, `redirect_uri`
5. **Build** using the API documentation
6. **Launch** 🚀

Help or contribute? See [Contributing Guide](/how-do-i-contribute/contributing.md)

---

## OAuth 2.1

### Token Types

| Token | Flow | Use Case |
|-------|------|----------|
| **App Access Token** | Client Credentials | Server-to-server, public data only |
| **User Access Token** | Authorization Code + PKCE | User-specific data, act on user's behalf |

### OAuth Server

**Base URL:** `https://id.kick.com` (different from API server `https://api.kick.com`)

---

### Authorization Endpoint

`GET /oauth/authorize`

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `client_id` | Yes | string | Your app's client ID |
| `response_type` | Yes | string | `code` |
| `redirect_uri` | Yes | uri | Must match app settings exactly |
| `state` | Yes | string | Random string for CSRF protection |
| `scope` | Yes | string | Space-separated scopes |
| `code_challenge` | Yes | string | PKCE code challenge |
| `code_challenge_method` | Yes | string | `S256` |

**Response (200):** Redirects to `redirect_uri?code=<code>&state=<state>`

**Example:**
```
GET https://id.kick.com/oauth/authorize?
  response_type=code&
  client_id=<client_id>&
  redirect_uri=https://yourapp.com/callback&
  scope=user:read channel:read&
  code_challenge=<challenge>&
  code_challenge_method=S256&
  state=<random>
```

> **Workaround for `127.0.0.1` redirect_uri:** Next.js rewrites the first `127.0.0.1` to `localhost`. Add a sacrificial query param before `redirect_uri`:
> ```
> GET https://id.kick.com/oauth/authorize?
>   response_type=code&
>   client_id=<id>&
>   redirect=127.0.0.1&
>   redirect_uri=http://127.0.0.1/callback&
>   ...
> ```

---

### Token Endpoint (User Access Token)

`POST /oauth/token`

**Headers:** `Content-Type: application/x-www-form-urlencoded`

| Parameter | Required | Description |
|-----------|----------|-------------|
| `code` | Yes | Code from authorization callback |
| `client_id` | Yes | Your client ID |
| `client_secret` | Yes | Your client secret |
| `redirect_uri` | Yes | Must match authorization request |
| `grant_type` | Yes | `authorization_code` |
| `code_verifier` | Yes | PKCE verifier |

**Response (200):**
```json
{
  "access_token": "",
  "token_type": "Bearer",
  "refresh_token": "",
  "expires_in": 3600,
  "scope": "user:read channel:read"
}
```

---

### App Access Token Endpoint

`POST /oauth/token` with `grant_type=client_credentials`

**Body:**
| Parameter | Required |
|-----------|----------|
| `client_id` | Yes |
| `client_secret` | Yes |
| `grant_type` | Yes (`client_credentials`) |

**Response (200):**
```json
{
  "access_token": "",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

---

### Refresh Token Endpoint

`POST /oauth/token` with `grant_type=refresh_token`

**Body:**
| Parameter | Required |
|-----------|----------|
| `refresh_token` | Yes |
| `client_id` | Yes |
| `client_secret` | Yes |
| `grant_type` | Yes (`refresh_token`) |

**Response:** Same as token endpoint (new access + refresh token)

---

### Revoke Token

`POST /oauth/revoke?token=<token>&token_hint_type=access_token|refresh_token`

**Headers:** `Content-Type: application/x-www-form-urlencoded`

**Response:** `200 OK`

---

### Token Introspect

`POST /oauth/token/introspect`

**Headers:** `Authorization: Bearer <access_token>`

**Response (200):**
```json
{
  "data": {
    "active": true,
    "client_id": "",
    "token_type": "user",  // "app" or "user"
    "scope": "user:read channel:read",
    "exp": 1771046347
  },
  "message": "OK"
}
```

---

## Scopes

| Scope | Description |
|-------|-------------|
| `user:read` | View user info (username, streamer ID, etc.) |
| `channel:read` | View channel info (description, category) |
| `channel:write` | Update livestream metadata |
| `channel:rewards:read` | Read channel points rewards |
| `channel:rewards:write` | Read, add, edit, delete rewards |
| `chat:write` | Send chat messages / bot posting |
| `streamkey:read` | Read stream URL and key |
| `events:subscribe` | Subscribe to channel events (chat, follows, subs) |
| `moderation:ban` | Ban/unban users |
| `moderation:chat_message:manage` | Moderate chat messages |
| `kicks:read` | View KICKs leaderboards |

---

## Categories

### Get Categories (Cursor Pagination)

`GET /public/v1/categories`

| Param | Type | Description |
|-------|------|-------------|
| `cursor` | string | Pagination cursor |
| `limit` | int | Results per page (max 100) |
| `names` | string | Comma-separated category names |
| `tags` | string | Comma-separated tags |
| `ids` | string | Comma-separated category IDs |

**Auth:** App or User Access Token

---

### Get Categories (Search - Deprecated)

`GET /public/v1/categories?q=<query>&page=<n>`

> **Deprecated** — Use cursor pagination endpoint above.

---

## Users

### Get Users

`GET /public/v1/users`

| Param | Type | Description |
|-------|------|-------------|
| `ids` | string | Comma-separated user IDs (optional; defaults to authenticated user) |

**Auth:** User Access Token (`user:read`) or App Access Token

---

## Channels

### Get Channel Info

`GET /public/v1/channels`

| Param | Type | Description |
|-------|------|-------------|
| `broadcaster_user_id` | int | Channel owner's user ID |

**Auth:** User Access Token (`channel:read`) or App Access Token

---

### Update Channel Metadata

`PATCH /public/v1/channels`

**Auth:** User Access Token (`channel:write`)

**Body:**
```json
{
  "broadcaster_user_id": 123,
  "title": "Stream Title",
  "category_id": 456,
  "language": "en",
  "has_mature_content": false
}
```

---

### Channel Rewards

| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| GET | `/public/v1/channels/rewards` | `channel:rewards:read` | List rewards |
| POST | `/public/v1/channels/rewards` | `channel:rewards:write` | Create reward |
| PATCH | `/public/v1/channels/rewards/{id}` | `channel:rewards:write` | Update reward |
| DELETE | `/public/v1/channels/rewards/{id}` | `channel:rewards:write` | Delete reward |

**Create/Update Body:**
```json
{
  "title": "Reward Title",
  "cost": 500,
  "description": "Description",
  "prompt": "User prompt",
  "is_enabled": true,
  "is_user_input_required": false,
  "max_per_stream": 10,
  "max_per_user_per_stream": 1,
  "global_cooldown_seconds": 60
}
```

---

### Get Channel Reward Redemptions

`GET /public/v1/channels/rewards/redemptions?reward_id=<id>&status=pending&cursor=<cursor>&limit=20`

**Auth:** User Access Token (`channel:rewards:read` or `channel:rewards:write`)

---

### Accept Redemptions

`POST /public/v1/channels/rewards/redemptions/accept`

**Body:**
```json
{ "ids": ["<redemption_id_1>", "..."] }
```
Max 25 IDs per request.

---

### Reject Redemptions

`POST /public/v1/channels/rewards/redemptions/reject`

**Body:**
```json
{ "ids": ["<redemption_id_1>", "..."] }
```
Max 25 IDs.

---

## Chat

### Post Chat Message

`POST /public/v1/chat`

**Auth:** User Access Token (`chat:write`)

**Body:**
```json
{
  "broadcaster_user_id": 123,    // required for user, ignored for bot
  "content": "Hello chat!",
  "type": "user",                // "user" or "bot"
  "reply_to_message_id": "uuid"  // optional
}
```

---

### Delete Chat Message

`DELETE /public/v1/chat/{message_id}`

**Auth:** User Access Token (`moderation:chat_message:manage`)

---

## Moderation

### Ban / Timeout User

`POST /public/v1/moderation/bans`

**Auth:** User Access Token (`moderation:ban`)

**Body:**
```json
{
  "broadcaster_user_id": 123,
  "user_id": 456,
  "duration": 10,        // minutes; omit for permanent ban
  "reason": "Spam"       // max 100 chars
}
```

---

### Unban / Remove Timeout

`DELETE /public/v1/moderation/bans?broadcaster_user_id=123&user_id=456`

**Auth:** User Access Token (`moderation:ban`)

---

## Livestreams

### Get Livestreams (Cursor Pagination)

`GET /public/v1/livestreams`

| Param | Type | Description |
|-------|------|-------------|
| `cursor` | string | Pagination cursor |
| `limit` | int | Results per page (max 100) |

**Auth:** App or User Access Token

---

### Get Livestreams (Filterable - Deprecated)

`GET /public/v1/livestreams?broadcaster_user_id=123&category_id=456&language=en&limit=50&sort=viewer_count`

> **Deprecated** — Use cursor pagination endpoint.

---

### Get Livestream Stats

`GET /public/v1/livestreams/stats`

**Auth:** App or User Access Token

**Response:**
```json
{
  "data": { "total_count": 12345 },
  "message": "OK"
}
```

---

## Public Key

### Get Public Key

`GET /public/v1/public-key`

**Response:**
```json
{
  "data": { "public_key": "-----BEGIN PUBLIC KEY-----\n..." },
  "message": "OK"
}
```

Used for webhook signature verification.

---

## KICKs

### Get KICKs Leaderboard

`GET /public/v1/kicks/leaderboard`

**Auth:** User Access Token (`kicks:read`)

**Response:** Leaderboard for week, month, lifetime with `rank`, `user_id`, `username`, `gifted_amount`.

---

## Events (Webhooks)

### Setup

1. Go to [Developer Settings](https://kick.com/settings/developer)
2. Enable Webhooks → enter public HTTPS URL
3. Subscribe to events via API

> **Localhost?** Use Cloudflare Tunnel, ngrok, etc.

---

### Headers

| Header | Type | Description |
|--------|------|-------------|
| `Kick-Event-Message-Id` | ULID | Unique message ID (idempotency key) |
| `Kick-Event-Subscription-Id` | ULID | Subscription ID |
| `Kick-Event-Signature` | Base64 | RSA-SHA256 signature |
| `Kick-Event-Message-Timestamp` | RFC3339 | Event timestamp |
| `Kick-Event-Type` | string | e.g. `chat.message.sent` |
| `Kick-Event-Version` | string | e.g. `1` |

---

### Signature Verification

**Public Key:** `https://api.kick.com/public/v1/public-key`

```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq/+l1WnlRrGSolDMA+A8
6rAhMbQGmQ2SapVcGM3zq8ANXjnhDWocMqfWcTd95btDydITa10kDvHzw9WQOqp2
MZI7ZyrfzJuz5nhTPCiJwTwnEtWft7nV14BYRDHvlfqPUaZ+1KR4OCaO/wWIk/rQ
L/TjY0M70gse8rlBkbo2a8rKhu69RQTRsoaf4DVhDPEeSeI5jVrRDGAMGL3cGuyY
6CLKGdjVEM78g3JfYOvDU/RvfqD7L89TZ3iN94jrmWdGz34JNlEI5hqK8dd7C5EF
BEbZ5jgB8s8ReQV8H+MkuffjdAj3ajDDX3DOJMIut1lBrUVD1AaSrGCKHooWoL2e
twIDAQAB
-----END PUBLIC KEY-----
```

**Signature Algorithm:**
```
signed_string = "{message_id}.{timestamp}.{raw_body}"
signature = RSA_SHA256(private_key, signed_string)
```

**Go Verification Example:**
```go
func Verify(pubKey *rsa.PublicKey, messageID, timestamp string, body, sigB64 []byte) error {
    sig, _ := base64.StdEncoding.DecodeString(string(sigB64))
    signed := []byte(fmt.Sprintf("%s.%s.%s", messageID, timestamp, string(body)))
    hashed := sha256.Sum256(signed)
    return rsa.VerifyPKCS1v15(pubKey, crypto.SHA256, hashed[:], sig)
}
```

---

### Webhook Disabling

If webhook fails for >24 hours, Kick auto-unsubscribes. Resubscribe via API.

---

### Event Subscriptions

#### List Subscriptions

`GET /public/v1/events/subscriptions`

#### Subscribe

`POST /public/v1/events/subscriptions`

**Auth:** App Access Token or User Access Token (`events:subscribe`)

**Body:**
```json
{
  "name": "chat.message.sent",
  "version": 1,
  "broadcaster_user_id": 123,  // required for App token
  "method": "webhook"
}
```

> Limits: 10,000 subscriptions/event/app. `chat.message.sent` limited to 1,000 for unverified apps.

#### Unsubscribe

`DELETE /public/v1/events/subscriptions?id=<sub_id_1>&id=<sub_id_2>`

---

## Webhook Payloads

### Event Types

| Event | Name | Version | Description |
|-------|------|---------|-------------|
| Chat Message | `chat.message.sent` | 1 | Message sent in chat |
| Channel Follow | `channel.followed` | 1 | User followed channel |
| Subscription Renewal | `channel.subscription.renewal` | 1 | Subscription renewed |
| Subscription Gifts | `channel.subscription.gifts` | 1 | Gifted subscriptions |
| Subscription Created | `channel.subscription.new` | 1 | New subscription |
| Reward Redemption | `channel.reward.redemption.updated` | 1 | Reward redeemed |
| Stream Status | `livestream.status.updated` | 1 | Stream started/ended |
| Stream Metadata | `livestream.metadata.updated` | 1 | Title/category changed |
| Moderation Ban | `moderation.banned` | 1 | User banned/timed out |
| KICKs Gifted | `kicks.gifted` | 1 | KICKs gifted to streamer |

---

### Chat Message

```json
{
  "message_id": "uuid",
  "replies_to": { "message_id": "uuid", "content": "...", "sender": {...} },
  "broadcaster": { "user_id": 123, "username": "...", "is_verified": true, ... },
  "sender": {
    "user_id": 456,
    "username": "...",
    "identity": {
      "username_color": "#FF5733",
      "badges": [{ "text": "Moderator", "type": "moderator" }]
    }
  },
  "content": "Hello [emote:4148074:HYPERCLAP]",
  "emotes": [{ "emote_id": "4148074", "positions": [{ "s": 6, "e": 30 }] }],
  "created_at": "2025-01-14T16:08:06Z"
}
```

---

### Channel Follow

```json
{
  "broadcaster": { "user_id": 123, "username": "...", "is_verified": true, ... },
  "follower": { "user_id": 456, "username": "...", "is_verified": false, ... }
}
```

---

### Subscription Renewal

```json
{
  "broadcaster": { "user_id": 123, "username": "...", "is_verified": true, ... },
  "subscriber": { "user_id": 456, "username": "...", "is_verified": false, ... },
  "duration": 3,
  "created_at": "2025-01-14T16:08:06Z",
  "expires_at": "2025-02-14T16:08:06Z"
}
```

---

### Subscription Gifts

```json
{
  "broadcaster": { "user_id": 123, "username": "...", ... },
  "gifter": { "user_id": 456, "username": "...", "is_anonymous": false, ... },
  "giftees": [{ "user_id": 789, "username": "...", "is_anonymous": false, ... }],
  "created_at": "2025-01-14T16:08:06Z",
  "expires_at": "2025-02-14T16:08:06Z"
}
```

---

### Subscription Created

```json
{
  "broadcaster": { "user_id": 123, "username": "...", "is_verified": true, ... },
  "subscriber": { "user_id": 456, "username": "...", "is_verified": false, ... },
  "duration": 1,
  "created_at": "2025-01-14T16:08:06Z",
  "expires_at": "2025-02-14T16:08:06Z"
}
```

---

### Channel Reward Redemption Updated

```json
{
  "id": "01KBHE78QE4HZY1617DK5FC7YD",
  "user_input": "unban me",
  "status": "rejected",  // "pending" | "accepted" | "rejected"
  "redeemed_at": "2025-12-02T22:54:19.323Z",
  "reward": { "id": "...", "title": "Unban Request", "cost": 1000, "description": "..." },
  "redeemer": { "user_id": 123, "username": "naughty-user", ... },
  "broadcaster": { "user_id": 333, "username": "gigachad", ... }
}
```

---

### Livestream Status Updated

**Stream Started:**
```json
{
  "broadcaster": { "user_id": 123, "username": "...", ... },
  "is_live": true,
  "title": "Stream Title",
  "started_at": "2025-01-01T11:00:00+11:00",
  "ended_at": null
}
```

**Stream Ended:**
```json
{
  "broadcaster": { "user_id": 123, "username": "...", ... },
  "is_live": false,
  "title": "Stream Title",
  "started_at": "2025-01-01T11:00:00+11:00",
  "ended_at": "2025-01-01T15:00:00+11:00"
}
```

---

### Livestream Metadata Updated

```json
{
  "broadcaster": { "user_id": 123, "username": "...", ... },
  "metadata": {
    "title": "New Title",
    "language": "en",
    "has_mature_content": true,
    "category": { "id": 123, "name": "Category", "thumbnail": "..." }
  }
}
```

---

### Moderation Banned

```json
{
  "broadcaster": { "user_id": 123, "username": "...", ... },
  "moderator": { "user_id": 456, "username": "...", ... },
  "banned_user": { "user_id": 789, "username": "...", ... },
  "metadata": {
    "reason": "spam",
    "created_at": "2025-01-14T16:08:05Z",
    "expires_at": "2025-01-14T16:10:06Z"  // null = permanent
  }
}
```

---

### KICKs Gifted

```json
{
  "broadcaster": { "user_id": 123, "username": "...", "is_verified": true, ... },
  "sender": { "user_id": 456, "username": "gift_sender", ... },
  "gift": {
    "amount": 500,
    "name": "Rage Quit",
    "type": "LEVEL_UP",
    "tier": "MID",
    "message": "w",
    "pinned_time_seconds": 600
  },
  "created_at": "2025-10-20T04:00:08.634Z"
}
```

---

## Organization Management

### When to Use
- Running Drops campaigns
- Managing team developer access
- (Soon) Managing OAuth apps as a group

### Registration
Email `developers@kick.com` with:
- Organization name & URL
- Logo URL
- Stream category to claim
- Member Kick usernames (all with 2FA)
- OAuth app client ID
- Webhook URL for reward claims
- Connection page URL

### Roles
- **Owner** (only role currently) — can add/remove any member, cannot remove self

### Management
- Add members via username (must have Kick account + 2FA)
- Remove via Members page

### Support
Email `developers@kick.com`

---

## FAQ

### App Verification
**Benefits:** Verified badge, chat subscription limit 1,000 → 10,000

**Request:** Email `developers@kick.com` with:
- Client ID
- App name
- Bot verification needed?
- Reason (growth, impersonation, subscription limit)
- Evidence (website, metrics, impersonation examples)

---

### Testing APIs Without Hosting
1. Get OAuth credentials from Developer settings
2. Go to any endpoint in docs → click "Test it"
3. **UserAccessToken:** Set redirect to `https://docs.kick.com`, enable PKCE (SHA-256), select scopes, click Authorize
4. **AppAccessToken:** Enter client ID/secret, click Authorize
5. Click "Send"

---
# Webhook Payloads

## Events

<table data-full-width="true"><thead><tr><th width="316.08984375">Event</th><th width="327.64453125">Name</th><th width="99.72265625" data-type="number">Version</th><th>Description</th></tr></thead><tbody><tr><td><a href="#chat-message">Chat Message</a></td><td><code>chat.message.sent</code></td><td>1</td><td>Fired when a message has been sent in a stream's chat.</td></tr><tr><td><a href="#channel-follow">Channel Follow</a></td><td><code>channel.followed</code></td><td>1</td><td>Fired when a user follows a channel.</td></tr><tr><td><a href="#channel-subscription-renewal">Channel Subscription Renewal</a></td><td><code>channel.subscription.renewal</code></td><td>1</td><td>Fired when a user's subscription to a channel is renewed.</td></tr><tr><td><a href="#channel-subscription-gifts">Channel Subscription Gifts</a></td><td><code>channel.subscription.gifts</code></td><td>1</td><td>Fired when a user gifts subscriptions to a channel.</td></tr><tr><td><a href="#channel-subscription-created">Channel Subscription Created</a></td><td><code>channel.subscription.new</code></td><td>1</td><td>Fired when a user first subscribes to a channel.</td></tr><tr><td><a data-mention href="#channel-reward-redemption-updated">#channel-reward-redemption-updated</a></td><td><code>channel.reward.redemption.updated</code></td><td>1</td><td>Fired when a channel reward is redeemed by a user.</td></tr><tr><td><a href="#livestream-status-updated">Livestream Status Updated</a></td><td><code>livestream.status.updated</code></td><td>1</td><td>Fired when a stream's status has been updated. For example, a stream could have started or ended</td></tr><tr><td><a href="#livestream-metadata-updated">Livestream Metadata Updated</a></td><td><code>livestream.metadata.updated</code></td><td>1</td><td>Fired when a stream's metadata has been updated. For example, a stream's title could have changed.</td></tr><tr><td><a href="#moderation-banned">Moderation Banned</a></td><td><code>moderation.banned</code></td><td>1</td><td>Fired when a user has been banned from a channel.</td></tr><tr><td><a href="#kicks-gifted">Kicks Gifted</a></td><td><code>kicks.gifted</code></td><td>1</td><td>Fired when a user gifts kicks to a channel.</td></tr></tbody></table>

### Chat Message

```json
Headers
- Kick-Event-Type: “chat.message.sent”
- Kick-Event-Version: “1”

{
  "message_id": "unique_message_id_123",
  "replies_to": {
    "message_id": "unique_message_id_456",
    "content": "This is the parent message!",
    "sender": {
      "is_anonymous": false,
      "user_id": 12345,
      "username": "parent_sender_name",
      "is_verified": false,
      "profile_picture": "https://example.com/parent_sender_avatar.jpg",
      "channel_slug": "parent_sender_channel",
      "identity": null // no identity for sender in replies_to at the moment
    },
  },
  "broadcaster": {
    "is_anonymous": false,
    "user_id": 123456789,
    "username": "broadcaster_name",
    "is_verified": true,
    "profile_picture": "https://example.com/broadcaster_avatar.jpg",
    "channel_slug": "broadcaster_channel",
    "identity": null // no identity for broadcasters at the moment
  },
  "sender": {
    "is_anonymous": false,
    "user_id": 987654321,
    "username": "sender_name",
    "is_verified": false,
    "profile_picture": "https://example.com/sender_avatar.jpg",
    "channel_slug": "sender_channel",
    "identity": {
      "username_color": "#FF5733",
      "badges": [
        {
          "text": "Moderator",
          "type": "moderator",
        },
        {
          "text": "Sub Gifter",
          "type": "sub_gifter",
          "count": 5,
        },
        {
          "text": "Subscriber",
          "type": "subscriber",
          "count": 3,
        }
      ]
    }
  },
  "content": "Hello [emote:4148074:HYPERCLAP] [emote:4148074:HYPERCLAP] [emote:37226:KEKW]",
  "emotes": [
    {
      "emote_id": "4148074",
      "positions": [
        { "s": 6, "e": 30 },
        { "s": 32, "e": 56 }
      ]
    },
    {
      "emote_id": "37226",
      "positions": [
        { "s": 58, "e": 75 }
      ]
    }
  ],
  "created_at": "2025-01-14T16:08:06Z"
}
```

### Channel Follow

```json
Headers
- Kick-Event-Type: “channel.followed”
- Kick-Event-Version: “1”

{
  "broadcaster": {
    "is_anonymous": false,
    "user_id": 123456789,
    "username": "broadcaster_name",
    "is_verified": true,
    "profile_picture": "https://example.com/broadcaster_avatar.jpg",
    "channel_slug": "broadcaster_channel",
    "identity": null
  },
  "follower": {
    "is_anonymous": false,
    "user_id": 987654321,
    "username": "follower_name",
    "is_verified": false,
    "profile_picture": "https://example.com/sender_avatar.jpg",
    "channel_slug": "follower_channel",
    "identity": null
  }
}
```

### Channel Subscription Renewal

```json
Headers
- Kick-Event-Type: “channel.subscription.renewal”
- Kick-Event-Version: “1”

{
  "broadcaster": {
    "is_anonymous": false,
    "user_id": 123456789,
    "username": "broadcaster_name",
    "is_verified": true,
    "profile_picture": "https://example.com/broadcaster_avatar.jpg",
    "channel_slug": "broadcaster_channel",
    "identity": null
  },
  "subscriber": {
    "is_anonymous": false,
    "user_id": 987654321,
    "username": "subscriber_name",
    "is_verified": false,
    "profile_picture": "https://example.com/sender_avatar.jpg",
    "channel_slug": "subscriber_channel",
    "identity": null
  },
  "duration": 3,
  "created_at": "2025-01-14T16:08:06Z",
  "expires_at": "2025-02-14T16:08:06Z"
}
```

### Channel Subscription Gifts

```json
Headers
- Kick-Event-Type: “channel.subscription.gifts”
- Kick-Event-Version: “1”

Public Gift Structure
{
  "broadcaster": {
    "is_anonymous": false,
    "user_id": 123456789,
    "username": "broadcaster_name",
    "is_verified": true,    
    "profile_picture": "https://example.com/broadcaster_avatar.jpg",
    "channel_slug": "broadcaster_channel",
    "identity": null
  },
  "gifter": {
    "is_anonymous": false,
    "user_id": 987654321, // null if is_anonymous=true
    "username": "gifter_name", // null if is_anonymous=true
    "is_verified": false, // null if is_anonymous=true
    "profile_picture": "https://example.com/sender_avatar.jpg", // null if is_anonymous=true
    "channel_slug": "gifter_channel", // null if is_anonymous=true
    "identity": null // null if is_anonymous=true
  },
  "giftees": 
  [
    {
      "is_anonymous": false,
      "user_id": 561654654,
      "username": "giftee_name",
      "is_verified": true,
      "profile_picture": "https://example.com/broadcaster_avatar.jpg",
      "channel_slug": "giftee_channel",
      "identity": null
    }
  ],
  "created_at": "2025-01-14T16:08:06Z",
  "expires_at": "2025-02-14T16:08:06Z"
}
```

### Channel Subscription Created

```json
Headers
- Kick-Event-Type: “channel.subscription.new”
- Kick-Event-Version: “1”

{
  "broadcaster": {
    "is_anonymous": false,
    "user_id": 123456789,
    "username": "broadcaster_name",
    "is_verified": true,
    "profile_picture": "https://example.com/broadcaster_avatar.jpg",
    "channel_slug": "broadcaster_channel",
    "identity": null
  },
  "subscriber": {
    "is_anonymous": false,
    "user_id": 987654321,
    "username": "subscriber_name",
    "is_verified": false,
    "profile_picture": "https://example.com/sender_avatar.jpg",
    "channel_slug": "subscriber_channel",
    "identity": null
  },
  "duration": 1,
  "created_at": "2025-01-14T16:08:06Z",
  "expires_at": "2025-02-14T16:08:06Z"
}
```

### Channel Reward Redemption Updated

The `status` field is limited to one of the following three `string` values:

* `"pending"`&#x20;
* `"accepted"`&#x20;
* `"rejected"`&#x20;

```json
Headers
- Kick-Event-Type: "channel.reward.redemption.updated"
- Kick-Event-Version: “1”

{
  "id": "01KBHE78QE4HZY1617DK5FC7YD",
  "user_input": "unban me",
  "status": "rejected",
  "redeemed_at": "2025-12-02T22:54:19.323Z",
  "reward": {
    "id": "01KBHE7RZNHB0SKDV1H86CD4F3",
    "title": "Uban Request",
    "cost": 1000,
    "description": "Only good reasons pls"
  },
  "redeemer": {
    "user_id": 123,
    "username": "naughty-user",
    "is_verified": false,
    "profile_picture": "",
    "channel_slug": "naughty_user"
  },
  "broadcaster": {
    "user_id": 333,
    "username": "gigachad",
    "is_verified": true,
    "profile_picture": "",
    "channel_slug": "gigachad"
  }
}
```

### Livestream Status Updated

#### Stream started

```json
Headers
- Kick-Event-Type: "livestream.status.updated"
- Kick-Event-Version: “1”

{
  "broadcaster": {
    "is_anonymous": false,
    "user_id": 123456789,
    "username": "broadcaster_name",
    "is_verified": true,
    "profile_picture": "https://example.com/broadcaster_avatar.jpg",
    "channel_slug": "broadcaster_channel",
    "identity": null
  },
  "is_live": true,
  "title": "Stream Title",
  "started_at": "2025-01-01T11:00:00+11:00",
  "ended_at": null
}
```

#### Stream ended

```json
Headers
- Kick-Event-Type: "livestream.status.updated"
- Kick-Event-Version: “1”

{
  "broadcaster": {
    "is_anonymous": false,
    "user_id": 123456789,
    "username": "broadcaster_name",
    "is_verified": true,
    "profile_picture": "https://example.com/broadcaster_avatar.jpg",
    "channel_slug": "broadcaster_channel",
    "identity": null
  },
  "is_live": false,
  "title": "Stream Title",
  "started_at": "2025-01-01T11:00:00+11:00",
  "ended_at": "2025-01-01T15:00:00+11:00"
}
```

### Livestream Metadata Updated

```json
Headers
- Kick-Event-Type: "livestream.metadata.updated"
- Kick-Event-Version: “1”

{
  "broadcaster": {
    "is_anonymous": false,
    "user_id": 123456789,
    "username": "broadcaster_name",
    "is_verified": true,
    "profile_picture": "https://example.com/broadcaster_avatar.jpg",
    "channel_slug": "broadcaster_channel",
    "identity": null
  },
  "metadata": {
    "title": "Stream Title",
    "language": "en",
    "has_mature_content": true,
    "category": {
      "id": 123,
      "name": "Category name",
      "thumbnail": "http://example.com/image123"
    }
  }
}
```

### Moderation Banned

```json
Headers
- Kick-Event-Type: "moderation.banned"
- Kick-Event-Version: “1”

{
  "broadcaster": {
    "is_anonymous": false,
    "user_id": 123456789,
    "username": "broadcaster_name",
    "is_verified": true,
    "profile_picture": "https://example.com/broadcaster_avatar.jpg",
    "channel_slug": "broadcaster_channel",
    "identity": null
  },
  "moderator": {
    "is_anonymous": false,
    "user_id": 987654321,
    "username": "moderator_name",
    "is_verified": false,
    "profile_picture": "https://example.com/moderator_avatar.jpg",
    "channel_slug": "moderator_channel",
    "identity": null
  },
  "banned_user": {
    "is_anonymous": false,
    "user_id": 135790135,
    "username": "banned_user_name",
    "is_verified": false,
    "profile_picture": "https://example.com/banned_user_avatar.jpg",
    "channel_slug": "banned_user_channel",
    "identity": null
  },
  "metadata": {
    "reason": "banned reason",
    "created_at": "2025-01-14T16:08:05Z",
    "expires_at": "2025-01-14T16:10:06Z", // null for permanent bans
  }
}
```

### Kicks Gifted

<pre class="language-json"><code class="lang-json"><strong>Headers
</strong>- Kick-Event-Type: "kicks.gifted"
- Kick-Event-Version: “1”

{
  "broadcaster": {
    "user_id": 123456789,
    "username": "broadcaster_name",
    "is_verified": true,
    "profile_picture": "https://example.com/broadcaster_avatar.jpg",
    "channel_slug": "broadcaster_channel"
  },
  "sender": {
    "user_id": 987654321,
    "username": "gift_sender",
    "is_verified": false,
    "profile_picture": "https://example.com/sender_avatar.jpg",
    "channel_slug": "gift_sender_channel"
  },
  "gift": {
    "amount": 500,
    "name": "Rage Quit",
    "type": "LEVEL_UP",
    "tier": "MID",
    "message": "w",
    "pinned_time_seconds": 600 // 10 minutes
  },
  "created_at": "2025-10-20T04:00:08.634Z"
}
</code></pre>



## References

- [Token Generation (OAuth 2.1 Flow)](/getting-started/generating-tokens-oauth2-flow.md)
- [Webhook Security](/events/webhook-security.md)
- [Event Types Reference](https://github.com/KickEngineering/KickDevDocs/blob/main/events/event-types/README.md)
- [Public Key Endpoint](/apis/public-key.md)

