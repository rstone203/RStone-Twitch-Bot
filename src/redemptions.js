import { EventSubWsListener } from '@twurple/eventsub-ws';

const pendingRedemptions = new Map();
const MAX_PENDING_REDEMPTIONS = 50;

export function getPendingRedemptions() {
  return [...pendingRedemptions.values()]
    .filter((item) => item.status === 'UNFULFILLED')
    .sort((a, b) => a.receivedAt - b.receivedAt);
}

export async function fulfillPendingRedemption(apiClient, broadcasterId, number) {
  const pending = getPendingRedemptions();
  const item = pending[Number(number) - 1];

  if (!item || !Number.isInteger(Number(number)) || Number(number) < 1) {
    return { ok: false, message: 'Invalid number. Use !redeems to see pending redemptions.' };
  }

  try {
    await apiClient.channelPoints.updateRedemptionStatusByIds(
      broadcasterId,
      item.rewardId,
      [item.id],
      'FULFILLED'
    );
    pendingRedemptions.set(item.id, { ...item, status: 'FULFILLED' });
    return { ok: true, message: `Fulfilled redemption #${number}: ${item.rewardTitle}.` };
  } catch (error) {
    return { ok: false, message: `Twitch could not fulfill that redemption: ${error.message}` };
  }
}

const REWARD_RESPONSES = {
  'Game Lounge Check In': 'Welcome to the Game Lounge, {user}! 🎮',
  'hydrate': '💧 Hydration check, {user}! Take a drink.',
  'In Stream challenge ': '🎯 {user} submitted a stream challenge! Stoney will review it.',
  'Drop it!': '📦 {user} redeemed Drop it! Stoney will review the item to drop.',
  'Stop Moving For 1 Minute': '🧊 {user} called a 60-second freeze! Stoney, stop moving!',
  'No cursing': '🤐 {user} activated No Cursing! Stoney will track the challenge.',
  'Add a Command OR Redemption': '📝 {user} submitted a command/redemption idea for Stoney to review.',
  'Choose my gun': '🔫 {user} chose Choose My Gun! Stoney will review the requested weapon.',
  'Reverse, Reverse': '🔄 {user} redeemed Reverse, Reverse! Stoney will review when it can apply.',
  'No ADS (COD)': '🎯 {user} activated No ADS for Call of Duty!',
  'No Kill Zone (SE)': '🥷 {user} activated No Kill Zone for Sniper Elite!',
  'Ultimate TAX - MR': '💸 {user} called in the Ultimate Tax for Marvel Rivals!',
  'No Ult (MR)': '🚫 {user} activated No Ultimate for Marvel Rivals!',
  'YOU SUCK - END STREAM': '⚠️ {user} redeemed YOU SUCK - END STREAM! Stoney must confirm any stream-ending action manually.',
  'First Weapon Only (Fort)': '🔫 {user} activated First Weapon Only for Fortnite!',
  'Close Quarters (Fort)': '🥊 {user} activated Close Quarters for Fortnite!',
  'No more looting (Fort)': '🎒 {user} activated No More Looting for Fortnite!',
  'No Primary Fire (MR) - One round': '🛡️ {user} activated No Primary Fire for one Marvel Rivals round!',
  'No Reload (COD)': '🔄 {user} activated No Reload for Call of Duty!',
  'Objective Duty (COD/MR)': '🎯 {user} activated Objective Duty!',
  'Sidearm only (COD)': '🔫 {user} activated Sidearm Only for Call of Duty!',
  'No Healing (Fort)': '❤️‍🩹 {user} activated No Healing for Fortnite!',
  'No Scope (Sniper Elite)': '🎯 {user} activated No Scope for Sniper Elite!',
  'No Surppressors (SE)': '🔇 {user} activated No Suppressors for Sniper Elite!',
  'No Sprinting (Fort)': '🚶 {user} activated No Sprinting for Fortnite!'
};

function formatAnnouncement(event) {
  const user = event.userDisplayName || event.userName || 'A viewer';
  const title = event.rewardTitle || 'Unknown reward';
  const template = REWARD_RESPONSES[title] ??
    '🎉 {user} redeemed {reward}! Stoney will review it.';
  const response = template
    .replaceAll('{user}', user)
    .replaceAll('{reward}', title);

  const input = event.input?.trim();
  const safeInput = input ? ` Their submission: "${input.slice(0, 180)}"` : '';
  return `${response}${safeInput}`.slice(0, 450);
}

export function startRedemptionListener({ apiClient, broadcasterId, chatClient, channel }) {
  const listener = new EventSubWsListener({ apiClient });

  listener.onChannelRedemptionAdd(broadcasterId, async (event) => {
    try {
      if (event.status === 'UNFULFILLED') {
        pendingRedemptions.set(event.id, {
          id: event.id,
          rewardId: event.rewardId,
          rewardTitle: event.rewardTitle,
          userName: event.userDisplayName || event.userName || 'Viewer',
          input: event.input || '',
          status: event.status,
          receivedAt: Date.now()
        });

        while (pendingRedemptions.size > MAX_PENDING_REDEMPTIONS) {
          pendingRedemptions.delete(pendingRedemptions.keys().next().value);
        }
      }

      const announcement = formatAnnouncement(event);
      await chatClient.say(channel, announcement);
      console.log(
        `Redemption received: "${event.rewardTitle}" from ${event.userName} (status: ${event.status})`
      );
    } catch (error) {
      console.error('Could not announce channel point redemption:', error.message);
    }
  });

  listener.on(listener.onUserSocketConnect, (userId) => {
    console.log(`Redemption EventSub connected for Twitch user ${userId}.`);
  });

  listener.on(listener.onUserSocketDisconnect, (userId, error) => {
    console.error(
      `Redemption EventSub disconnected for Twitch user ${userId}.`,
      error?.message ?? ''
    );
  });

  listener.start();
  console.log('Channel point redemption listener starting in announcement-only mode.');
  return listener;
}
