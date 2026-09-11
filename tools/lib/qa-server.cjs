// Shared local QA fixture: never connect to the developer's game or ranking store.
const { fork } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const TEMP_PREFIX = 'gimbap-qa-';

// The deployed stack. The legacy tree survives only as a test fixture that is
// read from disk — it is no longer served, so there is nothing else to run here.
const SERVER_ENTRY = 'apps/server/dist/main.js';
const CLIENT_DIST = 'apps/client/dist';

// A missing build shows up as an opaque startup failure otherwise.
async function requireBuilt() {
  for(const rel of [SERVER_ENTRY, path.join(CLIENT_DIST,'index.html')]) {
    try {await fs.access(path.join(ROOT,rel));}
    catch {throw Error('QA needs a build first: missing '+rel+' — run `npm run build`');}
  }
}

const DEFAULT_STARTUP_MS = 10000;
const DEFAULT_SHUTDOWN_MS = 6000;

function createTestEnvironment(folder, recoveryMs, inherited=process.env) {
  const env = {...inherited};
  for (const key of Object.keys(env))
    if (/^(GIMBAP_|UPSTASH_)/.test(key) || key==='NODE_OPTIONS') delete env[key];
  return {...env, PORT:'0', NODE_ENV:'test', GIMBAP_RECOVERY_MS:String(recoveryMs),
    GIMBAP_LEADERBOARD:path.join(folder,'leaderboard.json'), GIMBAP_ALLOWED_ORIGINS:'',
    UPSTASH_REDIS_REST_URL:'', UPSTASH_REDIS_REST_TOKEN:''};
}

function ownedTemporaryPath(folder, temporaryRoot=os.tmpdir()) {
  const exact=path.resolve(folder), root=path.resolve(temporaryRoot);
  if (path.dirname(exact)!==root || !path.basename(exact).startsWith(TEMP_PREFIX))
    throw Error('Unsafe QA temporary cleanup target');
  return exact;
}

function waitForReady(child, timeoutMs, logs) {
  return new Promise((resolve,reject)=>{
    const finish=(error,port)=>{
      clearTimeout(timer);child.off('message',message);child.off('exit',exit);child.off('error',fail);
      if(error) reject(error);else resolve(port);
    };
    const fail=error=>finish(error);
    const exit=code=>finish(Error('QA server exited before readiness ('+code+'): '+logs()));
    const message=data=>{
      if(data?.type!=='ready') return;
      if(!Number.isInteger(data.port)||data.port<1||data.port>65535) return finish(Error('Invalid QA server port'));
      finish(null,data.port);
    };
    const timer=setTimeout(()=>finish(Error('QA server startup timeout: '+logs())),timeoutMs);
    child.on('message',message);child.once('exit',exit);child.once('error',fail);
  });
}

const exited=child=>!child.pid || child.exitCode!==null || child.signalCode!==null;
function waitForExit(child, timeoutMs) {
  if(exited(child)) return Promise.resolve(true);
  return new Promise(resolve=>{
    const done=value=>{clearTimeout(timer);child.off('exit',onExit);resolve(value);};
    const onExit=()=>done(true);
    const timer=setTimeout(()=>done(false),timeoutMs);child.once('exit',onExit);
  });
}

async function startIsolatedServer({recoveryMs=5000,startupMs=DEFAULT_STARTUP_MS,shutdownMs=DEFAULT_SHUTDOWN_MS}={}) {
  await requireBuilt();
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),TEMP_PREFIX));
  let child, closing, logs='';
  async function close() {
    if(closing) return closing;
    closing=(async()=>{
      if(child && !exited(child)) {
        const stopped=waitForExit(child,shutdownMs);child.kill();
        if(!await stopped) {
          const forced=waitForExit(child,shutdownMs);child.kill('SIGKILL');
          if(!await forced) throw Error('QA server did not exit; its temporary directory was retained');
        }
      }
      const exact=ownedTemporaryPath(folder);
      const info=await fs.lstat(exact).catch(error=>{if(error.code!=='ENOENT')throw error;});
      if(!info) return;
      if(info.isSymbolicLink() || !info.isDirectory()) throw Error('Unsafe QA temporary directory replacement');
      await fs.rm(exact,{recursive:true,force:true});
    })();
    return closing;
  }
  try {
    const env=createTestEnvironment(folder,recoveryMs);
    env.GIMBAP_PUBLIC_ROOT=path.join(ROOT,CLIENT_DIST);
    child=fork(path.join(ROOT,SERVER_ENTRY),[],{cwd:ROOT,silent:true,env});
    const record=data=>{logs=(logs+data).slice(-8192);};
    child.stdout.on('data',record);child.stderr.on('data',record);
    const port=await waitForReady(child,startupMs,()=>logs);
    return {child,folder,url:'http://localhost:'+port,close,get logs(){return logs;}};
  } catch(error) {
    try {await close();} catch(cleanupError) {throw new AggregateError([error,cleanupError],'QA server startup and cleanup failed');}
    throw error;
  }
}

module.exports={createTestEnvironment,ownedTemporaryPath,waitForReady,startIsolatedServer,
  requireBuilt,SERVER_ENTRY,CLIENT_DIST};
