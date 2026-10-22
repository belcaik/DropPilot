import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { channelLogin } from './facepunch.js';
import { parseTwitchInventory } from './twitch-inventory.js';
export { fetchCampaign, parseCampaign } from './facepunch.js';

export const DEFAULT_SELECTORS = {
  twitch: {
    inventoryCard: '[data-test-selector="DropsInventoryDropCard"], [data-test-selector="DropsCampaignDrop"], .inventory-drop-card',
    rewardName: '[data-test-selector="DropsInventoryDropName"], .drop-name, h3',
    progress: '[role="progressbar"], .drop-progress',
    claimed: '[data-test-selector="DropsInventoryDropClaimed"], .drop-claimed',
    claimButton: 'button[data-test-selector="DropsInventoryDropClaimButton"]',
    inventoryEmpty: '[data-test-selector="drops-inventory-empty"]',
    campaignRoot: '[data-campaign-id], [data-test-selector="DropsCampaignInProgress"], [data-test-selector="DropsCampaignCompleted"]',
    game: '[data-game-name], .drop-game',
    campaignName: '[data-campaign-name], .campaign-name',
    live: '[data-a-target="live-indicator"]',
    offline: '[data-a-target="offline-channel-main-content"], [data-test-selector="channel-offline"]',
    playButton: 'button[data-a-target="player-play-pause-button"]',
  },
  kick: {
    inventoryCard: '[data-testid="drop-card"], [data-drop-id], .drop-card',
    rewardName: '[data-testid="drop-name"], .drop-name, h3',
    progress: '[role="progressbar"], .drop-progress',
    claimed: '[data-testid="drop-claimed"], .drop-claimed',
    claimButton: '[data-testid="claim-drop"]',
    inventoryEmpty: '[data-testid="drops-empty"]',
    campaignRoot: '[data-campaign-id], [data-testid="drop-campaign"]',
    game: '[data-game-name], .drop-game',
    campaignName: '[data-campaign-name], .campaign-name',
    live: '[data-testid="livestream-status-live"]',
    offline: '[data-testid="channel-offline"]',
    playButton: 'button[aria-label="Play"]',
  },
};

// Platform HTML is not an official stable API. These candidates deliberately fail
// closed when unrecognized. Users can update CSS selectors without patching code.

function mergedSelectors(platform, selectors = {}) { return { ...DEFAULT_SELECTORS[platform], ...selectors }; }

/** Only recognized reward cards with direct, visible evidence are accepted. */
export function parseInventory(html, platform, selectors = {}) {
  const s = mergedSelectors(platform, selectors);
  const $ = load(html);
  const result = [];
  $(s.inventoryCard).each((_, element) => {
    const card = $(element);
    const name = card.find(s.rewardName).first().text().trim();
    if (!name) return;
    const progressNode = card.find(s.progress).first();
    const rawProgress = progressNode.attr('aria-valuenow') ?? progressNode.attr('data-progress') ?? progressNode.text().match(/(\d+(?:\.\d+)?)\s*%/)?.[1];
    const validProgress = rawProgress != null && /^\d+(?:\.\d+)?$/.test(rawProgress.trim());
    const max = Number(progressNode.attr('aria-valuemax') || 100);
    const min = Number(progressNode.attr('aria-valuemin') || 0);
    const percentage = validProgress && max > min ? ((Number(rawProgress) - min) / (max - min)) * 100 : 0;
    const claimed = card.find(s.claimed).length > 0;
    const claimButton = card.find(s.claimButton).first();
    const claimable = !claimed && claimButton.length > 0 && claimButton.attr('disabled') == null && claimButton.attr('aria-disabled') !== 'true';
    const scope = s.campaignRoot ? card.closest(s.campaignRoot) : card;
    const campaign = scope.attr('data-campaign-id') || card.attr('data-campaign-id') || '';
    const game = card.attr('data-game') || scope.attr('data-game') || scope.find(s.game).first().attr('data-game-name') || scope.find(s.game).first().text().trim() || null;
    const campaignTitle = card.attr('data-campaign-name') || scope.attr('data-campaign-name') || scope.find(s.campaignName).first().text().trim() || null;
    const id = card.attr('data-drop-id') || createHash('sha256').update(`${platform}|${campaign}|${name}`).digest('hex').slice(0, 24);
    const channels = [];
    card.find('a[href]').each((__, anchor) => { try { channels.push(channelLogin($(anchor).attr('href'), platform)); } catch {} });
    result.push({ id, name, platform, campaignId: campaign || null, campaignTitle, game, claimedAt: card.attr('data-claimed-at') || null, progress: Math.min(100, Math.max(0, percentage)), progressKnown: validProgress && max > min, claimed, claimable, channels: [...new Set(channels)] });
  });
  if (!result.length && platform === 'twitch') {
    const modern = parseTwitchInventory(html);
    if (modern) return modern;
  }
  if (!result.length && !$(s.inventoryEmpty).length) throw new Error('No se pudo leer la estructura del inventario; su estado es desconocido. No se ha confirmado que la sesión haya caducado ni que falten drops.');
  return result;
}

