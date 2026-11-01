import 'dotenv/config';
import { ApiClient } from '@twurple/api';
import { readFile } from 'node:fs/promises';
import { RefreshingAuthProvider } from '@twurple/auth';
import { ChatClient } from '@twurple/chat';
import {
  startRedemptionListener,
  getPendingRedemptions,
  fulfillPendingRedemption
} from './redemptions.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const {
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_BOT_USERNAME,
  TWITCH_CHANNEL,
  RIVALS_PLAYER_USERNAME
} = process.env;

if (
  !TWITCH_CLIENT_ID ||
  !TWITCH_CLIENT_SECRET ||
  !TWITCH_BOT_USERNAME ||
  !TWITCH_CHANNEL
) {
  console.error('Missing required settings in .env.');
  process.exit(1);
}

async function main() {
  const tokenData = JSON.parse(
    await readFile('data/twitch-tokens.json', 'utf8')
  );

  const authProvider = new RefreshingAuthProvider({
    clientId: TWITCH_CLIENT_ID,
    clientSecret: TWITCH_CLIENT_SECRET
  });

  authProvider.onRefresh(async (userId, newTokenData) => {
    const updatedTokens = {
      accessToken: newTokenData.accessToken,
      refreshToken: newTokenData.refreshToken,
      expiresIn: newTokenData.expiresIn,
      obtainmentTimestamp: newTokenData.obtainmentTimestamp
    };

    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        'data/twitch-tokens.json',
        JSON.stringify(updatedTokens, null, 2),
        { mode: 0o600 }
      )
    );
  });

  await authProvider.addUserForToken({
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresIn: tokenData.expiresIn,
    obtainmentTimestamp: tokenData.obtainmentTimestamp
  }, ['chat', 'moderator:manage:banned_users', 'channel:read:redemptions', 'channel:manage:redemptions']);

  const apiClient = new ApiClient({ authProvider });
  const broadcaster = await apiClient.users.getUserByName(TWITCH_CHANNEL);
  if (!broadcaster) throw new Error("Could not find the broadcaster Twitch account.");
  const settings = JSON.parse(
    await readFile('config/bot-settings.json', 'utf8')
  );

  const recognizedData = JSON.parse(await readFile("config/recognized-streamers.json", "utf8"));
  const recognizedStreamers = new Set(recognizedData.streamers.map((name) => name.trim().toLowerCase()));
  const knownBots = new Set(["trackerggbot", "moobot", "nightbot", "overlayexpert", "streamelements"]);
  const recentMessages = new Map();
  const shoutoutCooldowns = new Map();

  async function shoutout(channel, username, reason) {
    const name = username.replace(/^@/, "").trim();
    if (name.length === 0) return;
    const key = name.toLowerCase();
    if (knownBots.has(key)) {
      console.log("Shoutout skipped for known bot: " + name);
      return;
    }
    const cooldownMs = settings.shoutoutCooldownSeconds * 1000;
    if (Date.now() - (shoutoutCooldowns.get(key) || 0) < cooldownMs) return;
    try {
      const target = await apiClient.users.getUserByName(name);
      if (!target) {
        console.log("Shoutout skipped: Twitch user " + name + " was not found.");
        return;
      }
      shoutoutCooldowns.set(key, Date.now());
      await chatClient.say(channel, "Go check out https://twitch.tv/" + target.name + " — show " + target.displayName + " some love! " + reason);
      console.log("Shouted out " + target.name + " (" + reason + ").");
    } catch (error) {
      console.error("Shoutout failed for " + name + ":", error.message);
    }
  }

  const chatClient = new ChatClient({
    authProvider,
    channels: [TWITCH_CHANNEL],
    requestMembershipEvents: true
  });

  chatClient.onConnect(() => {
    console.log(`Connected to Twitch chat: #${TWITCH_CHANNEL}`);
    console.log('RStone Twitch Bot is online!');
  });

  chatClient.onJoin((channel, user) => {
    if (!settings.welcomeMessages) return;
    if (user.toLowerCase() === TWITCH_BOT_USERNAME.toLowerCase()) return;
    if (knownBots.has(user.toLowerCase())) return;

    console.log(`Join detected: ${user} in ${channel}`);
    void chatClient.say(channel, `Welcome to the chat, @${user}! 👋`);
  });

  chatClient.onMessage((channel, user, message, msg) => {
    console.log(`[CHAT DEBUG] #${channel} <${user}> ${message}`);
    if (user.toLowerCase() === TWITCH_BOT_USERNAME.toLowerCase()) {
      return;
    }

    void shoutout(channel, user, "Thanks for stopping by!");

    const key = `${channel.toLowerCase()}:${user.toLowerCase()}`;
    const badges = msg.badges ?? new Set();
    const protectedUser =
      msg.userInfo.isBroadcaster ||
      msg.userInfo.isMod ||
      msg.userInfo.isLeadMod ||
      badges.has("broadcaster") ||
      badges.has("moderator") ||
      badges.has("lead_moderator");

    const command = message.trim();
    const lowerCommand = command.toLowerCase();

    if (protectedUser && lowerCommand === '!redeems') {
      const pending = getPendingRedemptions();

      if (pending.length === 0) {
        void chatClient.say(channel, 'No pending redemptions seen since the bot started.');
      } else {
        const list = pending.slice(0, 8).map((item, i) =>
          `#${i + 1} ${item.rewardTitle} — ${item.userName}`
        ).join(' | ');
        void chatClient.say(channel, `Pending redemptions: ${list}${pending.length > 8 ? ' | Use the first 8 listed.' : ''}`);
      }

      return;
    }

    if (protectedUser && lowerCommand.startsWith('!fulfill')) {
      const parts = command.split(/\s+/);

      if (parts.length !== 2 || !/^\d+$/.test(parts[1])) {
        void chatClient.say(channel, 'Usage: !fulfill <number> — use !redeems to list pending redemptions.');
      } else {
        void (async () => {
          const result = await fulfillPendingRedemption(apiClient, broadcaster.id, Number(parts[1]));
          await chatClient.say(channel, result.message);
        })();
      }

      return;
    }


    if (protectedUser) {
      recentMessages.delete(key);
    } else {
      const now = Date.now();
      const cutoff = now - settings.spamWindowSeconds * 1000;
      const recent = (recentMessages.get(key) || [])
        .filter((entry) => entry.time > cutoff);

      recent.push({ message, time: now });
      recentMessages.set(key, recent);

      if (recent.length >= settings.spamLimit) {
        recentMessages.set(key, []);
        console.log(`Spam detected from ${user} in ${channel}; applying 10-second timeout.`);
        void (async () => {
          try {
            const target = await apiClient.users.getUserByName(user);
            if (!target) {
              console.log(`Could not find Twitch account for ${user}; timeout skipped.`);
              return;
            }
            await apiClient.moderation.banUser(broadcaster.id, {
              user: target.id,
              duration: 10,
              reason: "Spam: too many messages in a short time"
            });
            console.log(`Timed out ${user} for 10 seconds.`);
          } catch (error) {
            console.error(`Timeout failed for ${user}:`, error.message);
          }
        })();
      }
    }

    if (message.trim().toLowerCase() === '!hello') {
      void (async () => {
        try {
          console.log(`[SEND DEBUG] Attempting !hello reply to ${user}`);
          await chatClient.say(channel, `Hey @${user}! 👋`);
          console.log(`[SEND DEBUG] !hello reply accepted for ${user}`);
        } catch (error) {
          console.error(`[SEND DEBUG] !hello reply failed for ${user}:`, error);
        }
      })();
    }
if (message.trim().toLowerCase() === '!rivals') {
  void (async () => {
    try {
      const data = await getRivalsStats();

      if (!data.heroes || data.heroes.length === 0) {
        await chatClient.say(channel, `@${user}, no tracked hero stats are available right now.`);
        return;
      }

      const mostPlayed = [...data.heroes].sort((a, b) => b.games - a.games)[0];

      const eligible = data.heroes.filter(hero => hero.games >= 3);
      const bestRate = eligible.length
        ? Math.max(...eligible.map(hero => hero.winRate))
        : null;

      const bestHeroes = bestRate === null
        ? []
        : eligible.filter(hero => hero.winRate === bestRate);

      const bestText = bestHeroes.length
        ? `Best WR (3+ games): ${bestHeroes.map(hero => hero.name).join(' & ')} ${bestRate.toFixed(1)}%`
        : 'Not enough tracked games for a best WR';

      const reply =
        `🎮 ${data.name} | Lv. ${data.level} | Most played: ${mostPlayed.name} (${mostPlayed.games} games, ${mostPlayed.wins}W-${mostPlayed.losses}L, ${mostPlayed.winRate.toFixed(1)}% WR) | ${bestText} | tracked stats`;

      await chatClient.say(channel, reply);
    } catch (error) {
      console.error('!rivals command failed:', error.message);
      await chatClient.say(channel, `@${user}, couldn't fetch Rivals stats right now. Try again shortly.`);
    }
  })();
}
  });

  chatClient.onRaid((channel, user, raidInfo) => {
    void shoutout(channel, user, "Thanks for the raid with " + raidInfo.viewerCount + " viewers!");
  });

  startRedemptionListener({ apiClient, broadcasterId: broadcaster.id, chatClient, channel: TWITCH_CHANNEL });

  await chatClient.connect();
}
const execFileAsync = promisify(execFile);

let rivalsCache = null;
let rivalsCacheAt = 0;
let rivalsFetchInProgress = null;

async function getRivalsStats() {
  const now = Date.now();

  if (rivalsCache && now - rivalsCacheAt < 60_000) {
    return rivalsCache;
  }

  if (rivalsFetchInProgress) {
    return rivalsFetchInProgress;
  }

  rivalsFetchInProgress = (async () => {
    const { stdout } = await execFileAsync(
      '.venv/bin/python',
      ['scripts/rivals_stats.py'],
      { timeout: 20_000, maxBuffer: 1024 * 1024, env: { ...process.env, RIVALS_PLAYER_USERNAME } }
    );

    const data = JSON.parse(stdout);

    if (data.error) {
      throw new Error(data.error);
    }

    rivalsCache = data;
    rivalsCacheAt = Date.now();
    return data;
  })();

  try {
    return await rivalsFetchInProgress;
  } finally {
    rivalsFetchInProgress = null;
  }
}
main().catch((error) => {
  console.error('Bot startup failed:', error.message);
  process.exit(1);
});
