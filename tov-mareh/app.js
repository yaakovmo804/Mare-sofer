const $=id=>document.getElementById(id);
const state={image:null,engine:'local',zoom:1,history:[],historyIndex:-1,settings:{rotation:0,perspective:0,crop:0,sharpness:40,black:36,uniformity:42,gloss:18,depth:14,warmth:14,texture:10,brightness:54,denoise:12,deglare:18,lock:95},aiEndpoint:localStorage.getItem('tm_ipad_ai')||''};
const presets={
 faithful:{sharpness:34,black:28,uniformity:32,gloss:6,depth:6,warmth:10,texture:7,brightness:56,denoise:12,deglare:18,lock:97},
 liveInk:{sharpness:44,black:48,uniformity:48,gloss:15,depth:18,warmth:12,texture:9,brightness:54,denoise:10,deglare:18,lock:94},
 gentleGloss:{sharpness:42,black:42,uniformity:47,gloss:28,depth:20,warmth:13,texture:10,brightness:54,denoise:10,deglare:14,lock:93},
 lacquer:{sharpness:44,black:52,uniformity:58,gloss:46,depth:32,warmth:14,texture:10,brightness:53,denoise:8,deglare:12,lock:91},
 faded:{sharpness:55,black:62,uniformity:58,gloss:8,depth:12,warmth:10,texture:7,brightness:58,denoise:18,deglare:20,lock:96},
 flash:{sharpness:42,black:39,uniformity:50,gloss:4,depth:10,warmth:15,texture:12,brightness:56,denoise:16,deglare:62,lock:97},
 parchment:{sharpness:34,black:31,uniformity:36,gloss:9,depth:10,warmth:28,texture:27,brightness:59,denoise:14,deglare:20,lock:96}
};
const before=$('beforeCanvas'),after=$('afterCanvas'),bctx=before.getContext('2d',{willReadFrequently:true}),actx=after.getContext('2d',{willReadFrequently:true});

