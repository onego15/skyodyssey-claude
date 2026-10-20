import { Terrain, heightAt } from '../src/terrain.js';
import { RUNWAYS, RUINS, PEAK, WORLD } from '../src/layout.js';
import fs from 'fs';
const t0=Date.now(); const T = new Terrain(); console.log('grids ms', Date.now()-t0);
for (const k in RUNWAYS){const r=RUNWAYS[k]; console.log(k, T.height(r.x,r.z).toFixed(1));}
console.log('ruins', T.height(RUINS.x,RUINS.z).toFixed(1), 'peak', T.height(PEAK.x,PEAK.z).toFixed(1));
// ring around ruins
let mn=1e9; for(let a=0;a<6.28;a+=0.2){const h=T.height(RUINS.x+900*Math.sin(a),RUINS.z-900*Math.cos(a)); mn=Math.min(mn,h); process.stdout.write(h.toFixed(0)+' ');} console.log('\nmin ring', mn);
const res=800, W=WORLD.maxX-WORLD.minX, D=WORLD.maxZ-WORLD.minZ;
const img=Buffer.alloc(res*res*3);
for(let j=0;j<res;j++)for(let i=0;i<res;i++){const x=WORLD.minX+i/res*W, z=WORLD.minZ+j/res*D; const h=T.height(x,z); let c;
 if(h<0){const k=Math.max(0,1+h/45); c=[20+40*k,60+100*k,120+80*k];} else if(h<5)c=[220,200,150]; else {const k=Math.min(1,h/1600); c=[60+190*k,140+100*k,60+190*k];}
 img.set(c.map(v=>v|0),(j*res+i)*3);}
fs.writeFileSync(process.argv[2], Buffer.concat([Buffer.from(`P6 ${res} ${res} 255\n`), img]));
