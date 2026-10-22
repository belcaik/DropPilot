import test from 'node:test';
import assert from 'node:assert/strict';
import {findInstalledBrowser,manualLoginArgs,twitchAuthenticated,removeLoginProfile} from '../src/core/auth-browser.js';
import {BrowserManager} from '../src/core/browser.js';
import {validateSettings} from '../src/core/config.js';

test('installed browser selection respects preference and refuses arbitrary executable config',async()=>{
 const candidates=[{channel:'msedge',executablePath:'edge'},{channel:'chrome',executablePath:'chrome'}];
 assert.equal((await findInstalledBrowser('auto',candidates,async()=>true)).channel,'chrome');
 assert.equal((await findInstalledBrowser('msedge',candidates,async()=>true)).channel,'msedge');
 assert.equal(await findInstalledBrowser('chrome',candidates,async()=>false),null);
 assert.equal(validateSettings({}).browserChannel,'auto');
 assert.throws(()=>validateSettings({browserChannel:'C:/evil.exe'}));
});
test('manual login uses separate profile and loopback; no automation/stealth/sandbox disabling',()=>{
 const args=manualLoginArgs('temporary-owned-profile',12345,'https://www.twitch.tv/login');
 assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
 assert.ok(args.includes('--remote-debugging-port=12345'));
 assert.ok(args.includes('--user-data-dir=temporary-owned-profile'));
 assert.ok(!args.some(arg=>/enable-automation|disable-blink|no-sandbox|disable-web-security/.test(arg)));
 assert.throws(()=>manualLoginArgs('profile',0,'https://www.twitch.tv/login'));
 assert.throws(()=>manualLoginArgs('profile',12345,'https://evil.com'));
});
test('Twitch authentication evidence requires nonexpired own-domain auth token',()=>{
 const token={name:'auth-token',value:'synthetic-test',domain:'.twitch.tv',expires:Date.now()/1000+1000};
 assert.equal(twitchAuthenticated({cookies:[token]}),true);
 assert.equal(twitchAuthenticated({cookies:[{...token,domain:'twitch.tv.evil.com'}]}),false);
 assert.equal(twitchAuthenticated({cookies:[{...token,expires:1}]}),false);
 assert.equal(twitchAuthenticated({cookies:[{...token,value:''}]}),false);
 assert.equal(twitchAuthenticated({cookies:[{...token,name:'anonymous'}]}),false);
});
test('Save does not overwrite existing vault if user has not authenticated',async()=>{
 let writes=0;const manager=new BrowserManager({vault:{write:async()=>{writes++;}},log:()=>{},onChange:()=>{},browserPath:''});
 const connection={contexts:()=>[{storageState:async()=>({cookies:[],origins:[]})}]};
 manager.logins.set('twitch',{connection});manager.pending.add('twitch');
 await assert.rejects(manager.finish('twitch'),/todavía no está autenticado/);
 assert.equal(writes,0);assert.equal(manager.pending.has('twitch'),true);
});
test('profile cleanup refuses existing unrelated directory',async()=>{
 await assert.rejects(removeLoginProfile(process.cwd()),/Directorio de autenticación no reconocido/);
});
