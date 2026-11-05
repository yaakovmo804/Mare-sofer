(function installKolmusImport(){
  "use strict";
  const C=globalThis.KolmusCore, storage=globalThis.KolmusLocal;
  const byId=id=>document.getElementById(id);
  const picker=byId("kolmus-file"), dialog=byId("kolmus-import");
  let pending=null, busy=false, serial=0;
  function error(message){byId("kolmus-error").textContent=message;}
  function show(doc,time,layer){
    const demonstration=C.verify(doc);
    const end=doc.strokes.at(-1)?.endMs||0;
    pending={doc:demonstration,at:Number.isFinite(time)?Math.min(end,Math.max(0,time)):end};
    byId("kolmus-original").disabled=!demonstration.reference;
    byId("kolmus-layer").value=layer==="reference"&&demonstration.reference?"reference":"ink";
    byId("kolmus-source").textContent=`${doc.reference?.name||"ציור ללא תבנית"} · ${doc.strokes.length} מקטעים`;
    error(state.image?"הטעינה תפתח פרויקט מדידה חדש. שמרו תחילה את הפרויקט הפתוח.":"");
    if(!dialog.open)dialog.showModal();
  }
  function loadImage(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error("טעינת התמונה נכשלה."));im.src=src;});}
  function tell(message){statusText.textContent=message;}
  picker.addEventListener("change",async()=>{
    const file=picker.files[0];picker.value="";if(!file)return;
    const id=++serial;
    try{
      if(file.size>35*1024*1024)throw Error("הקובץ גדול מדי.");
      const doc=JSON.parse(await file.text());
      if(id===serial)show(doc,doc.selection?.frameMs,doc.selection?.layer);
    }catch(e){tell(e.message||"קובץ ההדגמה לא נפתח.");}
  });
  byId("kolmus-cancel").onclick=()=>dialog.close();
  byId("kolmus-apply").onclick=async()=>{
    if(!pending||busy)return;
    const {doc,at}=pending, choice=byId("kolmus-layer").value;
    busy=true;byId("kolmus-apply").disabled=true;const id=++serial;
    try{
      const canvas=document.createElement("canvas");canvas.width=C.WIDTH;canvas.height=C.HEIGHT;
      const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);
      if(choice==="reference"){
        const im=doc.reference.kind==="image"?await loadImage(doc.reference.data):null;C.drawReference(ctx,doc.reference,im,1);
      }else for(const st of doc.strokes){
        for(let i=0;i<st.samples.length&&st.samples[i].t<=at;i++)C.drawSample(ctx,st.samples[i-1],st.samples[i],st.style);
      }
      const png=canvas.toDataURL("image/png"),image=await loadImage(png);
      if(id!==serial||!dialog.open)return;
      const title=`הדגמת ${doc.reference?.letter||"כתיבה"}`,date=new Date().toISOString();
      state.sourceMeta={id:createStableId("image"),fileName:title+".png",mimeType:"image/png",byteLength:estimateDataUrlBytes(png)};
      state.projectMeta={id:createStableId("project"),title,createdAt:date,updatedAt:date};
      // The native project serializer spreads the base document, preserving the measured source and its trace.
      state.projectDocument={kolmusDemonstration:doc,kolmusMeasurement:{layer:choice,frameMs:at}};
      loadImageSource(png,true,image,++state.loadGeneration);dialog.close();pending=null;
      tell(`ההדגמה נטענה למדידה · ${choice==="ink"?"הדיו שצויר":"אות הרקע"}`);
    }catch(e){error(e.message||"ההדגמה לא נטענה.");}finally{busy=false;byId("kolmus-apply").disabled=false;}
  };
  const key=new URLSearchParams(location.search).get("kolmus");
  if(key)storage.receive(key).then(v=>{
    if(v.target!=="full")throw Error("העברה זו מיועדת ליישום אחר.");
    show(v.doc,v.frameMs,v.layer);
  }).catch(e=>tell(e.message||"פתחו את קובץ ההדגמה כדי להמשיך."));
})();
