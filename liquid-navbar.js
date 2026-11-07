/* Nimbus UI · Liquid Navbar “Waterline” — guglielmogiannattasio.it.
 * Vanilla adaptation of the user-supplied shader and spring/drop simulation.
 * No React, sound, icon animations, or external dependencies are required.
 */
(() => {
  'use strict';
  const nav = document.querySelector('.nimbus-nav');
  if (!nav) return;
  const canvas = nav.querySelector('.nimbus-water');
  const drop = nav.querySelector('.nimbus-drop');
  const items = [...nav.querySelectorAll('.nimbus-item')];
  const PAD = 14;
  const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FRAG = `precision highp float;
uniform vec2 uRes;uniform float uDpr;uniform float uTime;uniform vec4 uPill;
uniform vec4 uBlob[6];uniform float uSy[6];uniform vec4 uRip[6];uniform vec3 uMouse;uniform float uDark;uniform float uAmb;
float sdRB(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
float sdCap(vec2 p,vec4 B,float sy){p-=B.xy;p.y/=sy;p.x=max(abs(p.x)-B.z,0.);return(length(p)-B.w)*min(1.,sy);}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
float dropD(vec2 p){float d=1e4;for(int i=0;i<6;i++){if(uBlob[i].w>.5){d=smin(d,sdCap(p,uBlob[i],uSy[i]),13.);}}return d;}
float pillD(vec2 p){vec2 h=uPill.zw*.5;return sdRB(p-uPill.xy-h,h,h.y);}
float lens(float d,float w){float t=clamp(-d/w,0.,1.);return sqrt(1.-(1.-t)*(1.-t));}
float waves(vec2 p){float w=0.;
 for(int i=0;i<6;i++){vec4 R=uRip[i];if(R.w>0.){float x=length(p-R.xy)-R.z*240.;w+=R.w*exp(-R.z*1.7)*sin(x*.3)*exp(-x*x/700.);}}
 vec2 m=p-uMouse.xy;w+=uMouse.z*3.6*exp(-dot(m,m)/1000.);
 w+=uAmb*(sin(p.x*.05+uTime*1.2)*.45+sin(p.x*.13-uTime*.85+p.y*.2)*.25);return w;}
float H(vec2 p){float dp=pillD(p);return lens(dp,uPill.w*.36)*2.4+lens(dropD(p),11.)*7.5+waves(p)*smoothstep(0.,7.,-dp);}
float caus(vec2 p,float t){vec2 q=p;float c=0.;for(int i=0;i<3;i++){q+=vec2(sin(q.y*1.1+t),cos(q.x*1.3-t*.7))*.6;c+=1./(1.+16.*abs(sin(q.x)*sin(q.y)));}return c/3.;}
void main(){
 vec2 p=vec2(gl_FragCoord.x,uRes.y*uDpr-gl_FragCoord.y)/uDpr;
 float dp=pillD(p);float dd=dropD(p);
 float h0=H(p);vec3 n=normalize(vec3(h0-H(p+vec2(1.,0.)),h0-H(p+vec2(0.,1.)),1.));
 vec3 V=vec3(0.,0.,1.);
 float spec=pow(max(dot(reflect(-normalize(vec3(-.45,-.8,.85)),n),V),0.),70.);
 float spec2=pow(max(dot(reflect(-normalize(vec3(.6,.75,.7)),n),V),0.),22.)*.3;
 float fres=clamp((1.-n.z)*4.,0.,1.);
 vec3 irid=.5+.5*cos(6.2831*(vec3(0.,.33,.67)+fres*.85+p.x*.0028+uTime*.035));
 float pm=smoothstep(1.,-1.,dp);float dm=smoothstep(1.,-1.,dd)*smoothstep(1.,-2.,dp);
 float sh=smoothstep(9.,-9.,dropD(p-vec2(0.,5.)))*(1.-dm)*pm*(.11+.07*uDark);
 vec3 c=vec3(0.,.14,.36)*sh;float a=sh;
 float pa=clamp(pm*(fres*.5+spec*.9+spec2),0.,1.);
 c=mix(vec3(1.),irid,.5*fres)*pa+c*(1.-pa);a=pa+a*(1.-pa);
 float th=lens(dd,11.);
 float cs=caus((p+n.xy*th*18.)*.085,uTime*.9);
 vec3 tint=mix(vec3(.80,.95,1.),vec3(.55,.82,1.),uDark);
 float rim=dm*(1.-smoothstep(0.,8.,-dd));
 float cres=dm*smoothstep(.12,.55,dot(n.xy,normalize(vec2(.55,.85))))*smoothstep(0.,3.,-dd);
 float body=.5+.5*clamp(-n.y*3.,-1.,1.);
 float da=dm*(.26+.14*body)*(1.-.35*uDark);vec3 dc=mix(tint,vec3(1.),body*.6);
 float la=rim*.22;vec3 lc=mix(vec3(0.,.42,.78),vec3(.1,.55,.95),uDark);dc=lc*la+dc*da*(1.-la);da=la+da*(1.-la);
 la=clamp(cres*.7+smoothstep(.6,1.,cs)*.28*th*dm,0.,1.);dc=vec3(1.)*la+dc*(1.-la);da=la+da*(1.-la);
 la=clamp(dm*(spec*1.2+spec2*.5),0.,1.);dc=vec3(1.)*la+dc*(1.-la);da=la+da*(1.-la);
 la=dm*smoothstep(-2.,0.,dd)*.4;dc=mix(vec3(1.),irid,.35)*la+dc*(1.-la);da=la+da*(1.-la);
 c=dc+c*(1.-da);a=da+a*(1.-da);
 gl_FragColor=vec4(c,a);
}`;
  function initGL() {
    const gl = canvas.getContext('webgl', {premultipliedAlpha:true,alpha:true,antialias:false});
    if (!gl) return null;
    const shaders = [];
    let program, buffer;
    function dispose() {
      shaders.forEach(shader => gl.deleteShader(shader));
      if (program) gl.deleteProgram(program);
      if (buffer) gl.deleteBuffer(buffer);
    }
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER,VERT],[gl.FRAGMENT_SHADER,FRAG]]) {
        const shader = gl.createShader(type);
        if (!shader) {dispose(); return null;}
        shaders.push(shader);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {dispose(); return null;}
      }
      program = gl.createProgram();
      if (!program) {dispose(); return null;}
      shaders.forEach(shader => gl.attachShader(program, shader));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) {dispose(); return null;}
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program,'a');
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
      const u = {};
      for (const name of ['uRes','uDpr','uTime','uPill','uBlob','uSy','uRip','uMouse','uDark','uAmb']) {
        u[name] = gl.getUniformLocation(program, ['uBlob','uSy','uRip'].includes(name) ? `${name}[0]` : name);
      }
      return {gl,u};
    } catch {dispose(); return null;}
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const s = {
    a:{x:0,v:0},b:{x:0,v:0},sy:{s:1,v:0},lead:0,lagFrom:0,
    sats:[],rips:[],t:{x:0,cy:0,q:0,r:21},q:0,
    mouse:{x:0,y:0,s:0,on:false},moving:false,split:false,ready:false,
    w:0,h:0,intersecting:false,reduce:reduce.matches,raf:0,last:0,time:0,glc:null,
  };
  let current = 0;
  const blobs = new Float32Array(24), scales = new Float32Array(6), ripples = new Float32Array(24);
  function draw() {
    const T = s.t, sep = Math.abs(s.a.x-s.b.x);
    const thin = Math.min(sep/(2*(s.q+T.r)||1),1), r = T.r*(1-.3*thin);
    if (!s.glc) {
      drop.style.width = `${sep+2*(s.q+r)}px`;
      drop.style.transform = `translateX(${Math.min(s.a.x,s.b.x)-s.q-r-PAD}px) scaleY(${s.sy.s})`;
      return;
    }
    const {gl:g,u} = s.glc, dpr = Math.min(devicePixelRatio||1,2);
    g.viewport(0,0,g.drawingBufferWidth,g.drawingBufferHeight);
    g.uniform2f(u.uRes,s.w+PAD*2,s.h+PAD*2);g.uniform1f(u.uDpr,dpr);g.uniform1f(u.uTime,s.time);
    g.uniform4f(u.uPill,PAD,PAD,s.w,s.h);
    blobs.fill(0);scales.fill(1);ripples.fill(0);
    const head = s.lead===0?s.a:s.b, tail = s.lead===0?s.b:s.a;
    blobs.set([head.x,T.cy,s.q*(1-.25*thin),T.r*(1-.12*thin),tail.x,T.cy,s.q*(1-.8*thin),T.r*(1-.5*thin)]);
    scales[0]=scales[1]=s.sy.s;
    s.sats.slice(0,4).forEach((d,i)=>blobs.set([d.x,d.y,0,d.r],8+i*4));
    s.rips.slice(-6).forEach((p,i)=>ripples.set([p.x,p.y,p.age,p.amp],i*4));
    g.uniform4fv(u.uBlob,blobs);g.uniform1fv(u.uSy,scales);g.uniform4fv(u.uRip,ripples);
    g.uniform3f(u.uMouse,s.mouse.x,s.mouse.y,s.mouse.s);g.uniform1f(u.uDark,nav.dataset.tone==='dark'?1:0);g.uniform1f(u.uAmb,s.reduce?0:1);
    g.clearColor(0,0,0,0);g.clear(g.COLOR_BUFFER_BIT);g.drawArrays(g.TRIANGLES,0,3);
  }
  function step(dt,now) {
    const T=s.t;s.time+=dt;s.q+=(T.q-s.q)*Math.min(1,dt*12);
    const bodies=[s.a,s.b];let still=true;
    if(s.reduce){s.a.x=s.b.x=T.x;s.a.v=s.b.v=0;s.sy.s=1;s.sy.v=0;s.sats=[];s.q=T.q;s.rips=[];s.mouse.s=0;}
    else {
      bodies.forEach((B,i)=>{
        const lead=i===s.lead,k=lead?210:72,c=lead?25:13,f=!lead&&now<s.lagFrom?.08:1;
        B.v+=(k*(T.x-B.x)-c*B.v)*dt*f;B.x+=B.v*dt;
        const lo=PAD+6+s.q+T.r-3,hi=PAD+s.w-6-s.q-T.r+3;
        if(B.x<lo||B.x>hi){s.sy.v-=Math.min(Math.abs(B.v),900)*.0016;B.x=Math.max(lo,Math.min(hi,B.x));B.v*= -.25;}
        if(Math.abs(T.x-B.x)>.3||Math.abs(B.v)>3)still=false;
      });
      const lead=bodies[s.lead],syT=1-.2*Math.min(Math.abs(lead.v)/1500,1);
      s.sy.v+=(280*(syT-s.sy.s)-9*s.sy.v)*dt;s.sy.s+=s.sy.v*dt;
      if(Math.abs(s.sy.s-1)>.002||Math.abs(s.sy.v)>.02)still=false;
      const sep=Math.abs(s.a.x-s.b.x),r=T.r*(1-.3*Math.min(sep/(2*(T.q+T.r)||1),1));
      if(!s.split&&s.moving&&sep-2*T.q-2*r> -6){
        s.split=true;const lo=bodies[1-s.lead],hi=bodies[s.lead];
        [.3,.5,.72].forEach((t,j)=>s.sats.push({x:lo.x+(hi.x-lo.x)*t+(Math.random()-.5)*6,y:T.cy+(Math.random()-.5)*10,vx:(lo.v+hi.v)*.45,vy:(Math.random()-.5)*60,r:5+Math.random()*3-j*.5,k:70+Math.random()*90}));
      }
      s.sats=s.sats.filter(d=>{
        d.vx+=(d.k*(T.x-d.x)-9*d.vx)*dt;d.vy+=(90*(T.cy-d.y)-7*d.vy)*dt;d.x+=d.vx*dt;d.y+=d.vy*dt;
        d.x=Math.max(PAD+8+d.r,Math.min(PAD+s.w-8-d.r,d.x));d.y=Math.max(T.cy-T.r+d.r,Math.min(T.cy+T.r-d.r,d.y));
        if(Math.abs(T.x-d.x)<T.q+T.r*.5)d.r-=dt*26;return d.r>.6;
      });
      if(s.sats.length)still=false;
    }
    if(s.moving&&still){s.moving=false;if(!s.reduce)s.rips.push({x:T.x,y:T.cy,age:0,amp:s.split?1.2:.7});}
    s.rips.forEach(p=>p.age+=dt);s.rips=s.rips.filter(p=>p.age<2.4);
    if(!s.reduce)s.mouse.s+=((s.mouse.on?1:0)-s.mouse.s)*Math.min(1,dt*7);
  }
  function visible(){return s.intersecting&&!document.hidden&&s.w>0;}
  function loop(){
    if(s.raf||!visible())return;
    s.last=performance.now();
    function tick(now){
      if(!visible()){s.raf=0;return;}
      const dt=Math.min((now-s.last)/1000,1/30);s.last=now;step(dt,now);draw();
      const busy=s.moving||s.rips.length||s.sats.length||s.mouse.s>.01;
      s.raf=(!s.reduce||busy)?requestAnimationFrame(tick):0;
    }
    s.raf=requestAnimationFrame(tick);
  }
  function measure(){
    const el=items[current];s.w=nav.offsetWidth;s.h=nav.offsetHeight;
    if(!s.w||!s.h){s.ready=false;return;}
    const T=s.t;T.r=el.offsetHeight/2;T.q=Math.max(0,el.offsetWidth/2-T.r);T.cy=PAD+el.offsetTop+el.offsetHeight/2;
    const nx=PAD+el.offsetLeft+el.offsetWidth/2;
    if(!s.ready){s.a.x=s.b.x=nx;s.q=T.q;s.ready=true;}
    else if(Math.abs(nx-T.x)>.5){s.lead=Math.abs(nx-s.a.x)<=Math.abs(nx-s.b.x)?0:1;s.lagFrom=performance.now()+70;s.moving=true;s.split=false;}
    T.x=nx;
    const dpr=Math.min(devicePixelRatio||1,2),w=s.w+PAD*2,h=s.h+PAD*2;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;
    }
    if(s.reduce)step(0,performance.now());draw();loop();
  }
  function select(index){
    current=index;items.forEach((item,i)=>{if(i===index)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});measure();
  }
  function local(event){const rect=nav.getBoundingClientRect();return{x:event.clientX-rect.left+PAD,y:event.clientY-rect.top+PAD};}
  nav.addEventListener('click',event=>{const index=items.indexOf(event.target.closest('.nimbus-item'));if(index>=0)select(index);});
  nav.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const index=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowRight'?1:-1)+items.length)%items.length;
    select(index);items[index].focus();
  });
  nav.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse'||s.reduce)return;
    Object.assign(s.mouse,local(event),{on:true});loop();
  },{passive:true});
  nav.addEventListener('pointerleave',()=>{s.mouse.on=false;loop();});
  nav.addEventListener('pointerdown',event=>{
    if(s.reduce)return;const p=local(event);s.rips.push({...p,age:0,amp:.8});s.rips=s.rips.slice(-6);loop();
  },{passive:true});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();s.glc=null;nav.dataset.gl='off';draw();});
  canvas.addEventListener('webglcontextrestored',()=>{s.glc=initGL();nav.dataset.gl=s.glc?'on':'off';measure();});
  s.glc=initGL();nav.dataset.gl=s.glc?'on':'off';
  if(/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent)&&!/Firefox\//.test(navigator.userAgent)&&CSS.supports('backdrop-filter','url(#a)'))nav.dataset.refract='on';
  const observer=new IntersectionObserver(([entry])=>{s.intersecting=entry.isIntersecting;if(s.intersecting)loop();});observer.observe(nav);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)loop();});
  const resize=new ResizeObserver(()=>{s.ready=false;measure();});resize.observe(nav);items.forEach(item=>resize.observe(item));
  reduce.addEventListener('change',()=>{s.reduce=reduce.matches;s.mouse.on=false;measure();});
  document.fonts.ready.then(measure);window.addEventListener('resize',measure,{passive:true});
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(s.raf);s.raf=0;});
  window.addEventListener('pageshow',loop);
  measure();
})();
