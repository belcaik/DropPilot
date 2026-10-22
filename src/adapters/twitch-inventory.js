import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { channelLogin } from './facepunch.js';

// Uses rendered inventory markup, never account tokens or private React state.
// Claimed status requires the explicit history heading, not 100% progress.
export function claimedDateRange(label, now = Date.now()) {
  const text = label.trim().toLowerCase();
  let days;
  if (/^(today|hoy)$/.test(text)) days = 0;
  else if (/^(yesterday|ayer)$/.test(text)) days = 1;
  else if (text === 'anteayer') days = 2;
  else {
    const match = text.match(/^(?:hace\s+)?(\d+)\s+(?:días?|days?)(?:\s+ago)?$/);
    if (match) days = Number(match[1]);
  }
  // Relative labels are imprecise and timezone-dependent. Enclose their whole
  // possible day; unknown/older dates cannot establish campaign ownership.
  if (days == null) return null;
  return [new Date(now - (days + 1.5) * 86400000).toISOString(), new Date(now - Math.max(0, days - 1.5) * 86400000).toISOString()];
}

export function parseTwitchInventory(html, { now = Date.now() } = {}) {
  const $ = load(html);
  const roots = $('.inventory-page');
  if (!roots.length) return null;
  const result = [];
  roots.each((_, rootElement) => {
    const root = $(rootElement);
    // The separate marketing Rewards area is not the Drops inventory.
    if (!root.find('.inventory-drop-image, .inventory-campaign-info').length) return;
    const scopes = new Map();
    root.find('.inventory-campaign-info').each((__, infoElement) => {
      const info = $(infoElement);
      const campaign = info.parent();
      const link = info.find('a[href*="/drops/campaigns?"]').first();
      let campaignId = null;
      try { campaignId = new URL(link.attr('href'), 'https://www.twitch.tv').searchParams.get('dropID'); } catch {}
      const channels = info.find('a[data-test-selector="DropsCampaignInProgressDescription-single-channel-hint-text"]').map((___, a) => {
        try { return channelLogin(new URL($(a).attr('href'), 'https://www.twitch.tv').href, 'twitch'); } catch { return null; }
      }).get();
      campaign.find('.inventory-drop-image').each((___, image) => scopes.set(image, { campaign, campaignId, campaignTitle: link.text().trim() || null, channels }));
    });
    let history = false;
    root.find('h1,h2,h3,h4,h5,h6,.inventory-drop-image').each((__, element) => {
      const node = $(element);
      if (!node.is('.inventory-drop-image')) {
        const heading = node.text().trim();
        history = /^(claimed|reclamados|reclamadas)$/i.test(heading);
        return;
      }
      const scope = scopes.get(element);
      if (!scope && !history) return;
      let body = node.parent();
      const rewardText = container => container.find('p').map((___, p) => $(p).text().trim()).get().filter(text => text && !/(?:esta recompensa ya no está disponible|this reward is no longer available)/i.test(text));
      while (body.length && !rewardText(body).length && !body.is('.inventory-page')) body = body.parent();
      if (body.find('.inventory-drop-image').length !== 1) return;
      const paragraphs = rewardText(body);
      const name = paragraphs.at(-1);
      if (!name) return;
      let reward = body;
      // Extend only while this remains a single reward. Includes progress and
      // expired overlays but cannot borrow evidence from adjacent rewards.
      while (reward.parent().length && reward.parent().find('.inventory-drop-image').length === 1 && !reward.parent().is('.inventory-page')) {
        reward = reward.parent();
      }
      const bar = reward.find('[role="progressbar"]').first();
      const raw = Number(bar.attr('aria-valuenow'));
      const min = Number(bar.attr('aria-valuemin') ?? 0);
      const max = Number(bar.attr('aria-valuemax') ?? 100);
      const progressKnown = bar.attr('aria-valuenow') != null && Number.isFinite(raw) && max > min;
      const expired = /(?:esta recompensa ya no está disponible|this reward is no longer available)/i.test(reward.text());
      const src = node.attr('src') || '';
      const imageId = src.match(/\/REWARD\/([\w-]+)\./i)?.[1];
      result.push({ id: imageId || createHash('sha256').update(`twitch|${scope?.campaignId || 'history'}|${name}`).digest('hex').slice(0,24), name, platform: 'twitch',
        campaignId: scope?.campaignId || null, campaignTitle: scope?.campaignTitle || null, game: null,
        source: scope ? 'twitch-in-progress' : 'twitch-claimed-history',
        claimed: !scope && history, claimable: false, expired,
        claimedAt: null, claimedAtRange: !scope && history ? claimedDateRange(paragraphs[0], now) : null,
        progress: progressKnown ? Math.round(Math.max(0, Math.min(100, (raw-min)/(max-min)*100)) * 100) / 100 : 0,
        progressKnown, channels: scope?.channels || [],
        historyPartial: root.find('button').toArray().some(b => /^(load more|cargar más)$/i.test($(b).text().trim())),
      });
    });
  });
  return result.length ? result : null;
}
