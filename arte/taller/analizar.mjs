import { NodeIO } from '@gltf-transform/core'
const io = new NodeIO()
const hex = (r,g,b) => '#' + [r,g,b].map(c => Math.round(255*(c<=0.0031308?12.92*c:1.055*c**(1/2.4)-0.055)).toString(16).padStart(2,'0')).join('')
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f)
  const skin = doc.getRoot().listSkins()[0]
  const joints = skin.listJoints().map(j => j.getName())
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0]
  const P = prim.getAttribute('POSITION'), C = prim.getAttribute('COLOR_0'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0')
  const idx = prim.getIndices().getArray()
  const n = P.getCount()
  // union-find by welded position
  const parent = [...Array(n).keys()]
  const find = a => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a }
  const uni = (a,b) => { a=find(a); b=find(b); if (a!==b) parent[a]=b }
  const key = new Map(); const p=[0,0,0]
  for (let i=0;i<n;i++){ P.getElement(i,p); const k=p.map(x=>x.toFixed(4)).join(); if(key.has(k)) uni(i,key.get(k)); else key.set(k,i) }
  for (let t=0;t<idx.length;t+=3){ uni(idx[t],idx[t+1]); uni(idx[t],idx[t+2]) }
  const comps = new Map()
  const c=[0,0,0], j=[0,0,0,0], w=[0,0,0,0]
  for (let t=0;t<idx.length;t+=3){
    const r=find(idx[t]); let o=comps.get(r); if(!o){o={tris:0,min:[9,9,9],max:[-9,-9,-9],cols:{},bones:{}};comps.set(r,o)}
    o.tris++
    for (const v of [idx[t],idx[t+1],idx[t+2]]) { P.getElement(v,p); for(let k=0;k<3;k++){o.min[k]=Math.min(o.min[k],p[k]);o.max[k]=Math.max(o.max[k],p[k])}
      J.getElement(v,j); W.getElement(v,w); for(let k=0;k<4;k++) if(w[k]>0.3) o.bones[joints[j[k]]]=(o.bones[joints[j[k]]]||0)+1 }
    C.getElement(idx[t],c); const h=hex(...c); o.cols[h]=(o.cols[h]||0)+1
  }
  console.log('==', f.split('/').pop(), 'components', comps.size)
  for (const o of [...comps.values()].sort((a,b)=>b.max[1]-a.max[1])) {
    const bones = Object.entries(o.bones).sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]).join(',')
    console.log(` tris ${o.tris} y ${o.min[1].toFixed(2)}..${o.max[1].toFixed(2)} x ${o.min[0].toFixed(2)}..${o.max[0].toFixed(2)} | ${Object.entries(o.cols).map(e=>e.join(':')).join(' ')} | ${bones}`)
  }
}
