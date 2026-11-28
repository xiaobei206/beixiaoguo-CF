import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { browserSupportsNativeHeic, imageProxyFetchOptions, isHeicImageUrl } from "../functions/image-proxy-options.js";

const safari17IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const safari16IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1";
const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36";
assert.equal(browserSupportsNativeHeic(safari17IOS), true);
assert.equal(browserSupportsNativeHeic(safari16IOS), false);
assert.equal(browserSupportsNativeHeic(chrome), false);
for (const ext of ["heic","heif"]) {
  const target = new URL("https://p3-reading-sign.fqnovelpic.com/cover." + ext + "?sig=test");
  assert.equal(isHeicImageUrl(target), true);
  for (const ua of [chrome,safari16IOS,safari17IOS]) {
    const options=imageProxyFetchOptions(target,"GET",ua,true);
    assert.equal(options.cf,undefined,"no cf.image transforms for any browser");
    assert.match(options.headers.Accept,/image\/heic/);
  }
  assert.equal(imageProxyFetchOptions(target,"HEAD",chrome,true).cf,undefined);
}
assert.equal(imageProxyFetchOptions(new URL("https://p3-reading-sign.fqnovelpic.com/a.jpg"),"GET",chrome,true).cf,undefined);
const source=id=>"https://p3-reading-sign.fqnovelpic.com/novel-pic/"+id+"~tplv-test:400:0.heic?lk3s=64477e16&x-expires=1801022960&x-signature=test";
const apiSource=await readFile(new URL("../functions/api/v1/[[path]].js",import.meta.url),"utf8");
const ps=apiSource.indexOf("async function proxyCoverImageUncached("), pe=apiSource.indexOf("\nconst MAX_MEDIA_RANGE_BYTES",ps);
assert.ok(ps>=0&&pe>ps);
const errorResponse=(status,code,message,extraHeaders={})=>new Response(JSON.stringify({error:{code,message}}),{status,headers:{"Content-Type":"application/json", "X-BXG-Error-Code":code,...extraHeaders}});
const factory=new Function("browserSupportsNativeHeic","imageProxyFetchOptions","isHeicImageUrl","debugRecord","sanitizeDebugMessage","errorResponse",apiSource.slice(ps,pe)+"\nreturn proxyCoverImage;");
const proxy=factory(browserSupportsNativeHeic,imageProxyFetchOptions,isHeicImageUrl,()=>{},v=>String(v).slice(0,420),errorResponse);
const oldFetch=globalThis.fetch;
async function request(raw,{ua=chrome,method="GET",mode=""}={}) {
 const u=new URL("https://w.hiu.us.kg/api/v1/images");u.searchParams.set("url",raw);if(mode)u.searchParams.set("mode",mode);
 const req=new Request(u,{method,headers:{"User-Agent":ua,"X-BXG-Session":"test-session"}});
 return proxy(raw,method,"test-session",[],req,mode==="source");
}
try {
 let calls=[];
 globalThis.fetch=async(input,options)=>{calls.push({input:String(input),options});return new Response("raw-heic",{status:200,headers:{"Content-Type":"image/heic","Content-Length":"8"}})};
 for(const ua of [chrome,safari16IOS]){
  calls=[];const r=await request(source("11111111111111111111111111111111"),{ua});
  assert.equal(r.status,200);assert.equal(r.headers.get("Content-Type"),"image/heic");assert.equal(r.headers.get("X-BXG-Image-Transform"),"none");assert.equal(await r.text(),"raw-heic");
  assert.equal(calls.length,1);assert.equal(calls[0].options.cf,undefined);
 }
 calls=[];const native=await request(source("22222222222222222222222222222222"),{ua:safari17IOS});
 assert.equal(native.status,200);assert.equal(native.headers.get("X-BXG-Image-Transform"),"native-heic");assert.equal(calls[0].options.cf,undefined);
 calls=[];const raw=await request(source("33333333333333333333333333333333"),{mode:"source"});
 assert.equal(raw.status,200);assert.equal(raw.headers.get("Content-Type"),"image/heic");assert.equal(calls[0].options.cf,undefined);
 const invalid=await request("https://p3-reading-sign.fqnovelpic.com/cover.jpg",{mode:"source"});assert.equal(invalid.status,400);
 calls=[];globalThis.fetch=async(input,options)=>{calls.push({input:String(input),options});return new Response("jpeg",{status:200,headers:{"Content-Type":"image/jpeg","Content-Length":"4"}})};
 const jpeg=await request("https://p3-reading-sign.fqnovelpic.com/cover.jpg");assert.equal(jpeg.status,200);assert.equal(jpeg.headers.get("Content-Type"),"image/jpeg");assert.equal(calls[0].options.cf,undefined);
 calls=[];globalThis.fetch=async(input,options)=>{calls.push({input:String(input),options});if(calls.length===1)return new Response(null,{status:302,headers:{Location:"https://p3-reading-sign.fqnovelpic.com/redirect.heic"}});return new Response("heic",{status:200,headers:{"Content-Type":"image/heic"}})};
 const redirect=await request(source("44444444444444444444444444444444"));assert.equal(redirect.status,200);assert.equal(calls.length,2);assert.ok(calls.every(x=>x.options.cf===undefined));
 globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:"https://evil.example/a.heic"}});
 const badRedirect=await request(source("55555555555555555555555555555555"));assert.equal(badRedirect.status,502);assert.equal(badRedirect.headers.get("X-BXG-Error-Code"),"IMAGE_REDIRECT_HOST");
 globalThis.fetch=async()=>new Response("down",{status:503,headers:{"Content-Type":"text/plain"}});
 const failed=await request(source("66666666666666666666666666666666"));assert.equal(failed.status,502);assert.equal(failed.headers.get("X-BXG-Error-Code"),"IMAGE_UPSTREAM_HTTP");
 globalThis.fetch=async()=>new Response("too large",{status:200,headers:{"Content-Type":"image/heic","Content-Length":String((10<<20)+1)}});
 const large=await request(source("77777777777777777777777777777777"));assert.equal(large.status,413);
 calls=[];globalThis.fetch=async(input,options)=>{calls.push({input:String(input),options});return new Response(null,{status:200,headers:{"Content-Type":"image/heic"}})};
 const head=await request(source("88888888888888888888888888888888"),{method:"HEAD"});assert.equal(head.status,200);assert.equal(calls[0].options.method,"HEAD");assert.equal(calls[0].options.cf,undefined);
 const host=await request("https://evil.example/a.heic");assert.equal(host.status,400);
} finally {globalThis.fetch=oldFetch}
console.log("Image proxy tests passed: raw-image forwarding, no cf.image, HEIC/JPEG, browser variants, HEAD, size limits and redirect allowlist.");
