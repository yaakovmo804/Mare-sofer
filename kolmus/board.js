(function kolmusBoard(){
  "use strict";
  const C=KolmusCore, cache=KolmusLocal, W=C.WIDTH,H=C.HEIGHT, $=id=>document.getElementById(id);
  const suite=document.body.dataset.host==="suite", params=new URLSearchParams(location.search);
  const inPlayer=params.get("view")==="player", viewer=inPlayer || Boolean(params.get("handoff"));
  const sheet=$("sheet"), screen=sheet.getContext("2d");
  function layer(){const c=document.createElement("canvas");c.width=W;c.height=H;return c;}
  const paper=layer(),ink=layer(),engine=ink.getContext("2d"), bg=paper.getContext("2d");
  const catalog=globalThis.MEDIDAOT_LETTERS, style={...C.DEFAULT_STYLE};
  const original=new Image();original.onload=()=>{paintPaper();render();};original.src="./original-grid.jpg";
  let doc=C.fresh(), redo=[], current=null, referenceImage=null, origin=performance.now(), baseline=0;
  let cursor=null, selected=-1, raf=0, playId=0, playing=false, busy=true, dirty=false, revision=0, framePage=0;
  let recorder=null,recordPending=false,clipUrl=null,finishedClip=null,heartbeat=0,clipStart=0;
  let seekIndex=0,seekSample=0,paintedUntil=-1, lastPair=null, replayStroke=null;
  let saveTimer=0,saveTail=Promise.resolve();
  const draftKey="drawing-draft", empty=()=>!doc.strokes.length;
  const now=()=>Math.round(baseline+performance.now()-origin);
  const duration=()=>doc.strokes.at(-1)?.endMs||0;
  const time=t=>`${Math.floor(t/60000).toString().padStart(2,"0")}:${Math.floor(t/1000)%60<10?"0":""}${Math.floor(t/1000)%60}`;
  const note=s=>{$("status").textContent=s;};
  function saveDraft(){
    if(inPlayer || !dirty || tracking.active)return;
    const captured=structuredClone(doc),stamp=revision;
    saveTail=saveTail.catch(()=>{}).then(()=>cache.write(draftKey,captured)).then(()=>{if(stamp===revision)dirty=false;})
      .catch(()=>note("השמירה במכשיר נכשלה. שמרו את קובץ ההדגמה לפני היציאה."));
  }
  function changed(){dirty=true;revision++;clearTimeout(saveTimer);saveTimer=setTimeout(saveDraft,280);}
  function loadImage(src){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error("התמונה לא נפתחה."));image.src=src;});}
  async function ensureReference(r){return r?.kind==="image"?await loadImage(r.data):null;}
  function paintPaper(){
    bg.fillStyle="#fbf8ef";bg.fillRect(0,0,W,H);
    if(doc.grid==="original"&&original.complete&&original.naturalWidth){
      const m=Math.min(W/original.naturalWidth,H/original.naturalHeight),w=original.naturalWidth*m,h=original.naturalHeight*m;
      bg.drawImage(original,(W-w)/2,(H-h)/2,w,h);
    }else if(doc.grid==="fine"){
      bg.strokeStyle="#e7e4d8";bg.lineWidth=.85;bg.beginPath();
      for(let x=32.5;x<W;x+=40){bg.moveTo(x,0);bg.lineTo(x,H);}
      for(let y=32.5;y<H;y+=40){bg.moveTo(0,y);bg.lineTo(W,y);}
      bg.stroke();bg.strokeStyle="#ccc7b6";bg.setLineDash([9,6]);bg.beginPath();
      for(const y of [112.5,512.5]){bg.moveTo(0,y);bg.lineTo(W,y);}bg.stroke();bg.setLineDash([]);
    }
    C.drawReference(bg,doc.reference,referenceImage);
  }
  function labels(){
    const stroke=cursor===null?current:replayStroke;
    if((stroke?.numbering||$("numbers").value)==="14")return {one:"1",four:"4"};
    return (stroke?.firstTip||Number($("first-tip").value))===1?{one:"1",four:"2"}:{one:"2",four:"1"};
  }
  function marker(ctx,point,label,color,side){
    if(!point)return;
    const [x,y]=point,k=C.clamp(x+side*19,14,W-14),l=C.clamp(y-22,14,H-14);
    ctx.lineWidth=2;ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(k,l);ctx.stroke();
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.arc(k,l,12,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#fff9ec";ctx.stroke();
    ctx.fillStyle="white";ctx.font="bold 14px Arial";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(label,k,l+.5);
  }
  function info(){
    if(cursor!==null)return lastPair;
    return current?.samples.at(-1)||null;
  }
  const precise=d=>d===null?"—":`${d>0?"+":d<0?"−":""}${(Math.floor(Math.abs(d)*10+1e-8)/10).toFixed(1)}°`;
  function render(){
    screen.clearRect(0,0,W,H);screen.drawImage(paper,0,0);screen.drawImage(ink,0,0);
    const f=info(),s=C.reading(f?.angleDeg??null),names=labels();
    if(f){screen.save();marker(screen,f.tip1,names.one,"#267e78",1);marker(screen,f.tip4,names.four,"#a35334",-1);screen.restore();}
    $("clock").textContent=s?.clock||"—";$("deg").textContent=precise(s?.angle??null);
    $("tip1-key").textContent=names.one;$("tip4-key").textContent=names.four;
    if(recorder && recorder.state!=="inactive")paintMovie();
  }
  function schedule(){if(!raf)raf=requestAnimationFrame(()=>{raf=0;render();});}
  function resetInk(){engine.clearRect(0,0,W,H);seekIndex=0;seekSample=0;paintedUntil=-1;lastPair=null;}
  function seek(t){
    if(cursor===null || t<paintedUntil)resetInk();
    while(seekIndex<doc.strokes.length){
      const s=doc.strokes[seekIndex];
      while(seekSample<s.samples.length && s.samples[seekSample].t<=t){
        const f=s.samples[seekSample];C.drawSample(engine,s.samples[seekSample-1],f,s.style);lastPair=f;replayStroke=s;seekSample++;
      }
      if(seekSample<s.samples.length)break;
      seekIndex++;seekSample=0;
    }
    paintedUntil=t;cursor=t;$("scrub").value=String(t);$("time").value=time(t);render();
  }
  function stopPlay(){cancelAnimationFrame(playId);playing=false;$("play").querySelector("span").textContent="ניגון";}
  function goLive(){
    stopPlay();resetInk();seek(duration());cursor=null;selected=-1;render();syncControls();makeFrames();
  }
  function pickFrame(i){
    stopPlay();selected=i;const stroke=doc.strokes[i];seek(stroke.endMs);
    lastPair=stroke.samples.findLast(f=>f.tip1||f.tip4);replayStroke=stroke;render();syncControls();makeFrames();
  }
  function makeFrames(){
    const root=$("frames");root.replaceChildren();
    const perPage=24;
    if(selected>=0)framePage=Math.floor(selected/perPage);
    framePage=Math.max(0,Math.min(framePage,Math.ceil(doc.strokes.length/perPage)-1));
    const paging=(text,delta)=>{const b=document.createElement("button");b.textContent=text;b.onclick=()=>{selected=-1;framePage+=delta;makeFrames();};root.append(b);};
    if(framePage)paging("הקודמים",-1);
    doc.strokes.slice(framePage*perPage,(framePage+1)*perPage).forEach((s,j)=>{
      const i=j+framePage*perPage,b=document.createElement("button");
      b.textContent=`מקטע ${i+1}`;b.title=`${time(s.startMs)}–${time(s.endMs)}`;
      b.setAttribute("aria-pressed",String(i===selected));b.disabled=Boolean(recorder)||recordPending;b.onclick=()=>pickFrame(i);root.append(b);
    });
    if((framePage+1)*perPage<doc.strokes.length)paging("הבאים",1);
  }
  function syncControls(){
    const rec=Boolean(recorder)||recordPending, drawing=Boolean(current), lock=busy||rec||drawing;
    const review=cursor!==null;
    $("count").textContent=`${doc.strokes.length} מקטעים`;$("scrub").max=String(Math.max(1,duration()));
    if(!review){$("scrub").value=String(duration());$("time").value=time(duration());}
    $("live").hidden=!review || inPlayer;$("undo").disabled=lock||empty()||inPlayer;$("redo").disabled=lock||!redo.length||inPlayer;
    $("play").disabled=lock||empty();$("scrub").disabled=lock||empty();
    for(const id of ["new","open","mic","json","destinations","png"])$(id).disabled=lock;
    for(const id of ["glyph","tradition","image-open","no-ref","grid","numbers","first-tip","w1","w4","a1","a4","ink","first","fourth","mouse-angle","opacity"])
      $(id).disabled=lock || inPlayer || ((["glyph","tradition","image-open","no-ref","grid"].includes(id))&&!empty());
    document.querySelectorAll("[data-mode]").forEach(el=>{el.disabled=lock||inPlayer;el.setAttribute("aria-pressed",String(el.dataset.mode===style.mode));});
    $("record").disabled=busy||recordPending||drawing&&!rec||review||inPlayer;
    $("record").classList.toggle("active",Boolean(recorder));
    $("record").querySelector("span").textContent=recordPending?"מכין הקלטה…":recorder?"עצירת ההקלטה":"הקלטת הלוח";
    $("source-name").textContent=doc.reference?.name||"לוח כתיבה";
    $("opacity").value=String(Math.round(100*(1-(doc.reference?.opacity??0))));
    $("opacity-text").textContent=`${$("opacity").value}%`;$("grid").value=doc.grid;
  }
  const tracking=C.tracker(s=>{s.numbering=$("numbers").value;current=s;redo=[];syncControls();},(s,f)=>{
    C.drawSample(engine,s.samples.at(-2),f,s.style);schedule();
  },s=>{
    doc.strokes.push(s);current=null;framePage=Math.floor((doc.strokes.length-1)/24);
    changed();syncControls();makeFrames();render();
  });
  function localPoint(x,y){
    const box=sheet.getBoundingClientRect(),scale=Math.min(box.width/W,box.height/H);
    return [C.clamp((x-box.left-(box.width-W*scale)/2)/scale,0,W),C.clamp((y-box.top-(box.height-H*scale)/2)/scale,0,H)];
  }
  function inside(x,y){
    const r=sheet.getBoundingClientRect(),s=Math.min(r.width/W,r.height/H);
    return Math.abs(x-r.left-r.width/2)<=W*s/2 && Math.abs(y-r.top-r.height/2)<=H*s/2;
  }
  function apply(phase,items,kind,timestamp){
    if(busy || inPlayer || cursor!==null || recordPending || (phase==="down"&&playing))return;
    const currentTime=performance.now();
    const eventTime=Number.isFinite(timestamp)&&Math.abs(timestamp-currentTime)<86400000?timestamp:currentTime;
    if(phase==="down"&&!doc.strokes.length&&!doc.clips.length&&!tracking.active&&!recorder){origin=eventTime;baseline=0;}
    tracking.apply(phase,items,Math.max(0,Math.round(baseline+eventTime-origin)),style,Number($("first-tip").value),kind);
  }
  const touchSupported="ontouchstart" in window;
  for(const [event,phase] of [["touchstart","down"],["touchmove","move"],["touchend","up"],["touchcancel","cancel"]]){
    sheet.addEventListener(event,e=>{
      const ts=Array.from(e.changedTouches).filter(t=>(t.touchType!=="stylus"||!window.PointerEvent) && (phase!=="down"||inside(t.clientX,t.clientY)));
      if(ts.length){e.preventDefault();apply(phase,ts.map(t=>({id:"t"+t.identifier,p:localPoint(t.clientX,t.clientY)})),"touch",e.timeStamp);}
    },{passive:false});
  }
  function mousePair(p){
    const a=Number($("mouse-angle").value)*Math.PI/180,x=Math.sin(a)*19,y=Math.cos(a)*19;
    return [{id:"m1",p:[C.clamp(p[0]+x,0,W),C.clamp(p[1]-y,0,H)]},{id:"m4",p:[C.clamp(p[0]-x,0,W),C.clamp(p[1]+y,0,H)]}];
  }
  for(const [event,phase] of [["pointerdown","down"],["pointermove","move"],["pointerup","up"],["pointercancel","cancel"],["lostpointercapture","cancel"]]){
    sheet.addEventListener(event,e=>{
      if(e.pointerType==="touch"&&touchSupported || phase==="down"&&(!inside(e.clientX,e.clientY)||e.button!==0))return;
      if(phase==="move"&&!tracking.active)return;
      if(phase==="down")sheet.setPointerCapture(e.pointerId);
      const virtual=e.pointerType==="mouse"&&["fill","paths"].includes(style.mode);
      const list=phase==="move"&&e.getCoalescedEvents?.().length?e.getCoalescedEvents():[e];
      for(const sample of list){
        const p=localPoint(sample.clientX,sample.clientY),items=virtual?mousePair(p):[{id:"p"+e.pointerId,p}];
        apply(phase,items,virtual?"mouse-pair":e.pointerType==="pen"?"pen":e.pointerType==="touch"?"touch":"mouse",sample.timeStamp);
      }
    });
  }
  function applyGlyph(){
    const character=$("glyph").value,tradition=$("tradition").value;
    const g=catalog?.traditions[tradition]?.[character];
    doc.reference=g?C.makeGlyph(g,`האות ${character} · ${tradition==="ari"?"האר״י":"בית יוסף"}`,tradition):null;
    referenceImage=null;paintPaper();render();syncControls();
  }
  if(catalog){for(const letter of catalog.order)$("glyph").add(new Option(letter,letter));$("glyph").value="ב";}
  for(const id of ["glyph","tradition"])$(id).onchange=()=>{applyGlyph();changed();};
  $("no-ref").onclick=()=>{doc.reference=null;referenceImage=null;paintPaper();render();syncControls();changed();};
  $("opacity").oninput=()=>{if(doc.reference)doc.reference.opacity=1-Number($("opacity").value)/100;paintPaper();render();syncControls();changed();};
  $("grid").onchange=()=>{doc.grid=$("grid").value;paintPaper();render();changed();};
  for(const id of ["w1","w4","a1","a4","ink","first","fourth"])$(id).oninput=()=>{
    if(id==="w1"||id==="w4")style[id]=C.clamp(Number($(id).value)||4,1,30);
    else if(id==="a1"||id==="a4")style[id]=Number($(id).value)/100;
    else style[id]=$(id).value;
  };
  for(const id of ["numbers","first-tip"])$(id).onchange=render;
  $("mouse-angle").oninput=()=>{$("mouse-angle-label").value=`${$("mouse-angle").value}°`;};
  document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{style.mode=b.dataset.mode;syncControls();});
  function confirmAction(title,message){
    const d=$("confirm");$("confirm-title").textContent=title;$("confirm-text").textContent=message;d.returnValue="cancel";
    return new Promise(resolve=>{d.addEventListener("close",()=>resolve(d.returnValue==="ok"),{once:true});d.showModal();});
  }
  function offerVideo(blob,fileName){
    forgetVideo();finishedClip=blob;clipUrl=URL.createObjectURL(blob);
    const a=$("video-save");a.href=clipUrl;a.download=fileName;a.hidden=false;
  }
  async function restoreVideo(next){
    const last=next.clips.at(-1);if(!last)return;
    try{const saved=await cache.read("latest-video");
      if(doc===next&&saved?.fileName===last.fileName&&saved.blob instanceof Blob)offerVideo(saved.blob,saved.fileName);
    }catch{/* The downloadable motion record is independent of media storage. */}
  }
  async function replaceDoc(next){
    const image=await ensureReference(next.reference);
    if(next.reference?.kind==="glyph"){const r=next.reference;$("glyph").value=r.letter;$("tradition").value=r.style;}
    referenceImage=image;doc=next;tracking.resetClock(next.strokes.at(-1)?.endMs||0);redo=[];framePage=0;origin=performance.now();baseline=Math.max(duration(),...doc.clips.map(c=>c.toMs));
    paintPaper();goLive();
  }
  function forgetVideo(){
    if(clipUrl)URL.revokeObjectURL(clipUrl);clipUrl=null;finishedClip=null;$("video-save").hidden=true;
  }
  $("new").onclick=async()=>{
    if((!empty()||finishedClip)&&!await confirmAction("פתיחת לוח חדש","כדי לשמור עותק של ההדגמה הנוכחית יש לייצא אותה לפני פתיחת לוח חדש."))return;
    const next=C.fresh(doc.reference?structuredClone(doc.reference):null);next.grid=doc.grid;forgetVideo();await replaceDoc(next);changed();note("הלוח מוכן לכתיבה.");
  };
  $("undo").onclick=()=>{if(!empty()){redo.push(doc.strokes.pop());goLive();changed();}};
  $("redo").onclick=()=>{if(redo.length){doc.strokes.push(redo.pop());goLive();changed();}};
  $("scrub").oninput=()=>{stopPlay();selected=-1;seek(Number($("scrub").value));syncControls();makeFrames();};
  function play(){
    if(playing){stopPlay();return;}
    let start=cursor??doc.strokes[0]?.startMs??0,until=duration();
    if(selected>=0){start=doc.strokes[selected].startMs;until=doc.strokes[selected].endMs;}
    else if(start>=until)start=doc.strokes[0]?.startMs??0;
    selected=-1;playing=true;seek(start);syncControls();makeFrames();$("play").querySelector("span").textContent="השהיה";
    const wall=performance.now();
    function tick(){if(!playing)return;const t=Math.min(until,start+performance.now()-wall);seek(t);if(t<until)playId=requestAnimationFrame(tick);else stopPlay();}
    playId=requestAnimationFrame(tick);
  }
  $("play").onclick=play;$("live").onclick=goLive;
  $("fullscreen").onclick=async()=>{
    const host=$("shell");
    if(document.fullscreenElement){await document.exitFullscreen();return;}
    if(host.classList.contains("enlarged")){host.classList.remove("enlarged");return;}
    try{await host.requestFullscreen();}catch{host.classList.add("enlarged");}
  };
  window.addEventListener("keydown",e=>{if(e.key==="Escape")$("shell").classList.remove("enlarged");});
  function download(blob,name){
    const url=URL.createObjectURL(blob),link=document.createElement("a");link.download=name;link.href=url;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);
  }
  const fileStem=()=>`הדגמת-${doc.reference?.letter||"כתיבה"}-${new Date().toISOString().replace(/[:.]/g,"-").slice(0,19)}`;
  const json=()=>download(new Blob([JSON.stringify(doc)],{type:"application/json"}),fileStem()+".json");
  $("json").onclick=json;
  function imageLayer(kind){
    const target=layer(),c=target.getContext("2d");c.fillStyle="white";c.fillRect(0,0,W,H);
    if(kind==="reference")C.drawReference(c,doc.reference,referenceImage,1);
    else if(kind==="frame"){c.drawImage(paper,0,0);c.drawImage(ink,0,0);}
    else c.drawImage(ink,0,0);
    return target;
  }
  $("png").onclick=()=>imageLayer("frame").toBlob(b=>{if(b)download(b,`${fileStem()}-${selected>=0?"מקטע-"+(selected+1):"לוח"}.png`);},"image/png");
  $("image-open").onclick=()=>$("image-file").click();
  $("image-file").onchange=async e=>{
    const file=e.target.files[0];e.target.value="";if(!file)return;
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>18000000){note("יש לבחור תמונת PNG,‏ JPEG או WebP עד 18 מגה־בייט.");return;}
    const url=URL.createObjectURL(file);busy=true;syncControls();
    try{
      const image=await loadImage(url),scale=Math.min(1,1600/Math.max(image.width,image.height)),c=document.createElement("canvas");
      c.width=Math.max(1,Math.round(image.width*scale));c.height=Math.max(1,Math.round(image.height*scale));
      const g=c.getContext("2d");g.fillStyle="white";g.fillRect(0,0,c.width,c.height);g.drawImage(image,0,0,c.width,c.height);
      const data=c.toDataURL("image/png");
      if(data.length>6500000)throw Error("התמונה גדולה מדי לאחר העיבוד. בחרו חיתוך של האות.");
      const r={kind:"image",name:file.name.slice(0,190),data,rect:C.rectFit(c.width,c.height),opacity:.24};
      referenceImage=await loadImage(data);doc.reference=r;paintPaper();render();changed();note("תמונת הרקע נוספה.");
    }catch(err){note(err.message);}finally{URL.revokeObjectURL(url);busy=false;syncControls();}
  };
  $("open").onclick=()=>$("json-file").click();
  $("json-file").onchange=async e=>{
    const f=e.target.files[0];e.target.value="";if(!f)return;
    if(f.size>35*1024*1024){note("קובץ ההדגמה גדול מדי.");return;}
    try{
      const next=C.verify(JSON.parse(await f.text()));
      if(!inPlayer&&(!empty()||finishedClip)&&!await confirmAction("פתיחת הדגמה","לפתוח את ההדגמה מהקובץ במקום הלוח הנוכחי?"))return;
      busy=true;syncControls();forgetVideo();await replaceDoc(next);await restoreVideo(next);
      if(inPlayer&&doc.strokes.length)seek(doc.strokes[0].startMs);else changed();
      note("ההדגמה נטענה עם הרקע וסדר המקטעים.");
    }catch(err){note(err.message||"הקובץ לא נפתח.");}finally{busy=false;syncControls();}
  };
  const movie=document.createElement("canvas");movie.width=W;movie.height=H+58;const movieCtx=movie.getContext("2d");
  function paintMovie(){
    movieCtx.drawImage(sheet,0,0);movieCtx.fillStyle="#193b35";movieCtx.fillRect(0,H,W,58);
    movieCtx.font="bold 20px Arial";movieCtx.fillStyle="#fff8e4";movieCtx.textAlign="right";movieCtx.direction="rtl";
    movieCtx.fillText(`מראה סופר  ·  ${doc.reference?.name||"הדגמת כתיבה"}`,W-18,H+36);
    movieCtx.direction="ltr";movieCtx.textAlign="left";movieCtx.fillText(`${$("clock").textContent}   ${$("deg").textContent}    |    ${time(Math.max(0,now()-clipStart))}`,18,H+36);
  }
  function stopCapture(){if(recorder?.state==="recording")recorder.stop();}
  $("record").onclick=async()=>{
    if(recorder){stopCapture();return;}
    if(!movie.captureStream||typeof MediaRecorder==="undefined"){note("הדפדפן הזה מאפשר שמירת JSON ותמונות. להקלטת וידאו יש לפתוח את הלוח בדפדפן שתומך בה.");return;}
    if(finishedClip&&!await confirmAction("הקלטה נוספת","הקלטה חדשה תחליף את הסרטון הזמין להורדה. שמרתם אותו?"))return;
    recordPending=true;syncControls();let audio=null,stream=null;
    try{
      if($("mic").checked){
        if(!navigator.mediaDevices?.getUserMedia)throw Error("אין גישה למיקרופון. פתחו את הלוח בדפדפן או בטלו את הסימון כדי להקליט ללא קול.");
        try{audio=await navigator.mediaDevices.getUserMedia({audio:true,video:false});}
        catch{throw Error("המיקרופון לא נפתח. אפשר לאפשר גישה או לבטל את הסימון ולהקליט ללא קול.");}
      }
      if(empty()&&!doc.clips.length){baseline=0;origin=performance.now();}
      clipStart=now();render();paintMovie();stream=movie.captureStream(30);
      for(const track of audio?.getAudioTracks()||[])stream.addTrack(track);
      const mime=["video/mp4","video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"].find(t=>MediaRecorder.isTypeSupported?.(t));
      const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),pieces=[],from=clipStart;
      let failure=false;
      rec.ondataavailable=e=>{if(e.data?.size)pieces.push(e.data);};
      rec.onerror=()=>{failure=true;note("הקלטת הסרטון נקטעה. תנועות החודים נשמרו בלוח.");if(rec.state!=="inactive")rec.stop();};
      rec.onstop=()=>{
        clearInterval(heartbeat);stream.getTracks().forEach(t=>t.stop());recorder=null;recordPending=false;
        if(!failure&&pieces.length){
          const type=rec.mimeType||pieces[0].type, ext=type.includes("mp4")?"mp4":"webm",name=`${fileStem()}-${crypto.randomUUID().slice(0,8)}.${ext}`;
          offerVideo(new Blob(pieces,{type}),name);
          void cache.write("latest-video",{fileName:name,blob:finishedClip}).catch(()=>note("כדי לשמור את הסרטון במכשיר לחצו על ״שמירת הסרטון״."));
          doc.clips.push({fromMs:from,toMs:now(),audio:Boolean(audio),fileName:name});changed();note("הסרטון מוכן. שמרו את הסרטון ואת קובץ ההדגמה לשימוש בהמשך.");
        }else if(!failure)note("הדפדפן לא החזיר וידאו. קובץ ההדגמה זמין לשמירה.");
        syncControls();makeFrames();
      };
      rec.start(250);recorder=rec;heartbeat=setInterval(paintMovie,100);note(audio?"מקליט את הלוח ואת המיקרופון.":"מקליט את הלוח ללא קול.");
    }catch(err){stream?.getTracks().forEach(t=>t.stop());audio?.getTracks().forEach(t=>t.stop());recorder=null;note(err.message||"ההקלטה לא התחילה.");}
    finally{recordPending=false;syncControls();makeFrames();}
  };
  $("destinations").onclick=()=>{$("measure-layer").querySelector('[value="reference"]').disabled=!doc.reference;$("transfer").showModal();};
  $("close-transfer").onclick=()=>$("transfer").close();
  const fullURL="https://yaakovmo804.github.io/Mare-sofer/measure-stam/medidaot.html";
  function handoffFor(target){return {doc,layer:$("measure-layer").value,frameMs:cursor??duration(),video:target==="class"?finishedClip:null,target};}
  async function send(target){
    const msg=$("transfer-note");
    if(!suite&&target!=="full"){
      json();msg.textContent=target==="lite"?"קובץ ההדגמה נשמר. במדיד אות לייט פתחו ״הדגמת כתיבה״ ובחרו את הקובץ.":"קובץ ההדגמה נשמר. בחדר השיעורים פתחו ״הקרנת הדגמה״ ובחרו את הקובץ.";return;
    }
    if(suite&&target==="full"){
      // A file handoff also works with separate iPad home-screen apps and COOP-isolated tabs.
      download(new Blob([JSON.stringify({...doc,selection:{frameMs:cursor??duration(),layer:$("measure-layer").value}})],{type:"application/json"}),fileStem()+".json");msg.replaceChildren(document.createTextNode("בכלי המדידה בחרו ״הדגמת כתיבה״ וטענו את הקובץ ששמרתם. "));
      const a=document.createElement("a");a.href=fullURL;a.target="_blank";a.rel="noopener";a.textContent="פתיחת כלי המדידה";msg.append(a);return;
    }
    try{
      const key=await cache.handoff(handoffFor(target));
      const path=target==="full"?"../measure-stam/medidaot.html":target==="lite"?"/medidaot-lite":"/classroom";
      location.assign(`${path}?kolmus=${encodeURIComponent(key)}`);
    }catch{msg.textContent="ההעברה המקומית נכשלה. השתמשו בשמירת ההדגמה ופתחו את קובץ ה־JSON ביישום היעד.";}
  }
  for(const [id,t] of [["to-full","full"],["to-lite","lite"],["to-class","class"]])$(id).onclick=()=>void send(t);
  function suspend(){tracking.cancel(now());stopPlay();stopCapture();saveDraft();}
  window.addEventListener("pagehide",suspend);window.addEventListener("blur",()=>tracking.cancel(now()));
  document.addEventListener("visibilitychange",()=>{if(document.hidden)suspend();});
  async function init(){
    $("home").hidden=!suite;document.body.classList.toggle("player",inPlayer);
    applyGlyph();
    try{
      if(params.has("handoff")){
        const item=await cache.receive(params.get("handoff"));await replaceDoc(C.verify(item.doc));
        if(inPlayer && doc.strokes.length){seek(doc.strokes[0].startMs);note("ההדגמה מוכנה לניגון.");}
      }else if(!inPlayer){
        const saved=await cache.read(draftKey);
        if(saved){await replaceDoc(C.verify(saved));await restoreVideo(doc);note("ההדגמה האחרונה במכשיר נפתחה.");}
      }
    }catch(err){note(viewer?err.message:`שחזור ההדגמה מהמכשיר נכשל. ${err.message||""}`);}
    busy=false;syncControls();makeFrames();render();
  }
  void init();
})();
