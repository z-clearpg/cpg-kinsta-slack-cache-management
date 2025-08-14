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
   - Go to "Interactivity & Shortcuts" and enable interactivity
   - Set Request URL to the same URL as slash command
   - Install app to your workspace and copy the "Bot User OAuth Token"

4. Get your Kinsta API key from MyKinsta dashboard

## Usage

In Slack, type `/clear-cache` to:
1. See a dropdown of your Kinsta sites
2. Select a site
3. Confirm cache clearing
4. Get success/error feedback

## Deployment

### Netlify Functions
Deploy as a Netlify function for serverless hosting.

### Other Platforms
Works on any Node.js hosting platform (Heroku, Railway, etc.)