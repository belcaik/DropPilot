const key = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
function claimedInCampaign(channel, drop) {
  if(drop.source!=='twitch-claimed-history' || channel.platform!=='twitch' || drop.platform!==channel.platform || drop.game || drop.campaignId || drop.campaignTitle)return false;
  if(!channel.startsAt || !channel.endsAt || !Array.isArray(drop.claimedAtRange) || drop.claimedAtRange.length!==2)return false;
  const bounds=[channel.startsAt,channel.endsAt,...drop.claimedAtRange];
  if(bounds.some(value=>typeof value!=='string' || !value.trim()))return false;
  const [start,end,earliest,latest]=bounds.map(value=>Date.parse(value));
  return [start,end,earliest,latest].every(Number.isFinite) && start<end && earliest<=latest && earliest>=start && latest<=end;
}
export function isComplete(channel, inventory) {
  if(channel.completed)return true;
  if(!channel.rewardIds?.length)return false;
  return channel.rewardIds.every(reward=> inventory.some(drop=>{
    if(drop.claimed!==true)return false;
    const sameName=key(drop.name)===key(reward);
    if(sameName && claimedInCampaign(channel,drop))return true;
    const namedScope=sameName && drop.game && key(drop.game)===key(channel.game) && (!channel.campaignTitle || key(channel.campaignTitle)===key(drop.campaignTitle));
    return (key(drop.id)===key(reward) || namedScope) && (!channel.campaignId || key(channel.campaignId)===key(drop.campaignId));
  }));
}
export function campaignActive(channel,now=Date.now()) {return (!channel.startsAt || now>=Date.parse(channel.startsAt)) && (!channel.endsAt || now<Date.parse(channel.endsAt));}
export function chooseChannel(channels, inventory, active, started, now, rotationMinutes, lastUsed = {}) {
  const eligible=channels.filter(c=>c.enabled && campaignActive(c,now) && c.live===true && !isComplete(c,inventory));
  const current=eligible.find(c=>c.id===active?.id);
  if(current && now-started < rotationMinutes*60000 && !eligible.some(c=>c.priority>current.priority))return current;
  return eligible.sort((a,b)=>b.priority-a.priority || (lastUsed[a.id]??0)-(lastUsed[b.id]??0) || a.login.localeCompare(b.login))[0] ?? null;
}
export class Scheduler {
  constructor({getState, browsers, adapterFactory, emit, log}) {
    Object.assign(this,{getState,browsers,adapterFactory,emit,log});this.adapters={};this.active={twitch:null,kick:null};this.started={};this.lastUsed={};this.inventoryAt={};this.running=false;
  }
  async start() {
    if(this.running)return;
    this.running=true;this.emit();
    this.loopPromise=this.loop();
  }
  async loop() {
    while(this.running) {
      try {await this.tick();} catch(error){this.log('error',error.message);}
      if(!this.running)break;
      await new Promise(resolve=>{this.wake=resolve;this.timer=setTimeout(resolve,this.getState().settings.pollSeconds*1000);});
      this.wake=null;this.timer=null;
    }
  }
  async tick() {
    const state=this.getState();
    for(const p of ['twitch','kick']) {
      if(!this.running)return;
      const channels=state.channels.filter(c=>c.platform===p && c.enabled && campaignActive(c) && !isComplete(c,state.inventory[p]));
      if(!channels.length){if(this.adapters[p])await this.adapters[p].close();this.active[p]=null;this.emit();continue;}
      try {
        if(!this.adapters[p]) {
          const context=await this.browsers.get(p,state.settings.headless);
          this.adapters[p]=this.adapterFactory(p,{context,settings:state.settings,log:this.log});
        }
        const adapter=this.adapters[p];
        if(!this.inventoryAt[p] || Date.now()-this.inventoryAt[p]>=state.settings.inventorySeconds*1000) {
          try {
          const drops=await adapter.inventory();
          if(!this.running)return;
          state.inventory[p]=drops;this.inventoryAt[p]=Date.now();
          if(state.settings.autoClaim)for(const drop of drops.filter(d=>d.claimable&&!d.claimed)) {
            if(!this.running)return;
            await adapter.claim(drop);
            this.log('info',`Reclamación solicitada: ${drop.name}. Se confirmará en el próximo inventario.`);
          }
          } catch(error) {this.log('warn',`${p}: inventario desconocido: ${error.message}`);this.inventoryAt[p]=Date.now();}
        }
        for(const c of channels) {if(!this.running)return;c.live=await adapter.live(c);this.emit();}
        const next=chooseChannel(channels,state.inventory[p],this.active[p],this.started[p]??0,Date.now(),state.settings.rotationMinutes,this.lastUsed);
        if(next?.id!==this.active[p]?.id) {
          await adapter.close();
          this.active[p]=null;
          if(next && this.running){const playback=await adapter.watch(next);if(playback?.playbackVerified===false){await adapter.close();throw new Error(`${next.login}: no se pudo confirmar la reproducción. Revisa el navegador visible.`);}this.started[p]=Date.now();this.lastUsed[next.id]=Date.now();this.log('info',`${p}: reproduciendo ${next.login}`);}
          this.active[p]=this.running?next:null;
        }
        if(this.active[p] && adapter.health && await adapter.health()===false){await adapter.close();this.active[p]=null;this.log('warn',`${p}: el reproductor se detuvo; se volverá a evaluar en la próxima comprobación.`);}
        await this.browsers.save(p);
      } catch(error) {
        this.log('warn',`${p}: ${error.message}`);
        const failed=this.adapters[p];delete this.adapters[p];this.active[p]=null;delete this.inventoryAt[p];
        if(failed?.dispose)await failed.dispose().catch(()=>{});
        await this.browsers.close?.(p).catch(()=>{});
      }
      this.emit();
    }
  }
  async stop() {
    this.running=false;clearTimeout(this.timer);this.wake?.();
    await this.browsers.closeAll();
    await this.loopPromise;
    for(const adapter of Object.values(this.adapters))await adapter.close().catch(()=>{});
    this.adapters={};this.active={twitch:null,kick:null};this.inventoryAt={};
    await this.browsers.closeAll();this.emit();
  }
}
