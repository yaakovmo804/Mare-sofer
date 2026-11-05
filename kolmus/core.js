/* Mareh Sofer · two-contact demonstration format v1 */
(function kolmusCore(){
  "use strict";
  const WIDTH = 960, HEIGHT = 640;
  const FORMAT = "mareh-sofer/kolmus-demonstration";
  const MODES = ["fill","paths","tip1","tip4"];
  const DEFAULT_STYLE = Object.freeze({mode:"fill", ink:"#222123", inkOpacity:1, first:"#227d7b", fourth:"#ab5133", w1:4, w4:4, a1:1, a4:1});
  const clamp = (n,min,max)=>Math.max(min, Math.min(max,n));
  const finite = (v,lo,hi)=>typeof v==="number" && Number.isFinite(v) && v>=lo && v<=hi;
  const color = v=>typeof v==="string" && /^#[0-9a-f]{6}$/i.test(v);
  const validPoint = p=>p===null || (Array.isArray(p) && p.length===2 && finite(p[0],0,WIDTH) && finite(p[1],0,HEIGHT));
  function angleOf(one,four){
    if(!one || !four) return null;
    let dx = four[0]-one[0], dy = four[1]-one[1];
    if(Math.hypot(dx,dy)<1) return null;
    if(dy<0 || (dy===0 && dx>0)){dx=-dx;dy=-dy;}
    return Math.atan2(-dx,dy)*180/Math.PI || 0;
  }
  function reading(angle){
    if(angle===null) return null;
    const step=Math.floor((angle+1e-9)/6);
    return {clock:"12:"+String(30+step).padStart(2,"0"), angle, within:Math.max(0,angle-step*6)};
  }
  function fresh(reference=null){
    return {format:FORMAT,version:1,coordinates:{width:WIDTH,height:HEIGHT,origin:"top-left",x:"right",y:"down",units:"board units"},timing:"milliseconds from session origin",angleConvention:"0 at vertical 12:30; positive when lower endpoint tilts left; 6 degrees per clock minute; raw contact positions are authoritative",reference,grid:"fine",strokes:[],clips:[]};
  }
  function eventSample(t,one,four,event){
    return {t,tip1:one&&one.slice(),tip4:four&&four.slice(),event,angleDeg:angleOf(one,four)};
  }
  // An up first retains the final contact location as a move, then removes it.
  // Touch Events supply both new positions in one batch. Pointer IDs never select the nib by parity.
  function tracker(onStart,onSample,onEnd){
    const contacts=new Map();
    let active=null, lastTime=0;
    function take(t,event){
      let one=null,four=null;
      for(const c of contacts.values()){if(c.tip===1) one=c.p;else four=c.p;}
      const f=eventSample(t,one,four,event);
      active.samples.push(f); onSample(active,f);
    }
    function apply(phase,updates,rawTime,style,firstTip=1,source="touch"){
      if(!updates.length) return;
      const t=Math.max(lastTime,rawTime);lastTime=t;
      if(phase==="down"){
        let accepted=0;
        for(const u of updates){
          const used=new Set(Array.from(contacts.values(),c=>c.tip));
          if(contacts.has(u.id)||used.size>=2)continue;
          const available=style.mode==="tip1"?[1]:style.mode==="tip4"?[4]:[firstTip,5-firstTip];
          const tip=available.find(n=>!used.has(n));
          if(!tip) continue;
          contacts.set(u.id,{tip,p:u.p});accepted++;
        }
        if(!accepted)return;
        if(!active){active={startMs:t,endMs:t,input:source,style:{...style},firstTip,samples:[]};onStart(active);}
        take(t,"down");return;
      }
      if(!active)return;
      const known=updates.filter(u=>contacts.has(u.id));
      if(!known.length)return;
      let moved=false;
      for(const u of known){
        const c=contacts.get(u.id);
        if(u.p && (c.p[0]!==u.p[0] || c.p[1]!==u.p[1])){c.p=u.p;moved=true;}
      }
      active.endMs=t;
      if(moved)take(t,"move");
      if(phase==="move")return;
      for(const u of known)contacts.delete(u.id);
      take(t,phase==="cancel"?"cancel":"up");
      if(!contacts.size){const finished=active;active=null;onEnd(finished);}
    }
    return {apply,resetClock(t=0){if(!active)lastTime=t;},get active(){return active;},cancel(t){apply("cancel",Array.from(contacts.keys(),id=>({id})),t,DEFAULT_STYLE);}};
  }
  function validStyle(s){
    return s && MODES.includes(s.mode) && ["ink","first","fourth"].every(k=>color(s[k])) &&
      ["inkOpacity","a1","a4"].every(k=>finite(s[k],0,1)) && ["w1","w4"].every(k=>finite(s[k],0.25,36));
  }
  function validReference(r){
    if(r===null)return true;
    if(!r || !finite(r.opacity,0,1) || !Array.isArray(r.rect) || r.rect.length!==4 ||
       !r.rect.every(v=>finite(v,-4000,5000)) || r.rect[2]<=0 || r.rect[3]<=0 || typeof r.name!=="string" || r.name.length>200)return false;
    if(r.kind==="image")return typeof r.data==="string" && r.data.length<=6500000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(r.data);
    return r.kind==="glyph" && typeof r.letter==="string" && r.letter.length<10 && typeof r.style==="string" && r.style.length<45 &&
      Array.isArray(r.viewBox) && r.viewBox.length===4 && r.viewBox.every(v=>finite(v,-10000,10000)) && r.viewBox[2]>0 && r.viewBox[3]>0 &&
      Array.isArray(r.paths) && r.paths.length>0 && r.paths.length<=100 && r.paths.every(p=>p && typeof p.d==="string" && p.d.length>0 && p.d.length<150000 && /^[MmZzLlHhVvCcSsQqTtAaEe0-9+.,\s-]+$/.test(p.d) && ["nonzero","evenodd"].includes(p.rule));
  }
  function verify(doc){
    const bad=()=>{throw Error("קובץ ההדגמה אינו תקין או שגרסתו אינה נתמכת.");};
    if(!doc || doc.format!==FORMAT || doc.version!==1 || doc.coordinates?.width!==WIDTH || doc.coordinates?.height!==HEIGHT ||
       doc.coordinates.origin!=="top-left" || doc.coordinates.x!=="right" || doc.coordinates.y!=="down" ||
       !validReference(doc.reference) || !["fine","original","plain"].includes(doc.grid) || !Array.isArray(doc.strokes) || doc.strokes.length>10000)bad();
    let last=-1, count=0;
    for(const stroke of doc.strokes){
      if(!stroke || (stroke.firstTip!==undefined && ![1,4].includes(stroke.firstTip)) || (stroke.numbering!==undefined && !["12","14"].includes(stroke.numbering)) || !validStyle(stroke.style) || !["touch","pen","mouse","mouse-pair"].includes(stroke.input) || !Array.isArray(stroke.samples) || !stroke.samples.length ||
         !finite(stroke.startMs,Math.max(0,last),604800000) || !finite(stroke.endMs,stroke.startMs,604800000))bad();
      count+=stroke.samples.length;if(count>600000)bad();
      let time=stroke.startMs;
      for(const f of stroke.samples){
        if(!f || !finite(f.t,time,stroke.endMs) || !validPoint(f.tip1)||!validPoint(f.tip4) || !["up","down","move","cancel"].includes(f.event))bad();
        time=f.t;
        f.angleDeg=angleOf(f.tip1,f.tip4);
      }
      const first=stroke.samples[0], end=stroke.samples.at(-1);
      if(first.t!==stroke.startMs || first.event!=="down" || (!first.tip1&&!first.tip4) ||
         end.t!==stroke.endMs || (end.event!=="up" && end.event!=="cancel") || end.tip1 || end.tip4)bad();
      last=stroke.endMs;
    }
    if(!Array.isArray(doc.clips)||doc.clips.length>1000 || doc.clips.some(c=>!c || !finite(c.fromMs,0,604800000)||!finite(c.toMs,c.fromMs,604800000)||typeof c.audio!=="boolean"||typeof c.fileName!=="string"||c.fileName.length>180))bad();
    return doc;
  }
  function pathLine(ctx,a,b,width,paint,alpha){
    if(!b || alpha===0)return;
    ctx.fillStyle=ctx.strokeStyle=paint;ctx.globalAlpha=alpha;
    if(!a || (a[0]===b[0]&&a[1]===b[1])){
      ctx.beginPath();ctx.arc(b[0],b[1],width/2,0,Math.PI*2);ctx.fill();return;
    }
    ctx.lineWidth=width;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();
  }
  function polygon(ctx,points){
    ctx.beginPath();ctx.moveTo(...points[0]);
    for(let i=1;i<points.length;i++)ctx.lineTo(...points[i]);
    ctx.closePath();ctx.fill();
  }
  function sweep(ctx,prev,now){
    const a=prev.tip1,b=prev.tip4,c=now.tip4,d=now.tip1;
    // A rotating edge can fold. Split on an actual crossing of the two tip trajectories;
    // two arbitrary triangles across the quadrilateral would paint outside the nib at a reversal.
    const cross=(x,y)=>x[0]*y[1]-x[1]*y[0];
    const diff=(x,y)=>[x[0]-y[0],x[1]-y[1]];
    const ad=diff(d,a),bc=diff(c,b),den=cross(ad,bc);
    if(Math.abs(den)>1e-9){
      const off=diff(b,a),u=cross(off,bc)/den,v=cross(off,ad)/den;
      if(u>0&&u<1&&v>0&&v<1){
        const hit=[a[0]+ad[0]*u,a[1]+ad[1]*u];
        polygon(ctx,[a,b,hit]);polygon(ctx,[hit,c,d]);return;
      }
    }
    // Even-odd lobes also keep rotation about a stationary centre inside the swept silhouette.
    polygon(ctx,[a,b,c,d]);
  }
  function drawSample(ctx,prev,now,s){
    ctx.save();
    if(s.mode==="fill" && now.tip1 && now.tip4){
      ctx.fillStyle=s.ink;ctx.globalAlpha=s.inkOpacity;
      if(prev?.tip1 && prev?.tip4)sweep(ctx,prev,now);
      pathLine(ctx,now.tip1,now.tip4,1.25,s.ink,s.inkOpacity);
    } else {
      const ink=s.mode==="fill";
      if(now.tip1 && (!prev || prev.tip1 || now.event==="down"))
        pathLine(ctx,prev?.tip1,now.tip1,s.w1,ink?s.ink:s.first,ink?s.inkOpacity:s.a1);
      if(now.tip4 && (!prev || prev.tip4 || now.event==="down"))
        pathLine(ctx,prev?.tip4,now.tip4,s.w4,ink?s.ink:s.fourth,ink?s.inkOpacity:s.a4);
    }
    ctx.restore();
  }
  function rectFit(width,height,factor=.72){const scale=Math.min(WIDTH*.78/width,HEIGHT*factor/height);return [(WIDTH-width*scale)/2,(HEIGHT-height*scale)/2,width*scale,height*scale];}
  function makeGlyph(g,name,style){
    const v=g.viewBox;
    return {kind:"glyph",name,letter:g.letter,style,viewBox:v.slice(),paths:g.paths.map(p=>({d:p.d,rule:p.rule||"nonzero"})),rect:rectFit(v[2],v[3]),opacity:.19};
  }
  function drawReference(ctx,r,image,opacity=r?.opacity){
    if(!r || opacity<=0)return;
    ctx.save();ctx.globalAlpha=opacity;
    const [x,y,w,h]=r.rect;
    if(r.kind==="image"){if(image)ctx.drawImage(image,x,y,w,h);}
    else{
      const [a,b,vw,vh]=r.viewBox;
      ctx.translate(x,y);ctx.scale(w/vw,h/vh);ctx.translate(-a,-b);ctx.fillStyle="#292928";
      for(const path of r.paths)ctx.fill(new Path2D(path.d),path.rule);
    }
    ctx.restore();
  }
  const api={WIDTH,HEIGHT,FORMAT,DEFAULT_STYLE,clamp,angleOf,reading,fresh,tracker,verify,drawSample,drawReference,rectFit,makeGlyph};
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  if(typeof globalThis!=="undefined")globalThis.KolmusCore=api;
})();
