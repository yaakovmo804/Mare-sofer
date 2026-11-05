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

test("measure the authentic board's source layer or stored lift without changing the source trace",async()=>{
  const context=await browser.newContext();const page=await context.newPage();
  try{
    await page.goto(base+"/measure-stam/medidaot.html");
    const raster=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=36;const g=c.getContext('2d');g.fillRect(3,6,22,5);return c.toDataURL();});
    const reference={id:'g',sourcePng:raster,displayPng:raster};
    const doc={format:'mareh-sofer-star/demonstration',version:1,board:{width:64,height:36},reference,references:{g:reference},inkPng:raster,frames:[{id:'lift',width:64,height:36,referenceId:'g',inkPng:raster,endMs:21,samples:[{event:'up',t:21}]}]};
    await page.locator('#kolmus-file').setInputFiles({name:'הדגמה.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});
    await page.locator('#kolmus-frame').selectOption("0");await page.locator('#kolmus-layer').selectOption('reference');
    await page.locator('#kolmus-apply').click();await page.waitForFunction(()=>state.image?.width===64);
    assert.equal(await page.evaluate(()=>state.projectDocument.kolmusMeasurement.frameMs),21);
    assert.equal(await page.evaluate(()=>state.projectDocument.kolmusDemonstration.frames[0].samples[0].event),'up');
  }finally{await context.close();}
});