function bind(){
 ['imageInput','emptyImageInput'].forEach(id=>$(id).addEventListener('change',e=>loadFile(e.target.files[0])));
 document.querySelectorAll('.tool').forEach(b=>b.addEventListener('click',()=>showPanel(b.dataset.tool,b)));
 document.querySelectorAll('[data-engine]').forEach(b=>b.addEventListener('click',()=>setEngine(b.dataset.engine)));
 document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.preset)));
 const controls=['rotation','perspective','crop','sharpness','black','uniformity','gloss','depth','warmth','texture','brightness','denoise','deglare'];
 controls.forEach(id=>$(id).addEventListener('input',()=>{state.settings[id]=+$(id).value; $(id+'Out').textContent=id==='rotation'?$(id).value+'°':$(id).value; scheduleRender();}));
 $('compareRange').addEventListener('input',updateDivider); $('compareDivider').addEventListener('pointerdown',startDividerDrag);
 $('zoomInBtn').onclick=()=>setZoom(state.zoom+.15); $('zoomOutBtn').onclick=()=>setZoom(state.zoom-.15); $('fitBtn').onclick=()=>setZoom(1);
 $('applyBtn').onclick=()=>render(true); $('autoAlignBtn').onclick=autoAlign; $('undoBtn').onclick=undo; $('redoBtn').onclick=redo;
 $('saveProjectBtn').onclick=saveProject; $('projectInput').addEventListener('change',e=>loadProject(e.target.files[0])); $('exportBtn').onclick=exportImage;
 $('dismissStandaloneHint').onclick=()=>{localStorage.setItem('tm_install_hint','1');$('standaloneHint').hidden=true};
 $('aiEndpoint').value=state.aiEndpoint; $('aiEndpoint').addEventListener('change',()=>{state.aiEndpoint=$('aiEndpoint').value.trim();localStorage.setItem('tm_ipad_ai',state.aiEndpoint)});
 $('testServerBtn').onclick=testServer; $('applyAiBtn').onclick=()=>setEngine('ai');
 if(!window.matchMedia('(display-mode: standalone)').matches&&!localStorage.getItem('tm_install_hint'))$('standaloneHint').hidden=false;
 document.addEventListener('gesturestart',e=>e.preventDefault());
}
async function loadFile(file){if(!file)return; const url=URL.createObjectURL(file); const img=new Image(); img.onload=()=>{state.image=img; URL.revokeObjectURL(url); $('emptyState').hidden=true;$('stage').hidden=false; setZoom(1); pushHistory();render();}; img.src=url}
function showPanel(name,btn){document.querySelectorAll('.tool').forEach(x=>x.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.inspector-page').forEach(x=>x.classList.remove('active'));$('panel-'+name)?.classList.add('active')}
function setEngine(engine){state.engine=engine;document.querySelectorAll('[data-engine]').forEach(x=>x.classList.toggle('active',x.dataset.engine===engine));render()}
function applyPreset(name){Object.assign(state.settings,presets[name]);syncUi();document.querySelectorAll('[data-preset]').forEach(x=>x.classList.toggle('active',x.dataset.preset===name));pushHistory();render()}
function syncUi(){for(const [k,v] of Object.entries(state.settings)){const input=$(k);if(input)input.value=v;const out=$(k+'Out');if(out)out.textContent=k==='rotation'?v+'°':v}$('lockLabel').textContent=state.settings.lock+'%'}
let timer;function scheduleRender(){clearTimeout(timer);timer=setTimeout(()=>render(),70)}
function render(commit=false){if(!state.image)return;$('busyOverlay').hidden=false;requestAnimationFrame(()=>{drawBase(); if(state.engine==='ai'&&state.aiEndpoint){renderAi().finally(()=>{$('busyOverlay').hidden=true})}else{processLocal(state.engine==='ai'?1.12:1);$('busyOverlay').hidden=true} if(commit)pushHistory()})}
function drawBase(){const img=state.image,s=state.settings,margin=s.crop/100;const sw=img.width*(1-margin*2),sh=img.height*(1-margin*2),max=1800,scale=Math.min(1,max/sw);const w=Math.max(120,Math.round(sw*scale)),h=Math.max(80,Math.round(sh*scale));[before,after].forEach(c=>{c.width=w;c.height=h});bctx.fillStyle='#f5f1e8';bctx.fillRect(0,0,w,h);bctx.save();bctx.translate(w/2,h/2);bctx.rotate(s.rotation*Math.PI/180);bctx.drawImage(img,img.width*margin,img.height*margin,sw,sh,-w/2,-h/2,w,h);bctx.restore();actx.drawImage(before,0,0);updateDivider();setZoom(state.zoom)}
function processLocal(mult=1){const w=before.width,h=before.height,src=bctx.getImageData(0,0,w,h),out=actx.createImageData(w,h),d=src.data,o=out.data,s=state.settings;const sharp=s.sharpness/100*mult,black=s.black/100*mult,uni=s.uniformity/100,gloss=s.gloss/100*mult,depth=s.depth/100,warm=s.warmth/100,tex=s.texture/100,bright=(s.brightness-50)*1.5,deglare=s.deglare/100;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,lum=.299*d[i]+.587*d[i+1]+.114*d[i+2],edge=edgeAt(d,w,h,x,y),ink=clamp((176-lum+deglare*Math.max(0,lum-220)*.55)/116,0,1),mask=Math.pow(ink,.82+uni*.12);const grain=(Math.sin(x*.021+y*.017)+Math.cos(x*.007-y*.012))*tex*2.5;const pr=clamp(246+warm*9+bright+grain,215,255),pg=clamp(241+warm*3+bright+grain*.75,208,253),pb=clamp(230-warm*10+bright+grain*.55,195,249);const target=9+(1-black)*12;let r=lerp(pr,target,clamp(mask*(1+black*.48),0,1)),g=lerp(pg,target,clamp(mask*(1+black*.48),0,1)),b=lerp(pb,target,clamp(mask*(1+black*.48),0,1));if(mask>.02){const core=(1-edge*.8)*mask,shine=gloss*core*.14,mass=depth*core*.5;r=clamp(r+shine*255-mass*18,0,255);g=clamp(g+shine*246-mass*17,0,255);b=clamp(b+shine*232-mass*16,0,255)}o[i]=r;o[i+1]=g;o[i+2]=b;o[i+3]=255}actx.putImageData(out,0,0);if(sharp>0)unsharp(sharp);$('deltaLabel').textContent=estimateDelta(src,out).toFixed(1)+'%'}
async function renderAi(){try{const res=await fetch(state.aiEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:before.toDataURL('image/png'),controls:state.settings,prompt:'שפר את תמונת כתב הסת״ם ללא שום שינוי בצורת האותיות, בתגים, בעובי ובשלד.'})});if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();const img=new Image();img.onload=()=>{actx.clearRect(0,0,after.width,after.height);actx.drawImage(img,0,0,after.width,after.height);$('aiStatus').textContent='העיבוד התקבל מהשרת';$('busyOverlay').hidden=true};img.src=data.image}catch(e){$('aiStatus').textContent='השרת אינו זמין — הופעל מנוע מקומי';processLocal(1.12)}}
function edgeAt(d,w,h,x,y){if(x<1||y<1||x>=w-1||y>=h-1)return 1;const L=i=>.299*d[i]+.587*d[i+1]+.114*d[i+2],i=(y*w+x)*4;return clamp((Math.abs(L(i+4)-L(i-4))+Math.abs(L(i+w*4)-L(i-w*4)))/180,0,1)}
function unsharp(a){const w=after.width,h=after.height,img=actx.getImageData(0,0,w,h),d=img.data,copy=new Uint8ClampedArray(d);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=(y*w+x)*4;for(let c=0;c<3;c++){const blur=(copy[i+c]+copy[i-4+c]+copy[i+4+c]+copy[i-w*4+c]+copy[i+w*4+c])/5;d[i+c]=clamp(copy[i+c]+(copy[i+c]-blur)*a,0,255)}}actx.putImageData(img,0,0)}
function estimateDelta(a,b){let ch=0,n=0;for(let i=0;i<a.data.length;i+=20){const x=(.299*a.data[i]+.587*a.data[i+1]+.114*a.data[i+2])<170,y=(.299*b.data[i]+.587*b.data[i+1]+.114*b.data[i+2])<170;if(x!==y)ch++;n++}return n?ch/n*100:0}
function updateDivider(){$('afterCanvas').style.clipPath=`inset(0 0 0 ${$('compareRange').value}%)`;$('compareDivider').style.left=$('compareRange').value+'%'}
function startDividerDrag(e){e.preventDefault();const move=ev=>{const r=$('canvasWrap').getBoundingClientRect(),p=clamp((ev.clientX-r.left)/r.width*100,0,100);$('compareRange').value=p;updateDivider()};const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)}
function setZoom(z){state.zoom=clamp(z,.35,2.5);$('canvasWrap').style.transform=`scale(${state.zoom})`;$('zoomLabel').textContent=Math.round(state.zoom*100)+'%'}
function autoAlign(){state.settings.rotation=0;syncUi();pushHistory();render()}
function pushHistory(){state.history=state.history.slice(0,state.historyIndex+1);state.history.push(JSON.stringify(state.settings));state.historyIndex=state.history.length-1;updateHistoryButtons()}
function undo(){if(state.historyIndex<=0)return;state.historyIndex--;state.settings=JSON.parse(state.history[state.historyIndex]);syncUi();render();updateHistoryButtons()}
function redo(){if(state.historyIndex>=state.history.length-1)return;state.historyIndex++;state.settings=JSON.parse(state.history[state.historyIndex]);syncUi();render();updateHistoryButtons()}
function updateHistoryButtons(){$('undoBtn').disabled=state.historyIndex<=0;$('redoBtn').disabled=state.historyIndex>=state.history.length-1}
function saveProject(){if(!state.image)return;const p={version:1,settings:state.settings,image:before.toDataURL('image/png')};download(new Blob([JSON.stringify(p)],{type:'application/json'}),'tov-mareh-project.json')}
function loadProject(file){if(!file)return;const r=new FileReader();r.onload=()=>{const p=JSON.parse(r.result);state.settings={...state.settings,...p.settings};syncUi();const img=new Image();img.onload=()=>{state.image=img;$('emptyState').hidden=true;$('stage').hidden=false;pushHistory();render()};img.src=p.image};r.readAsText(file)}
function exportImage(){if(!state.image)return;after.toBlob(b=>download(b,'tov-mareh.png'))}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
async function testServer(){try{const health=state.aiEndpoint.replace(/\/api\/process$/,'/api/health');const r=await fetch(health);if(!r.ok)throw 0;$('aiStatus').textContent='השרת מחובר';}catch{$('aiStatus').textContent='אין חיבור לשרת'}}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t;
bind();syncUi();updateHistoryButtons();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});