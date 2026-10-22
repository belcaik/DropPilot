// Run against the extracted release archive, with a disposable user profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const expectedVersion = require('../package.json').version;
if (!process.env.DROP_PILOT_PACKAGE_DIR) throw new Error('DROP_PILOT_PACKAGE_DIR is required');
const root = path.resolve(process.env.DROP_PILOT_PACKAGE_DIR);
const resourcePath = process.platform === 'darwin' ? path.join(root,'DropPilot.app/Contents/Resources') : path.join(root,'resources');
const executablePath = process.platform === 'darwin' ? path.join(root,'DropPilot.app/Contents/MacOS/DropPilot') : path.join(root,process.platform === 'win32' ? 'DropPilot.exe' : 'droppilot');
await fs.access(executablePath);
await fs.access(path.join(resourcePath,'app.asar'));
// Check bundled Chromium, independently of any system Chrome installation.
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(resourcePath,'browsers');
const { _electron, chromium } = await import('playwright');
await fs.access(chromium.executablePath());
const data = await fs.mkdtemp(path.join(os.tmpdir(),'droppilot-release-check-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  // Hosted Linux runners lack sandbox namespaces. This flag is CI-only and is
  // never part of the shipped application or normal launch command.
  const args = [`--user-data-dir=${data}`, ...(process.platform==='linux' && process.env.CI ? ['--no-sandbox'] : [])];
  app = await _electron.launch({ executablePath, args, env, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.locator('#pageTitle').waitFor();
  const state = await page.evaluate(()=>window.dropPilot.invoke('getState'));
  assert.equal(state.channels.length,0);
  assert.equal(state.browserReady,true);
  assert.equal(await app.evaluate(({app})=>app.getVersion()),expectedVersion);
  await page.locator('[data-tab="inventory"]').click();
  assert.equal(await page.locator('#pageTitle').textContent(),'Inventario');
  await page.locator('[data-tab="settings"]').click();
  await page.locator('#settingsForm').waitFor();
  const preferences = await app.evaluate(({BrowserWindow})=>{
    const p=BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {contextIsolation:p.contextIsolation,nodeIntegration:p.nodeIntegration,sandbox:p.sandbox};
  });
  assert.deepEqual(preferences,{contextIsolation:true,nodeIntegration:false,sandbox:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({version:expectedVersion,extractedArchive:true,bundledChromium:true,interface:true,preferences}));
} finally {
  if(app) await app.close();
  await fs.rm(data,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
