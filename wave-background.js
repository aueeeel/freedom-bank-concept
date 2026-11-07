/* Wave Mesh, adapted from the component supplied by the user. */
(() => {
  const host=document.querySelector('.wave-background');if(!host)return;
  const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');host.prepend(canvas);
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const coarse=matchMedia('(pointer: coarse)').matches;
  const CAM=.62,NEAR=.35,FAR=3.4,dpr=Math.min(devicePixelRatio||1,1.5);
  let W=0,H=0,cols=0,rows=0,f=0,hz=0,raf=0,last=0,visible=true;
  const t0=performance.now(),ptr={x:0,z:1.4,s:0,tx:0,tz:1.4,ts:0},rings=[];
  function resize(){W=host.clientWidth;H=host.clientHeight;canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);f=Math.max(W,H*1.2)*.55;hz=H*.3;cols=Math.round(Math.min(125,Math.max(56,W/11)));rows=Math.round(Math.min(76,Math.max(48,H/12)));}
  function height(x,z,t){let y=.085*Math.sin(x*2.2+t*.7)+.07*Math.sin(z*2.9-t*.9+x*.8)+.03*Math.sin((x+z)*6.1+t*1.6);if(ptr.s>.01)y+=.24*ptr.s*Math.exp(-((x-ptr.x)**2+(z-ptr.z)**2)/.07);for(const r of rings){const age=t-r.t,d=Math.hypot(x-r.x,z-r.z);y+=.2*Math.exp(-((d-age*1.15)**2)/.014)*Math.exp(-age*.75);}return y;}
  function frame(t){ctx.clearRect(0,0,W,H);ptr.x+=(ptr.tx-ptr.x)*.1;ptr.z+=(ptr.tz-ptr.z)*.1;ptr.s+=(ptr.ts-ptr.s)*.06;while(rings.length&&t-rings[0].t>5)rings.shift();const hw=(W/2/f)*FAR*1.05;for(let j=0;j<rows;j++){const z=FAR*Math.pow(NEAR/FAR,j/(rows-1)),fog=Math.pow(1-(z-NEAR)/(FAR-NEAR),1.25),size=Math.max(.8,Math.min(3.2,2.3/z));for(let i=0;i<cols;i++){const x=-hw+i/(cols-1)*hw*2,y=height(x,z,t),sx=W/2+x/z*f,sy=hz+(CAM-y)/z*f;if(sx< -4||sx>W+4||sy>H+4)continue;ctx.fillStyle=y>.12?`rgba(182,243,74,${.16+fog*.5})`:`rgba(125,162,103,${.08+fog*.46})`;ctx.fillRect(sx-size/2,sy-size/2,size,size);}}}
  const now=()=>(performance.now()-t0)/1000;
  function loop(ms){if(document.hidden||!visible||motion.matches){raf=0;return;}raf=requestAnimationFrame(loop);if(ms-last<(coarse?42:25))return;last=ms;frame(now());}
  function wake(){if(motion.matches){cancelAnimationFrame(raf);raf=0;frame(3);}else if(!raf&&!document.hidden&&visible)raf=requestAnimationFrame(loop);}
  function ground(e){const r=host.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top;if(sx<0||sy<=hz+4||sx>W||sy>H)return null;const z=Math.min(FAR,Math.max(NEAR,CAM*f/(sy-hz)));return{x:(sx-W/2)*z/f,z};}
  function move(e){if(motion.matches||e.pointerType==='touch')return;const g=ground(e);if(g){ptr.tx=g.x;ptr.tz=g.z;}ptr.ts=g?1:0;}
  function down(e){if(motion.matches)return;const g=ground(e);if(g){rings.push({...g,t:now()});if(rings.length>8)rings.shift();}}
  const io=new IntersectionObserver(([e])=>{visible=e.isIntersecting;wake();});io.observe(host);
  const ro=new ResizeObserver(()=>{resize();frame(motion.matches?3:now());});ro.observe(host);
  resize();frame(0);wake();window.addEventListener('pointermove',move,{passive:true});window.addEventListener('pointerdown',down,{passive:true});document.addEventListener('visibilitychange',wake);motion.addEventListener('change',wake);
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);io.disconnect();ro.disconnect();window.removeEventListener('pointermove',move);window.removeEventListener('pointerdown',down);document.removeEventListener('visibilitychange',wake);motion.removeEventListener('change',wake);});
})();
