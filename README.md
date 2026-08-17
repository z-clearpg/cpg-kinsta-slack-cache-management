# Kinsta Slack Cache Manager

A simple Slack bot for clearing WordPress site cache on Kinsta hosting.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and configure:
   ```
   SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
   SLACK_SIGNING_SECRET=your-slack-signing-secret  
   KINSTA_API_KEY=your-kinsta-api-key
   PORT=3000
   ```

3. Create a Slack app at https://api.slack.com/apps:
   - Go to "Slash Commands" and create `/clear-cache` command
   - Set Request URL to your deployed function URL (e.g., `https://your-app.netlify.app/slack/events`)
   - Go to "OAuth & Permissions" and add Bot Token Scopes: `commands`, `chat:write`
   - Go to "Interactivity & Shortcuts":
     - Enable interactivity and set the Request URL to the same URL as the slash command
     - Under **Select Menus**, set the **Options Load URL** to that same URL. This is
       required — the site picker uses a type-ahead (`external_select`) that loads
       matching sites from this endpoint as you type.
   - Install app to your workspace and copy the "Bot User OAuth Token"

4. Get your Kinsta API key from MyKinsta dashboard

## Usage

Type `/clear-cache` (any text after it is ignored) to:
1. Start typing a site **name or domain** in the picker — it filters live sites as
   you type, matching against the site title and all of its domains (so you can find
   a site by domain even when the title doesn't match the domain).
2. Select the site (only **live** environments are shown — staging is never listed).
3. Click **Yes, clear cache** to confirm.

The bot then **polls Kinsta until the clear actually completes** and reports real
success or failure — it won't claim success prematurely.

> Note: clearing directly from the slash command (e.g. `/clear-cache clear-pg.com`)
> is intentionally not supported. On Netlify's Lambda runtime, Bolt's
> `AwsLambdaReceiver` doesn't acknowledge the command until the whole handler
> finishes, so doing the clear inline exceeded Slack's 3-second limit
> (`operation_timeout`). The clear runs from the interactive **button** instead,
> which Slack doesn't hold to that limit.

## Architecture

Shared logic lives in `lib/` so the two entry points stay in sync:
- `lib/kinsta.js` — Kinsta API client, live-environment fetching + search text,
  cache clearing, and operation-status polling.
- `lib/slack-handlers.js` — all Slack command/option/action handlers.
- `index.js` — standalone HTTP server (Bolt) for Node hosting.
- `netlify/functions/slack-bot.js` — serverless entry point (AWS Lambda receiver).

## Deployment

### Netlify Functions
Deploy as a Netlify function for serverless hosting.

### Other Platforms
Works on any Node.js hosting platform (Heroku, Railway, etc.)