import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInventory } from './index.js';
import { claimedDateRange } from './twitch-inventory.js';

// Reduced current rendered structure. No account data or session material.
const html = (heading = 'Reclamados', expired = 'Esta recompensa ya no está disponible.') => `
<div class="inventory-page">
 <div><div class="inventory-campaign-info"><a href="/drops/campaigns?dropID=campaign">Campaign name</a>
 <a data-test-selector="DropsCampaignInProgressDescription-single-channel-hint-text" href="https://www.twitch.tv/example">example</a></div>
 <div><div><img class="inventory-drop-image" src="https://static-cdn.jtvnw.net/twitch-quests-assets/REWARD/reward-one.png"><p>${expired}</p></div><div><p>Example Backpack</p></div></div>
 <div role="progressbar" aria-valuenow="55" aria-valuemin="0" aria-valuemax="100"></div></div>
 <h5>${heading}</h5><div><div><div><img class="inventory-drop-image" src="https://static-cdn.jtvnw.net/twitch-quests-assets/REWARD/reward-two.png"></div><div><p>anteayer</p><p>Example Door</p></div></div><button disabled aria-label="Botón de conexión de Drops concedidos"></button></div>
 <button>Cargar más</button>
</div><div class="inventory-page"><h4>Rewards</h4><p>No rewards yet</p></div>`;

test('current Twitch markup reads expired progress and explicit claimed history', () => {
 const drops=parseInventory(html(),'twitch');
 assert.equal(drops.length,2);
 assert.equal(drops[0].name,'Example Backpack');
 assert.equal(drops[0].progress,55);
 assert.equal(drops[0].expired,true);
 assert.equal(drops[0].claimed,false);
 assert.equal(drops[0].claimable,false);
 assert.equal(drops[0].campaignId,'campaign');
 assert.deepEqual(drops[0].channels,['example']);
 assert.equal(drops[1].name,'Example Door');
 assert.equal(drops[1].claimed,true);
 assert.equal(drops[1].source,'twitch-claimed-history');
 assert.equal(drops[1].claimedAtRange.length,2);
 assert.equal(drops[1].historyPartial,true);
});
test('English history heading is supported and disabled connection alone is not evidence',()=>{
 assert.equal(parseInventory(html('Claimed','This reward is no longer available.'),'twitch')[1].claimed,true);
 assert.equal(parseInventory(html('Unknown section'),'twitch').length,1);
});
test('100 percent progress cannot establish acquisition',()=>{
 const drop=parseInventory(html().replace('aria-valuenow="55"','aria-valuenow="100"'),'twitch')[0];
 assert.equal(drop.progress,100);assert.equal(drop.claimed,false);assert.equal(drop.claimable,false);
});
test('marketing empty Rewards is not an empty Drops inventory',()=>{
 assert.throws(()=>parseInventory('<div class="inventory-page"><h4>Rewards</h4>No rewards yet</div>','twitch'),/estructura/);
});
test('relative claimed dates are conservative and older ambiguous dates remain unknown',()=>{
 const now=Date.parse('2026-10-04T12:00:00Z');
 assert.deepEqual(claimedDateRange('2 days ago',now),claimedDateRange('anteayer',now));
 assert.equal(claimedDateRange('hace 5 meses',now),null);
});
