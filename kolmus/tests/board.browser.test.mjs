import {test, before, after} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile, stat} from "node:fs/promises";
import {resolve, extname, sep} from "node:path";
import {chromium} from "playwright";

let server,browser,base;
before(async()=>{
  const root=resolve(".");
  server=createServer(async(req,res)=>{
    try{
      let path=resolve(root,"."+decodeURIComponent(new URL(req.url,"http://localhost").pathname));
      if(path!==root&&!path.startsWith(root+sep))throw Error();
      if((await stat(path)).isDirectory())path=resolve(path,"index.html");
      const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css",".svg":"image/svg+xml",".jpg":"image/jpeg",".png":"image/png"};
      res.setHeader("Content-Type",types[extname(path)]||"application/octet-stream");
      res.end(await readFile(path));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  base="http://127.0.0.1:"+server.address().port;
  browser=await chromium.launch({args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});

async function board(){
  const context=await browser.newContext({hasTouch:true,viewport:{width:1200,height:900},permissions:["microphone"]});
  const page=await context.newPage();await page.goto(base+"/kolmus/");await page.waitForFunction(()=>!document.querySelector("#record").disabled);
  const cdp=await context.newCDPSession(page);
  async function touch(type,points){
    const box=await page.locator("#sheet").boundingBox(),scale=Math.min(box.width/960,box.height/640);
    const touchPoints=points.map(([x,y,id])=>({x:box.x+(box.width-960*scale)/2+x*scale,y:box.y+(box.height-640*scale)/2+y*scale,id,radiusX:3,radiusY:3}));
    await cdp.send("Input.dispatchTouchEvent",{type,touchPoints});
  }
  async function capture(){
    const wait=page.waitForEvent("download");await page.locator("#json").click();
    const dl=await wait;return JSON.parse(await readFile(await dl.path(),"utf8"));
  }
  return {context,page,touch,capture};
}
const black=(page,x,y)=>page.locator("#sheet").evaluate((canvas,[x,y])=>canvas.getContext("2d").getImageData(x,y,1,1).data[0]<80,[x,y]);

test("real paired touch, continuous fill, single-contact tail, lift boundary and replay",async()=>{
  const {context,page,touch,capture}=await board();
  try{
    await page.locator("#no-ref").click();
    await page.evaluate(()=>document.querySelector("#sheet").addEventListener("touchmove",e=>{window.__demoTouches=Array.from(e.touches);},{once:true}));
    await touch("touchStart",[[190,150,4],[190,210,9]]);
    await touch("touchMove",[[320,150,4],[320,210,9]]);
    assert.equal(await page.locator("#clock").innerText(),"12:30");
    // Deliver a partial lift to the same DOM path with stable browser-assigned touch IDs.
    await page.evaluate(()=>{
      const el=document.querySelector("#sheet"),live=window.__demoTouches;
      el.dispatchEvent(new TouchEvent("touchend",{bubbles:true,cancelable:true,changedTouches:[live[0]],touches:[live[1]]}));
    });
    await touch("touchMove",[[320,150,4],[390,230,9]]);
    await touch("touchEnd",[]);
    await touch("touchStart",[[620,350,33],[620,410,81]]);
    await touch("touchMove",[[730,350,33],[730,410,81]]);
    await touch("touchEnd",[]);
    const doc=await capture();
    assert.equal(doc.strokes.length,2);assert.equal(doc.strokes[0].input,"touch");
    assert.ok(doc.strokes[0].samples.some(s=>s.tip1===null&&s.tip4));
    assert.ok(await black(page,251,180));assert.equal(await black(page,475,285),false);
    await page.getByRole("button",{name:"מקטע 1",exact:true}).click();
    assert.ok(await black(page,251,180));assert.equal(await black(page,687,380),false);
    await page.getByRole("button",{name:"חזרה לציור"}).click();assert.ok(await black(page,687,380));
    await page.locator("#undo").click();assert.equal((await capture()).strokes.length,1);
    await page.locator("#redo").click();assert.equal((await capture()).strokes.length,2);
  }finally{await context.close();}
});
test("one more finger, stationary pivot, changing angle, no fill outside a circle",async()=>{
  const {context,page,touch,capture}=await board();
  try{
    await page.locator("#no-ref").click();
    await touch("touchStart",[[480,220,1],[480,160,2]]);
    await touch("touchStart",[[480,220,1],[480,160,2],[250,250,3]]);
    for(let i=1;i<=48;i++){
      const a=i*Math.PI*2/48;
      await touch("touchMove",[[480+100*Math.sin(a),320-100*Math.cos(a),1],[480+160*Math.sin(a),320-160*Math.cos(a),2],[250,250,3]]);
    }
    await touch("touchEnd",[]);
    assert.ok(await black(page,610,320));assert.equal(await black(page,480,320),false);
    await touch("touchStart",[[720,200,1],[720,260,2]]);
    await touch("touchMove",[[720,200,1],[704,259,2]]);
    await touch("touchEnd",[]);
    const doc=await capture();assert.equal(doc.strokes.length,2);
    assert.ok(doc.strokes[1].samples.some(s=>s.angleDeg>13&&s.angleDeg<17));
    assert.ok(doc.strokes[0].samples.filter(s=>s.tip1).every(s=>s.tip1[0]>370));
  }finally{await context.close();}
});
test("separate guide, true video and microphone tracks, compatible full-measurement handoff",async()=>{
  const {context,page,touch,capture}=await board();
  try{
    await page.locator("#mic").check();await page.locator("#record").click();
    await page.waitForFunction(()=>document.querySelector("#record").classList.contains("active"));
    await touch("touchStart",[[180,180,3],[180,225,6]]);
    await touch("touchMove",[[330,180,3],[330,225,6]]);await touch("touchEnd",[]);
    await page.waitForTimeout(420);await page.locator("#record").click();
    await page.waitForSelector("#video-save:not([hidden])");
    const media=await page.locator("#video-save").evaluate(async a=>{
      const blob=await(await fetch(a.href)).blob(),v=document.createElement("video");v.muted=true;v.src=a.href;
      await new Promise((done,fail)=>{v.onloadeddata=done;v.onerror=fail;});
      return {size:blob.size,width:v.videoWidth,height:v.videoHeight,media:blob.type};
    });
    assert.ok(media.size>1000);assert.deepEqual([media.width,media.height],[960,698]);assert.match(media.media,/video/);
    await page.waitForFunction(async()=>Boolean((await KolmusLocal.read("latest-video"))?.blob?.size));
    await page.waitForFunction(async()=>Boolean((await KolmusLocal.read("drawing-draft"))?.clips.length));
    await page.reload();await page.waitForSelector("#video-save:not([hidden])");
    const doc=await capture();assert.equal(doc.reference.letter,"ב");assert.ok(doc.reference.paths[0].d.length>20);assert.ok(doc.clips[0].audio);
    await page.locator("#destinations").click();await page.locator("#measure-layer").selectOption("reference");await page.locator("#to-full").click();
    await page.waitForURL(/medidaot.html\?kolmus=/);
    await page.waitForSelector("#kolmus-import[open]");assert.equal(await page.locator("#kolmus-layer").inputValue(),"reference");
    await page.locator("#kolmus-apply").click();
    await page.waitForFunction(()=>typeof state!=="undefined"&&state.image&&state.projectDocument?.kolmusDemonstration?.strokes.length===1);
  }finally{await context.close();}
});
test("sub-minute readout, JSON round trip, separate tracks and valid cancellation",async()=>{
  const {context,page}=await board();
  try{
    const result=await page.evaluate(()=>{
      const C=KolmusCore,doc=C.fresh(),saved=[];
      const tr=C.tracker(()=>{},()=>{},s=>saved.push(s));const opts={...C.DEFAULT_STYLE,mode:"paths"};
      tr.apply("down",[{id:17,p:[100,200]},{id:54,p:[100,250]}],0,opts,4);
      tr.apply("move",[{id:17,p:[220,200]},{id:54,p:[220,250]}],75,opts,4);tr.cancel(90);doc.strokes=saved;
      const check=C.verify(JSON.parse(JSON.stringify(doc)));
      const cv=document.createElement("canvas");cv.width=400;cv.height=300;const ct=cv.getContext("2d");
      for(const s of check.strokes) s.samples.forEach((f,i)=>C.drawSample(ct,s.samples[i-1],f,s.style));
      return {angles:[0,1,2,3,4,5,5.99,6,11.99,12,-6].map(a=>[C.reading(a).clock,C.reading(a).angle]),last:saved[0].samples.at(-1).event,
        mid:ct.getImageData(160,225,1,1).data[3],edge:ct.getImageData(160,200,1,1).data[3],swapped:saved[0].samples[0].tip4};
    });
    assert.deepEqual(result.angles.map(x=>x[0]),["12:30","12:30","12:30","12:30","12:30","12:30","12:30","12:31","12:31","12:32","12:29"]);
    assert.equal(result.mid,0);assert.ok(result.edge>0);assert.equal(result.last,"cancel");assert.deepEqual(result.swapped,[100,200]);
  }finally{await context.close();}
});

test("microphone refusal keeps silent recording available and studio fits two iPad layouts",async()=>{
  const {context,page}=await board();
  try{
    for(const [width,height] of [[1024,768],[768,1024]]){
      await page.setViewportSize({width,height});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      const box=await page.locator("#sheet").boundingBox();assert.ok(box.width>470&&box.height>280);
    }
    await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException("denied","NotAllowedError");};});
    await page.locator("#mic").check();await page.locator("#record").click();
    await page.waitForFunction(()=>document.querySelector("#status").textContent.includes("המיקרופון לא נפתח"));
    assert.equal(await page.locator("#record").evaluate(b=>b.classList.contains("active")),false);
    await page.locator("#mic").uncheck();await page.locator("#record").click();
    await page.waitForFunction(()=>document.querySelector("#record").classList.contains("active"));
    await page.waitForTimeout(300);await page.locator("#record").click();
    await page.waitForSelector("#video-save:not([hidden])");
  }finally{await context.close();}
});