export function createAdapter(platform, { context, settings = {}, log = () => {} }) {
  if (!DEFAULT_SELECTORS[platform]) throw new Error('Plataforma no soportada');
  const s = mergedSelectors(platform, settings.selectors?.[platform]);
  const timeout = Math.min(60000, Math.max(3000, Number(settings.navigationTimeoutMs) || 20000));
  const host = platform === 'twitch' ? 'https://www.twitch.tv' : 'https://kick.com';
  const owned = new Set();
  let watchPage;
  let inventoryPage;
  let lastInventory = new Map();
  async function newPage({ blockMedia = false } = {}) {
    const page = await context.newPage();
    page.setDefaultTimeout(timeout);
    owned.add(page);
    if (blockMedia) await page.route('**/*', route => {
      const request = route.request();
      const isMedia = request.resourceType() === 'media' || /\.(?:m3u8|mpd|ts|m4s|mp4|webm|aac)(?:[?#]|$)/i.test(request.url());
      return isMedia ? route.abort() : route.continue();
    });
    return page;
  }
  async function restoreWatchFocus() {
    if (watchPage && !watchPage.isClosed()) await watchPage.bringToFront().catch(() => {});
  }
  async function playbackHealth() {
    if (!watchPage || watchPage.isClosed()) return false;
    await restoreWatchFocus();
    const video = watchPage.locator('video').first();
    if (!await video.count()) return null;
    let state = await video.evaluate(element => ({ paused: element.paused, healthy: !element.paused && !element.ended && !element.error && element.readyState >= 2 })).catch(() => null);
    if (!state) return null;
    if (state.healthy) return true;
    if (state.paused && s.playButton && await watchPage.locator(s.playButton).first().isVisible()) {
      await watchPage.locator(s.playButton).first().click({ timeout });
      // A real click may initiate asynchronous buffering; bounded wait prevents
      // classifying an ordinary player startup as an immediate failure.
      await watchPage.waitForFunction(() => {
        const element = document.querySelector('video');
        return element && !element.paused && !element.ended && !element.error && element.readyState >= 2;
      }, null, { timeout: Math.min(timeout, 5000) }).catch(() => {});
      state = await video.evaluate(element => ({ healthy: !element.paused && !element.ended && !element.error && element.readyState >= 2 })).catch(() => null);
    }
    return state?.healthy ?? null;
  }
  async function navigate(page, url) {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    if (response && response.status() >= 400) throw new Error(`La plataforma respondió HTTP ${response.status()}`);
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 3000) }).catch(() => {});
    const body = (await page.locator('body').innerText({ timeout })).slice(0, 12000);
    if (/verify (?:you are|you're) human|checking your browser|unusual traffic|verifica que eres humano|just a moment/i.test(body)) throw new Error('La plataforma requiere verificación humana. Abre la sesión visible.');
  }
  return {
    async live(channel) {
      const login = channelLogin(channel, platform);
      const page = await newPage({ blockMedia: true });
      try {
        await navigate(page, `${host}/${login}`);
        if (s.live && await page.locator(s.live).first().isVisible()) return true;
        if (s.offline && await page.locator(s.offline).first().isVisible()) return false;
        // Public structured data is evidence; absence of it is not offline evidence.
        return await page.evaluate(() => {
          const visit = (node) => {
            if (!node || typeof node !== 'object') return null;
            if (node['@type'] === 'BroadcastEvent' && typeof node.isLiveBroadcast === 'boolean') return node.isLiveBroadcast;
            for (const value of Object.values(node)) {
              for (const item of Array.isArray(value) ? value : [value]) { const found = visit(item); if (found !== null) return found; }
            }
            return null;
          };
          for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            try { const state = visit(JSON.parse(script.textContent)); if (state !== null) return state; } catch {}
          }
          return null;
        });
      } catch (error) { log(`No se pudo comprobar ${platform}/${login}: ${error.message}`); return null; }
      finally { owned.delete(page); await page.close().catch(() => {}); await restoreWatchFocus(); }
    },
    async inventory() {
      try {
      if (!inventoryPage || inventoryPage.isClosed()) inventoryPage = await newPage({ blockMedia: true });
      await navigate(inventoryPage, `${host}/drops/inventory`);
      // Wait for actual reward rendering; empty states remain explicitly recognizable.
      const modernSelector = platform === 'twitch' ? ', .inventory-page .inventory-drop-image' : '';
      await inventoryPage.locator(`${s.inventoryCard}, ${s.inventoryEmpty}${modernSelector}`).first().waitFor({ state: 'visible', timeout }).catch(() => {});
      if (/\/login(?:[/?#]|$)/.test(inventoryPage.url()) || await inventoryPage.locator('[data-a-target="login-username-input"]').first().isVisible().catch(() => false)) {
        throw new Error('Twitch está mostrando el formulario de acceso. Guarda de nuevo la sesión desde Cuentas.');
      }
      if (platform === 'twitch' && await inventoryPage.locator('.inventory-page .inventory-drop-image').count()) {
        const html = await inventoryPage.locator('.inventory-page').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden').map(node => {
          const clone = node.cloneNode(true);
          const originals = [...node.querySelectorAll('*')];
          const copies = [...clone.querySelectorAll('*')];
          originals.forEach((child,index) => { if (!child.getClientRects().length || getComputedStyle(child).visibility === 'hidden') copies[index].remove(); });
          return clone.outerHTML;
        }).join('\n'));
        const drops = parseInventory(html, platform, s);
        lastInventory = new Map(drops.map(drop => [drop.id, drop]));
        return drops;
      }
      const visibleHtml = await inventoryPage.locator(s.inventoryCard).evaluateAll((nodes, selectors) => nodes.filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden').map(node => {
        const clone = node.cloneNode(true);
        const originals = [...node.querySelectorAll('*')];
        const copies = [...clone.querySelectorAll('*')];
        originals.forEach((child, index) => { if (!child.getClientRects().length || getComputedStyle(child).visibility === 'hidden') copies[index].remove(); });
        const scope = node.closest(selectors.campaignRoot);
        const campaignId = scope?.getAttribute('data-campaign-id');
        if (campaignId) clone.setAttribute('data-campaign-id', campaignId);
        const game = scope?.getAttribute('data-game') || scope?.querySelector(selectors.game)?.getAttribute('data-game-name') || scope?.querySelector(selectors.game)?.textContent?.trim();
        const title = scope?.getAttribute('data-campaign-name') || scope?.querySelector(selectors.campaignName)?.textContent?.trim();
        if (game) clone.setAttribute('data-game', game);
        if (title) clone.setAttribute('data-campaign-name', title);
        return clone.outerHTML;
      }).join('\n'), s);
      const empty = s.inventoryEmpty && await inventoryPage.locator(s.inventoryEmpty).first().isVisible();
      const drops = empty && !visibleHtml ? [] : parseInventory(visibleHtml, platform, s);
      lastInventory = new Map(drops.map(drop => [drop.id, drop]));
      return drops;
      } finally { await restoreWatchFocus(); }
    },
    async claim(drop) {
      try {
      const known = lastInventory.get(drop.id);
      if (!known?.claimable || !inventoryPage || inventoryPage.isClosed()) throw new Error('El drop no tiene un botón de reclamo verificado');
      const cards = inventoryPage.locator(s.inventoryCard);
      for (let index = 0; index < await cards.count(); index++) {
        const card = cards.nth(index);
        if (!await card.isVisible()) continue;
        const parsed = parseInventory(await card.evaluate(node => {
          const clone = node.cloneNode(true);
          const campaignId = node.closest('[data-campaign-id]')?.getAttribute('data-campaign-id');
          if (campaignId) clone.setAttribute('data-campaign-id', campaignId);
          return clone.outerHTML;
        }), platform, s);
        if (parsed[0]?.id !== drop.id || !parsed[0]?.claimable) continue;
        await card.locator(s.claimButton).first().click({ timeout });
        lastInventory.delete(drop.id);
        return { requested: true, verified: false }; // Only a later inventory snapshot confirms acquisition.
      }
      throw new Error('El botón cambió; actualiza el inventario antes de reclamar');
      } finally { await restoreWatchFocus(); }
    },
    async watch(channel) {
      const login = channelLogin(channel, platform);
      if (!watchPage || watchPage.isClosed()) watchPage = await newPage();
      await navigate(watchPage, `${host}/${login}`);
      await watchPage.bringToFront();
      // Use the ordinary player; never manufacture watch telemetry or override visibility.
      const paused = await watchPage.locator('video').first().evaluate(video => video.paused).catch(() => null);
      if (paused && s.playButton && await watchPage.locator(s.playButton).first().isVisible()) await watchPage.locator(s.playButton).first().click({ timeout });
      return { platform, login, url: `${host}/${login}`, playbackVerified: await watchPage.locator('video').first().evaluate(video => !video.paused && video.readyState >= 2).catch(() => false) };
    },
    async health() {
      try { return await playbackHealth(); }
      catch (error) { log(`No se pudo verificar reproducción ${platform}: ${error.message}`); return null; }
    },
    async close() {
      if (watchPage) { owned.delete(watchPage); await watchPage.close().catch(() => {}); }
      watchPage = null;
    },
    async dispose() { await Promise.all([...owned].map(page => page.close().catch(() => {}))); owned.clear(); watchPage = null; inventoryPage = null; lastInventory.clear(); },
  };
}
