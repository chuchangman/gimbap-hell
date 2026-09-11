import {MOVEMENT,clearPath} from '../public/js/spatial.js';

const BURST=1.6; // Finite prediction/jitter allowance; idle time never banks unlimited travel.
const SPEED=MOVEMENT.run*1.04;
export function movementState(now=performance.now()) {
  return {at:now,tokens:BURST,version:0,airAt:null,impulseUntil:0};
}
export function grantKnockback(p,now=performance.now()) {
  // Only a server-confirmed hit grants additional travel, never a client claim.
  p.motion.impulseUntil=now+1100;p.motion.airAt=null;
}
export function validateMove(p,d,now=performance.now()) {
  const m=p.motion || (p.motion=movementState(now));
  if((d?.version??0)!==m.version)return {ok:false,reason:'stale'};
  const elapsed=Math.max(0,now-m.at)/1000;m.at=now;
  const impulse=now<m.impulseUntil?5.4:0;
  m.tokens=Math.min(BURST,m.tokens+elapsed*(SPEED+impulse));
  const reject=reason=>{
    m.version++;
    if(reason==='height'||reason==='airtime'){p.y=0;m.airAt=null;}
    return {ok:false,reason,pose:{x:p.x,y:p.y,z:p.z,ry:p.ry,version:m.version}};
  };
  if(!d || !['x','y','z','ry'].every(k=>Number.isFinite(d[k])))return reject('nonfinite');
  if(d.y<0 || d.y>MOVEMENT.maxY)return reject('height');
  const distance=Math.hypot(d.x-p.x,d.z-p.z);
  if(distance>m.tokens+.001)return reject('speed');
  if(!clearPath(p,d))return reject('collision');
  if(d.y>.03) {
    if(m.airAt===null)m.airAt=now;
    if(now-m.airAt>1100)return reject('airtime');
  } else m.airAt=null;
  m.tokens=Math.max(0,m.tokens-distance);
  p.x=d.x;p.z=d.z;p.y=d.y;p.ry=Math.atan2(Math.sin(d.ry),Math.cos(d.ry));
  return {ok:true};
}
