import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCampaign, channelLogin, fetchCampaign } from './facepunch.js';
import { parseInventory, createAdapter } from './index.js';

test('one shared Facepunch reward maps to both channels without importing category links', () => {
  const data = parseCampaign(`<title>Rust | Twitch Drops</title>
    <div class="drop-box"><a class="streamer-info" href="https://www.twitch.tv/Alice">Alice</a><a class="streamer-info" href="https://www.twitch.tv/Bob">Bob</a><a class="drop-box-body" href="https://www.twitch.tv/Bob"></a><span class="drop-type">Rocket Launcher</span><div class="drop-time">1 Hour</div><span data-itemid="11590"></span></div>
    <a class="drop-box" href="https://www.twitch.tv/directory/category/rust"><span class="drop-type">Large Wood Box</span><div class="drop-time">2 Hours</div><span data-itemid="11591"></span></a>`, 'twitch');
  assert.equal(data.rewards.length, 2);
  assert.deepEqual(data.rewards[0].channels, ['alice', 'bob']);
  assert.equal(data.rewards[0].id, 'facepunch:twitch:11590');
  assert.equal(data.rewards[1].durationMinutes, 120);
  assert.equal(data.rewards[1].general, true);
  assert.equal(data.channels.length, 2);
  assert.deepEqual(data.channels[0].rewardIds, ['facepunch:twitch:11590']);
});
test('empty Kick campaign is valid but a challenge page is not', () => {
  assert.equal(parseCampaign('<title>Rust | Kick Drops</title>', 'kick').channels.length, 0);
  assert.throws(() => parseCampaign('<title>Just a moment</title>', 'kick'), /no reconocida/);
});
test('channel URL validation blocks foreign hosts and reserved paths', () => {
  assert.equal(channelLogin('https://www.twitch.tv/Blooprint', 'twitch'), 'blooprint');
  for (const input of ['https://evil.test/alice', 'https://www.twitch.tv/directory/category/rust', '../alice', 'https://www.twitch.tv/login']) assert.throws(() => channelLogin(input, 'twitch'));
});
test('inventory distinguishes known progress, claimable, and claimed; never assumes missing progress completed', () => {
  const drops = parseInventory(`<div data-campaign-id="rust-round-1"><div class="inventory-drop-card" data-drop-id="one"><h3>Launcher</h3><div role="progressbar" aria-valuenow="40"></div></div><div class="inventory-drop-card" data-drop-id="two"><h3>Box</h3><button data-test-selector="DropsInventoryDropClaimButton">Claim</button></div><div class="inventory-drop-card" data-drop-id="three"><h3>Gloves</h3><span class="drop-claimed">Claimed</span></div></div>`, 'twitch');
  assert.equal(drops[0].progress, 40);
  assert.equal(drops[0].claimed, false);
  assert.equal(drops[1].claimable, true);
  assert.equal(drops[1].progressKnown, false);
  assert.equal(drops[1].progress, 0);
  assert.equal(drops[2].claimed, true);
});
test('disabled claim buttons cannot be claimed; unsupported inventory throws', () => {
  const [drop] = parseInventory('<div class="drop-card"><h3>Hat</h3><button data-testid="claim-drop" disabled>Claim</button></div>', 'kick');
  assert.equal(drop.claimable, false);
  assert.throws(() => parseInventory('<h1>Log in</h1>', 'twitch'), /desconocido/);
  assert.deepEqual(parseInventory('<div data-testid="drops-empty"></div>', 'kick'), []);
});
test('inventory configurable CSS selectors support other UI revisions', () => {
  const [drop] = parseInventory('<article data-drop-id="reward"><strong>Other game skin</strong><meter data-progress="76"></meter><small>Obtained</small></article>', 'kick', { inventoryCard: 'article', rewardName: 'strong', progress: 'meter', claimed: 'small' });
  assert.equal(drop.progress, 76);
  assert.equal(drop.claimed, true);
});
test('Facepunch HTTP failures and unexpected redirects surface to caller', async () => {
  await assert.rejects(fetchCampaign('kick', { fetchImpl: async () => ({ ok: false, status: 403 }) }), /403/);
});
test('same reward name in different campaigns retains distinct identity and explicit scope', () => {
  const drops = parseInventory('<section data-campaign-id="old" data-game="Rust" data-campaign-name="Old round"><div class="drop-card"><h3>Large Box</h3><span class="drop-claimed">Claimed</span></div></section><section data-campaign-id="new" data-game="Rust" data-campaign-name="Rust Isles"><div class="drop-card"><h3>Large Box</h3><div role="progressbar" aria-valuenow="12"></div></div></section>', 'kick');
  assert.notEqual(drops[0].id, drops[1].id);
  assert.equal(drops[0].game, 'Rust');
  assert.equal(drops[1].campaignTitle, 'Rust Isles');
  assert.equal(drops[1].claimed, false);
});

function fakePage() {
  const page = {
    closed: false, focusCount: 0, navigationCount: 0, playCount: 0,
    video: { paused: false, readyState: 4, ended: false, error: null },
    setDefaultTimeout() {},
    async route(_, handler) { this.routeHandler = handler; },
    async goto() { this.navigationCount++; return { status: () => 200 }; },
    async waitForLoadState() {},
    async waitForFunction() {},
    async bringToFront() { this.focusCount++; },
    async close() { this.closed = true; },
    isClosed() { return this.closed; },
    locator(selector) {
      return {
        first() { return this; },
        async count() { return 1; },
        async innerText() { return 'normal channel page'; },
        async isVisible() { return selector === '#live' || selector.includes('play-pause'); },
        async evaluate(callback) { return callback(page.video); },
        async click() { page.playCount++; page.video.paused = false; },
      };
    },
  };
  return page;
}
test('live probes block media before navigation and restore stream focus', async () => {
  const pages = [];
  const adapter = createAdapter('twitch', { context: { async newPage() { const page = fakePage(); pages.push(page); return page; } }, settings: { selectors: { twitch: { live: '#live' } } } });
  await adapter.watch('alice');
  const initialFocus = pages[0].focusCount;
  assert.equal(await adapter.live('bob'), true);
  assert.ok(pages[1].routeHandler);
  let aborted = false;
  await pages[1].routeHandler({ request: () => ({ resourceType: () => 'media', url: () => 'https://example.test/video' }), async abort() { aborted = true; }, async continue() {} });
  assert.equal(aborted, true);
  assert.equal(pages[1].closed, true);
  assert.ok(pages[0].focusCount > initialFocus);
});
test('health leaves playing streams alone, resumes paused player with a real click, and detects closure', async () => {
  const page = fakePage();
  const adapter = createAdapter('twitch', { context: { async newPage() { return page; } } });
  await adapter.watch('alice');
  assert.equal(await adapter.health(), true);
  assert.equal(page.playCount, 0);
  assert.equal(page.navigationCount, 1);
  page.video.paused = true;
  assert.equal(await adapter.health(), true);
  assert.equal(page.playCount, 1);
  assert.equal(page.navigationCount, 1);
  await adapter.close();
  assert.equal(await adapter.health(), false);
});
