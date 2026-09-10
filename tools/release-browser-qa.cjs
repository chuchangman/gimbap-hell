// Local-only release journey. Each run owns its server, browser and temporary data.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {loadPlaywright,localQaUrl,waitForGameState,waitForOwnPoseSynced}=require('./lib/browser-qa.cjs');
const {startIsolatedServer}=require('./lib/qa-server.cjs');
const {chromium}=loadPlaywright();

(async () => {
  const output = path.resolve('artifacts/release-qa');
  await fs.mkdir(output, {recursive:true});
  const qaServer=process.env.QA_URL ? null : await startIsolatedServer({recoveryMs:5000,startupMs:15000});
  let browser;
  const pages=[];
  const report = {checks:[], errors:[], networkErrors:[], responsive:[],
    visualRegression:'INCONCLUSIVE: no committed baseline', accessibility:'Not a full WCAG audit'};
  let intentionalOffline = false;
  try {
    const url=process.env.QA_URL ? localQaUrl(process.env.QA_URL) : qaServer.url;
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
    const hostContext=await browser.newContext({viewport:{width:1440,height:1000}});
    const guestContext=await browser.newContext({viewport:{width:1440,height:1000}});
    async function pageIn(context) {
      const page=await context.newPage();
      pages.push(page);
      page.on('pageerror',e=>report.errors.push(e.message));
      page.on('console',m=>{
        if(m.type()==='error' && (!intentionalOffline || /Content Security Policy|Refused to|TypeError|ReferenceError/i.test(m.text()))) report.errors.push(m.text());
      });
      page.on('response',r=>{if(r.status()>=400 && !intentionalOffline) report.networkErrors.push({url:new URL(r.url()).pathname,status:r.status()});});
      await page.goto(url);
      await page.waitForFunction(()=>window.GB?.S.connection==='connected');
      return page;
    }
    const host=await pageIn(hostContext);
    await host.keyboard.press('Tab');
    assert.equal(await host.locator('#overlay-help').isVisible(),false,'Tab must navigate focus, not open help');
    report.checks.push('Tab preserves standard focus navigation on join screen');
    for(const width of [375,768,1440]) {
      await host.setViewportSize({width,height:1000});
      await host.screenshot({path:path.join(output,'join-'+width+'.png'),fullPage:true});
      report.responsive.push(await host.evaluate(()=>({width:innerWidth,overflow:document.querySelector('#screen-join').scrollWidth>innerWidth})));
    }
    assert.ok(report.responsive.every(x=>!x.overflow),'Join viewport overflow');
    await host.locator('#input-name').fill('테스트방장');
    await host.locator('#input-shop').fill('출시검사가게');
    await host.locator('#btn-create').click();
    await host.waitForFunction(()=>window.GB.S.state?.code);
    const original=await host.evaluate(()=>({id:window.GB.S.meId,code:window.GB.S.state.code}));
    const guest=await pageIn(guestContext);
    await guest.locator('#input-name').fill('테스트동료');
    await guest.locator('#input-code').fill(original.code);
    await guest.locator('#btn-join').click();
    await guest.waitForFunction(()=>window.GB.S.state?.players.length===2);
    await host.locator('#btn-start').click();
    await waitForGameState([host,guest]);
    const poses=await Promise.all([host,guest].map(p=>p.evaluate(()=>({x:window.GB.camera.position.x,z:window.GB.camera.position.z}))));
    assert.notDeepEqual(poses[0],poses[1],'All players spawned at same location');
    report.checks.push('Two-client UI join/start, separate server-provided spawns');
    await guest.keyboard.press('p');
    await host.waitForTimeout(150);
    assert.equal(await host.evaluate(()=>window.GB.S.state.paused),false,'Guest paused the game');
    await host.keyboard.press('p');
    await waitForGameState([host,guest],{paused:true});
    await host.keyboard.press('p');
    await waitForGameState([host,guest]);
    report.checks.push('P pause/resume is host-only in both browsers');
    // Walk using the real controller; no coordinate teleport or direct item mutation.
    async function walkTo(page,x,z) {
      await page.evaluate(({x,z})=>{const p=window.GB.camera.position;window.GB.setLook(Math.atan2(-(x-p.x),-(z-p.z)),0);},{x,z});
      await page.bringToFront();
      await page.keyboard.down('w');
      try {await page.waitForFunction(({x,z})=>Math.hypot(window.GB.camera.position.x-x,window.GB.camera.position.z-z)<.22,{x,z},{timeout:12000});}
      finally {await page.keyboard.up('w');}
    }
    await walkTo(host,-4.4,5.6);await walkTo(host,-4.4,-4.25);
    await host.evaluate(()=>{const p=window.GB.camera.position;
      window.GB.setLook(Math.atan2(-(-6.5-p.x),-(-4.25-p.z)),Math.atan2(1.24-p.y,Math.hypot(-6.5-p.x,-4.25-p.z)));});
    await host.waitForFunction(()=>window.GB.player.target?.userData.station.item==='rice');
    await host.keyboard.press('e');
    await host.waitForFunction(()=>window.GB.S.kitchen.hands.find(h=>h.id===window.GB.S.meId)?.holding?.id==='rice');
    // The view updates every frame, while the authoritative pose is sent at a
    // fixed network tick. Disconnect only after that last movement is observed.
    await waitForOwnPoseSynced(host);
    const before=await host.evaluate(()=>({x:window.GB.camera.position.x,z:window.GB.camera.position.z}));
    intentionalOffline=true;
    await hostContext.setOffline(true);
    // Explicit transport closure makes disconnect detection deterministic; retry occurs while offline.
    await host.evaluate(()=>window.GB.S.socket.io.engine.close());
    await host.waitForFunction(()=>window.GB.S.connection==='reconnecting');
    await guest.waitForFunction(()=>window.GB.S.state.paused);
    assert.equal(await host.locator('#connection-status').isVisible(),true);
    assert.equal(await host.evaluate(()=>window.GB.player.enabled),false);
    const rejected=await host.evaluate(async()=>{
      const N=await import('/js/net.js');
      return {sent:N.emit('kitchen:act',{action:'drop',payload:{}}),queued:N.S.socket.sendBuffer.length};
    });
    assert.deepEqual(rejected,{sent:false,queued:0});
    await host.screenshot({path:path.join(output,'connection-interrupted.png')});
    await hostContext.setOffline(false);
    await waitForGameState([host,guest]);
    const restored=await host.evaluate(()=>({id:window.GB.S.meId,item:window.GB.S.kitchen.hands.find(h=>h.id===window.GB.S.meId)?.holding?.id,x:window.GB.camera.position.x,z:window.GB.camera.position.z}));
    assert.equal(restored.id,original.id); assert.equal(restored.item,'rice');
    assert.ok(Math.hypot(restored.x-before.x,restored.z-before.z)<.05,'Recovered pose moved');
    report.checks.push('Temporary outage restores identity/hand/pose; offline actions are not queued; host auto-pause/resume');
    intentionalOffline=false;
    await host.screenshot({path:path.join(output,'connection-restored.png')});
    await host.keyboard.press('p');
    await guest.waitForFunction(()=>window.GB.S.state.paused);
    intentionalOffline=true;
    await hostContext.setOffline(true);
    await host.evaluate(()=>window.GB.S.socket.io.engine.close());
    await guest.waitForFunction(()=>window.GB.S.state.players.length===1 && window.GB.S.state.hostId===window.GB.S.meId,{},{timeout:12000});
    await hostContext.setOffline(false);
    await host.waitForFunction(()=>window.GB.S.connection==='connected' && !window.GB.S.state);
    assert.equal(await host.locator('#screen-join').isVisible(),true);
    assert.equal(await host.locator('#btn-join').isEnabled(),true);
    assert.equal(await host.locator('#pause-overlay').isVisible(),false,'Expired session left a blocking pause overlay');
    assert.equal(await guest.evaluate(()=>window.GB.S.state.paused),true);
    await guest.keyboard.press('p');
    await guest.waitForFunction(()=>!window.GB.S.state.paused);
    intentionalOffline=false;
    report.checks.push('Expired recovery returns to usable join UI; connected guest inherits host and can resume');
    await host.screenshot({path:path.join(output,'connection-expired.png'),fullPage:true});
    await host.locator('#btn-create').click();
    await host.waitForFunction(()=>window.GB.S.state?.phase==='lobby');
    assert.notEqual(await host.evaluate(()=>window.GB.S.state.code),original.code);
    report.checks.push('After recovery expiry, a real click creates a new usable room');
    report.health=await (await fetch(url+'/health')).json();
    assert.deepEqual(report.errors,[],'Browser/CSP errors');
    assert.deepEqual(report.networkErrors,[],'Unexpected failed HTTP responses');
    report.status='PASS: scoped local Chrome journeys only';
  } catch(error) {
    report.status='FAIL'; report.failure=error.stack;
    report.failureStates=await Promise.all(pages.map(p=>p.evaluate(()=>({connection:window.GB?.S.connection,
      id:window.GB?.S.meId,state:window.GB?.S.state,pose:window.GB?.getPose(),motionVersion:window.GB?.S.motionVersion,
      enabled:window.GB?.player.enabled,overlay:window.GB?.player.overlayOpen,positions:window.GB?.S.positions,
      transport:window.GB?.S.socket.io.engine?.transport.name})).catch(()=>null)));
    throw error;
  } finally {
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    if(browser) await browser.close();
    if(qaServer) await qaServer.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
