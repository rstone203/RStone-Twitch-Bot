import 'dotenv/config';
import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { exchangeCode } from '@twurple/auth';

const {
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_REDIRECT_URI
} = process.env;

if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !TWITCH_REDIRECT_URI) {
  console.error('Missing Twitch app settings in .env.');
  process.exit(1);
}

const state = randomBytes(32).toString('hex');
let used = false;
const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
authUrl.searchParams.set('client_id', TWITCH_CLIENT_ID);
authUrl.searchParams.set('redirect_uri', TWITCH_REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', 'chat:read chat:edit moderator:manage:banned_users channel:read:redemptions channel:manage:redemptions');
authUrl.searchParams.set('state', state);
const app = express();

app.get('/', async (req, res) => {
  if (used) {
    return res.status(400).send('This authorization attempt has already been used.');
  }

  if (typeof req.query.state !== 'string') {
    return res.status(400).send('Missing authorization state.');
  }

  const received = Buffer.from(req.query.state);
  const expected = Buffer.from(state);

  if (received.length !== expected.length ||
      !timingSafeEqual(received, expected)) {
    return res.status(400).send('Authorization state did not match.');
  }

  if (typeof req.query.code !== 'string') {
    return res.status(400).send('Missing authorization code.');
  }

  used = true;

  try {
    const tokenData = await exchangeCode(
      TWITCH_CLIENT_ID,
      TWITCH_CLIENT_SECRET,
      req.query.code,
      TWITCH_REDIRECT_URI
    );

    const tokenFile = {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresIn: tokenData.expiresIn,
      obtainmentTimestamp: Date.now()
    };

    await writeFile(
      'data/twitch-tokens.json',
      JSON.stringify(tokenFile, null, 2),
      { mode: 0o600 }
    );

    res.send('Authorization succeeded! Tokens saved locally. You can close this tab.');
    console.log('Twitch authorization succeeded. Tokens saved locally.');
  } catch {
    res.status(500).send('Authorization failed. Check your local settings and try again.');
    console.error('Authorization failed; sensitive details withheld.');
  }
});

app.listen(3000, '127.0.0.1', () => {
  console.log('Local OAuth callback server ready on http://localhost:3000');
console.log('Open this authorization URL in your browser:');
console.log(authUrl.toString());
});
