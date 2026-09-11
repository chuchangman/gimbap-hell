// Local-only visual harness. Uses the same GLBs and world.js assembly as the game.
const {loadPlaywright,localQaUrl}=require('./lib/browser-qa.cjs');
const {startIsolatedServer}=require('./lib/qa-server.cjs');
const {chromium}=loadPlaywright();
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const qaServer=process.env.QA_URL ? null : await startIsolatedServer();
  const qaUrl=process.env.QA_URL ? localQaUrl(process.env.QA_URL) : qaServer.url;
  let browser;
  try {
  browser = await chromium.launch({channel:'chrome', headless:true, args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page = await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{ if(m.type()==='error' || (m.type()==='warning' && m.text().startsWith('[assets]'))) errors.push(m.text()); });
  const output=path.resolve(process.env.CHARACTER_QA_OUTPUT || 'artifacts/character-qa'); fs.mkdirSync(output,{recursive:true});
  await page.goto(qaUrl);
  await page.waitForFunction(()=>window.GB);
  await page.locator('#cz-reset').click();
  await page.locator('[data-swatch="skin"] button').nth(3).click();
  await page.getByRole('button',{name:'하의 다음',exact:true}).click();
  const saved=await page.evaluate(()=>localStorage.getItem('gimbap:look'));
  await page.reload(); await page.waitForFunction(()=>window.GB);
  if(await page.evaluate(()=>localStorage.getItem('gimbap:look'))!==saved) throw Error('Look did not persist');
  await page.getByRole('button',{name:'걷기',exact:true}).click();
  if(await page.locator('#cz-walk').getAttribute('aria-pressed')!=='true') throw Error('Walk toggle');
  await page.locator('#cz-reset').click();
  await page.locator('#cz-walk').click();
  await page.screenshot({path:path.join(output,'customizer.png'),fullPage:true});
  const responsive=[];
  for(const width of [375,768]) {
    await page.setViewportSize({width,height:1100});
    await page.screenshot({path:path.join(output,'customizer-'+width+'.png'),fullPage:true});
    responsive.push(await page.evaluate(()=>({width:innerWidth,overflow:document.querySelector('#screen-join').scrollWidth>innerWidth})));
  }
  await page.setViewportSize({width:1440,height:1100});
  // Use a dedicated WebGL canvas; no changes to the game state or other players.
  const inspection=await page.evaluate(()=>{
    // Use the debug hook, not module paths: the bundled client has no /js/world.js.
    const {THREE,...P}=window.GB.preview;
    const W=P, C=P;
    const canvas=document.createElement('canvas');
    canvas.id='qa-character-gallery'; canvas.style='position:fixed;inset:0;z-index:10000;width:100vw;height:100vh'; document.body.append(canvas);
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setSize(1440,1100);renderer.setClearColor(0xd9d0bf);
    renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.18;
    const scene=new THREE.Scene(); scene.add(new THREE.AmbientLight(0xffffff,.90));
    const key=new THREE.DirectionalLight(0xfff7e9,1.45); key.position.set(3,6,5);scene.add(key);
    const fill=new THREE.DirectionalLight(0xddeeff,.42); fill.position.set(-4,3,-3);scene.add(fill);
    const camera=new THREE.OrthographicCamera(-4.6,4.6,3.51,-3.51,.1,30); camera.position.set(0,2.55,10);camera.lookAt(0,2.55,0);
    const looks=[{h:0,t:1,f:0,e:1},{h:1,t:0,f:4,e:2,tc:5},{h:5,t:1,e:0,b:1},{h:3,t:3,e:1,f:1,tc:6},
      {h:2,t:4,e:0,b:2,sc:3},{h:4,t:2,e:7,b:1,tc:1},{h:7,t:5,e:4,b:2,tc:3},{h:6,t:0,e:3,sc:2}];
    const models=looks.map((look,i)=>{
      const m=W.previewBody({...C.DEFAULT_LOOK,...look});scene.add(m);m.position.set((i%4-1.5)*2.1,i<4?2.8:0,0);m.rotation.y=.2;return m;
    });
    renderer.render(scene,camera);
    window.characterQA={THREE,W,C,scene,camera,renderer,models};
    return models.map(m=>{let n=0,t=0;m.traverse(o=>{if(o.isMesh){n++;t+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}});return {meshes:n,triangles:t,arm:m.userData.limbs.arms[0].children.map(o=>o.name)};});
  });
  await page.screenshot({path:path.join(output,'lineup.png')});
  for(const [label,angle,walking,holding] of [['side',Math.PI/2,false,false],['back',Math.PI,false,false],['walk',.55,true,false],['holding',.45,false,true]]) {
    await page.evaluate(({angle,walking,holding})=>{
      const q=window.characterQA;
      q.models.forEach((m,i)=>{q.W.animatePreviewBody(m,.18,walking,holding);m.position.set((i%4-1.5)*2.1,(i<4?2.8:0)+m.position.y,0);m.rotation.y=angle;});
      q.renderer.render(q.scene,q.camera);
    },{angle,walking,holding});
    await page.screenshot({path:path.join(output,label+'.png')});
  }
  const assembly=await page.evaluate(()=>{
    const q=window.characterQA; let combinations=0;
    for(let h=0;h<q.C.PARTS.hair.length;h++) for(let t=0;t<q.C.PARTS.top.length;t++) for(let b=0;b<q.C.PARTS.bottom.length;b++) {
      const model=q.W.previewBody({...q.C.DEFAULT_LOOK,h,t,b}); const limbs=model.userData.limbs;
      for(let i=0;i<2;i++) {
        if(!limbs.arms[i].children.some(c=>c.name==='sleeve'+['L','R'][i])) throw Error('Sleeve socket');
        if(!limbs.legs[i].children.some(c=>c.name==='trouser'+['L','R'][i])) throw Error('Trouser socket');
      }
      const bound=new q.THREE.Box3().setFromObject(model);
      if(bound.min.y<-.03 || bound.min.y>.08 || !Number.isFinite(bound.max.y)) throw Error('Foot origin or finite bounds');
      q.W.animatePreviewBody(model,.24,true); q.W.animatePreviewBody(model,0,false);
      if(limbs.legs.some((leg,i)=>leg.quaternion.angleTo(limbs.legRest[i])>1e-6)) throw Error('Rest pose');
      q.W.disposePreviewBody(model); combinations++;
    }
    return {combinations};
  });
  const refinement=await page.evaluate(()=>{
    const q=window.characterQA;
    q.models.forEach(m=>{q.scene.remove(m);q.W.disposePreviewBody(m);});
    q.models=q.C.PARTS.expression.map((_,e)=>{
      const m=q.W.previewBody({...q.C.DEFAULT_LOOK,h:8,t:0,e});
      m.position.set((e%4-1.5)*1.5,e<4?1.65:0,0);q.scene.add(m);return m;
    });
    q.camera.left=-3.15;q.camera.right=3.15;q.camera.top=2.40625;q.camera.bottom=-2.40625;
    q.camera.position.set(0,2.5,10);q.camera.lookAt(0,2.5,0);q.camera.updateProjectionMatrix();
    q.renderer.render(q.scene,q.camera);
    const sample=q.models[4],b=sample.userData.limbs;
    sample.updateMatrixWorld(true);
    const headSize=new q.THREE.Box3().setFromObject(b.head).getSize(new q.THREE.Vector3());
    if(headSize.x<.75||headSize.x>.78) throw Error('Refined head dimensions: '+JSON.stringify(headSize.toArray()));
    const shoulders=b.arms.map(arm=>({name:arm.name,position:arm.position.toArray(),
      garment:arm.children.find(c=>/^sleeve[LR]$/.test(c.name))?.name}));
    if(Math.abs(shoulders[0].position[0]+shoulders[1].position[0])>1e-6) throw Error('Shoulder symmetry');
    const frames=[0,Math.PI/2,Math.PI,Math.PI*1.5,Math.PI*2].map(phase=>{
      q.W.animatePreviewBody(sample,phase/7,true);sample.updateMatrixWorld(true);
      return {phase,headSize:new q.THREE.Box3().setFromObject(b.head).getSize(new q.THREE.Vector3()).toArray(),
        arms:b.arms.map(a=>a.quaternion.toArray()),
        footMinimum:b.legs.map(leg=>new q.THREE.Box3().setFromObject(leg).min.y)};
    });
    for(const frame of frames) if(frame.headSize.some((n,i)=>Math.abs(n-headSize.toArray()[i])>1e-5)) throw Error('Animated head scale drift');
    return {headSize:headSize.toArray(),shoulders,frames};
  });
  await page.screenshot({path:path.join(output,'expressions.png')});
  for(const [label,angle,top,holding] of [['detail-front',0,0,false],['detail-shoulder',.65,0,false],
    ['detail-hoodie',.65,3,false],['detail-holding',.65,0,true]]) {
    await page.evaluate(({angle,top,holding})=>{
      const q=window.characterQA;
      q.models.forEach(m=>{q.scene.remove(m);q.W.disposePreviewBody(m);});
      const m=q.W.previewBody({...q.C.DEFAULT_LOOK,t:top});q.models=[m];q.scene.add(m);
      q.W.animatePreviewBody(m,0,false,holding);m.rotation.y=angle;
      q.camera.left=-.95;q.camera.right=.95;q.camera.top=.7257;q.camera.bottom=-.7257;
      q.camera.position.set(0,1.61,5);q.camera.lookAt(0,1.61,0);q.camera.updateProjectionMatrix();
      q.renderer.render(q.scene,q.camera);
    },{angle,top,holding});
    await page.screenshot({path:path.join(output,label+'.png')});
  }
  await page.evaluate(()=>document.getElementById('qa-character-gallery').remove());
  await page.locator('#input-name').fill('클레이검사방장');
  await page.locator('#input-shop').fill('캐릭터 QA');
  await page.locator('[data-swatch="skin"] button').nth(4).click();
  await page.getByRole('button',{name:'하의 다음',exact:true}).click();
  await page.locator('#btn-create').click();
  await page.waitForFunction(()=>window.GB.S.state?.code);
  const code=await page.evaluate(()=>window.GB.S.state.code);
  const guest=await browser.newPage({viewport:{width:1440,height:1000}});
  guest.on('pageerror',e=>errors.push(e.message));
  await guest.goto(qaUrl); await guest.waitForFunction(()=>window.GB);
  await guest.locator('#cz-reset').click();
  await guest.locator('#input-name').fill('클레이검사동료'); await guest.locator('#input-code').fill(code);
  await guest.locator('#btn-join').click();
  await guest.waitForFunction(()=>window.GB.S.state?.players.length===2);
  const synced=await guest.evaluate(()=>window.GB.S.state.players.find(p=>p.id===window.GB.S.state.hostId).look);
  if(synced.sc!==4||synced.b!==1) throw Error('Network look sync');
  await page.locator('#btn-start').click();
  await guest.waitForFunction(()=>window.GB.player.enabled);
  await guest.waitForFunction(()=>window.GB.scene.children.some(o=>o.userData.limbs));
  const remote=await guest.evaluate(()=>{
    const model=window.GB.scene.children.find(o=>o.userData.limbs);const b=model.userData.limbs;
    return {headColor:b.head.material.color.getHexString(),sleeve:b.arms[0].children.some(o=>o.name==='sleeveL'),pant:b.legs[0].children.some(o=>o.name==='trouserL')};
  });
  if(remote.headColor!=='81583f'||!remote.sleeve||!remote.pant) throw Error('Remote asset appearance: '+JSON.stringify(remote));
  await guest.evaluate(()=>{
    const g=window.GB;g.player.enabled=false;
    const av=g.scene.children.find(o=>o.userData.limbs);
    const direction=av.position.clone().set(0,0,1).applyQuaternion(av.quaternion);
    // Independent camera observes the actual remote avatar in the live game scene.
    // The normal first-person controller must not overwrite this inspection view.
    const {THREE}=g.preview;
    const camera=g.camera.clone(); camera.position.copy(av.position).addScaledVector(direction,3.5);
    camera.position.x+=.6;camera.position.y=1.5;
    camera.lookAt(av.position.x,1.25,av.position.z);
    camera.clear();
    const canvas=document.createElement('canvas');canvas.style='position:fixed;inset:0;z-index:10001';document.body.append(canvas);
    const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setSize(innerWidth,innerHeight);
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
    g.scene.updateMatrixWorld(true);renderer.render(g.scene,camera);
  });
  await guest.screenshot({path:path.join(output,'in-game.png')});
  await page.evaluate(()=>window.GB.S.socket.disconnect());
  await guest.evaluate(()=>window.GB.S.socket.disconnect());
  const report={errors,inspection,responsive,assembly,refinement,savedSelection:true,networkSynced:synced,remote,
    visualBaseline:'INCONCLUSIVE: no committed baseline; screenshots manually inspected'};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(errors.length||responsive.some(r=>r.overflow)) throw Error('QA errors');
  } finally { if(browser) await browser.close(); if(qaServer) await qaServer.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
