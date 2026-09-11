// IPC-only child for the isolated crash/restart test. Not served by the game.
import {createRankingStore} from '../../legacy/server/ranking-store.mjs';
const store=createRankingStore({...JSON.parse(process.argv[2]),timeoutMs:500,retryMs:100000});
await store.init();
process.send({type:'ready',health:store.health()});
process.on('message',message=>{
  if(message.type==='add') {
    store.add(message.row);
    process.send({type:'added',health:store.health()});
  }
});
