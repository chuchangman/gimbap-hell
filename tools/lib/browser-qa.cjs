const os = require('node:os');
const path = require('node:path');

function loadPlaywright(env=process.env,loader=require) {
  if(env.PLAYWRIGHT_PATH) return loader(env.PLAYWRIGHT_PATH);
  try {return loader('playwright');} catch(error) {
    if(error.code && error.code!=='MODULE_NOT_FOUND') throw error;
  }
  const bundled=path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime',
    'dependencies','node','node_modules','playwright');
  try {return loader(bundled);} catch(error) {
    throw Error('Playwright is unavailable. Install it locally or set PLAYWRIGHT_PATH.',{cause:error});
  }
}

function localQaUrl(value) {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)
    ||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
    throw Error('QA_URL must be a local loopback origin without credentials, paths or queries');
  return url.origin;
}

// Wait on every page that will receive input; another client's state may arrive first.
function waitForGameState(pages,{phase='playing',paused=false}={}) {
  return Promise.all(pages.map(page=>page.waitForFunction(expected=>{
    const game=window.GB;
    return game?.S.connection==='connected' && game.S.state?.phase===expected.phase
      && game.S.state.paused===expected.paused && game.player.enabled;
  },{phase,paused})));
}
function waitForConnected(page) {
  return page.waitForFunction(()=>window.GB?.S.connection==='connected');
}
function waitForOwnPoseSynced(page,tolerance=.03) {
  return page.waitForFunction(limit=>{
    const game=window.GB,position=game?.S.positions.find(entry=>entry.id===game.S.meId);
    return !!position && Math.hypot(game.camera.position.x-position.x,game.camera.position.z-position.z)<limit;
  },tolerance);
}

module.exports={loadPlaywright,localQaUrl,waitForGameState,waitForConnected,waitForOwnPoseSynced};
