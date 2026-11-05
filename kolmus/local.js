(function kolmusLocal(){
  "use strict";
  const database="mareh-sofer-kolmus-v1";
  let opening;
  function open(){
    if(!opening)opening=new Promise((resolve,reject)=>{
      const req=indexedDB.open(database,1);
      req.onupgradeneeded=()=>{req.result.createObjectStore("items");};
      req.onerror=()=>{opening=null;reject(req.error);};
      req.onsuccess=()=>{
        const db=req.result;
        db.onversionchange=()=>{db.close();opening=null;};resolve(db);
      };
    });
    return opening;
  }
  async function transact(mode,run){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction("items",mode),request=run(tx.objectStore("items"));
      tx.oncomplete=()=>resolve(request.result);
      tx.onerror=tx.onabort=()=>reject(tx.error||Error("השמירה במכשיר נכשלה"));
    });
  }
  const write=(key,value)=>transact("readwrite",s=>s.put(value,key));
  const read=key=>transact("readonly",s=>s.get(key));
  const remove=key=>transact("readwrite",s=>s.delete(key));
  async function handoff(value){
    const key="handoff-"+crypto.randomUUID(),now=Date.now();
    const db=await open();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("items","readwrite"),s=tx.objectStore("items");
      const scan=s.openCursor(IDBKeyRange.bound("handoff-","handoff-\uffff"));
      scan.onsuccess=()=>{const c=scan.result;if(c){if(c.value.expires<now)c.delete();c.continue();}};
      s.put({expires:now+86400000,value},key);
      tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);
    });
    return key;
  }
  async function receive(key){
    if(!/^handoff-[a-f0-9-]{36}$/i.test(key||""))throw Error("מזהה ההדגמה אינו תקין.");
    const item=await read(key);
    if(!item || item.expires<Date.now())throw Error("ההעברה פגה. אפשר לפתוח את קובץ ה־JSON.");
    return item.value;
  }
  globalThis.KolmusLocal={read,write,remove,handoff,receive};
})();
