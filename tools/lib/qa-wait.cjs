const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,{timeoutMs=5000,intervalMs=25,label='observed condition'}={}) {
  const end=performance.now()+timeoutMs;
  while(performance.now()<end) {
    const result=await predicate();if(result) return result;
    await delay(intervalMs);
  }
  throw Error('Timed out waiting for '+label);
}
module.exports={delay,until};
