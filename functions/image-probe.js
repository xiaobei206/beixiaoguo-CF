const ALLOWED_DOMAIN="fqnovelpic.com";
const HEIC_PATH=/\.(heic|heif)$/i;
const TEXT_TYPES=/^(?:text\/|application\/(?:json|xml|javascript))/i;
const MAX_URL=4096,MAX_SAMPLE=512,MAX_REDIRECTS=2;
function allowedHost(host){host=String(host||"").toLowerCase();return host===ALLOWED_DOMAIN||host.endsWith("."+ALLOWED_DOMAIN);}
function validateUrl(value){
 const raw=String(value||"").trim();
 if(!raw||raw.length>MAX_URL){const e=new Error("图片源 URL 为空或超过 4096 字符。");e.status=400;e.code="IMAGE_PROBE_URL_INVALID";throw e;}
 let url;try{url=new URL(raw);}catch(_){const e=new Error("图片源 URL 不是有效绝对 URL。");e.status=400;e.code="IMAGE_PROBE_URL_INVALID";throw e;}
 if(url.protocol!=="https:"||url.username||url.password||url.port||!allowedHost(url.hostname)){const e=new Error("只允许 HTTPS 的 *.fqnovelpic.com 图片地址；不允许自定义端口或凭据。");e.status=400;e.code="IMAGE_PROBE_URL_REJECTED";throw e;}
 if(!HEIC_PATH.test(url.pathname)){const e=new Error("当前诊断版只接受路径以 .heic 或 .heif 结尾的封面 URL。");e.status=400;e.code="IMAGE_PROBE_FORMAT_UNSUPPORTED";throw e;}
 return url;
}
function safeText(value){return String(value==null?"":value).replace(/https?:\/\/[^\s"'<>]+/gi,"[URL]").replace(/([?&](?:x-expires|x-signature|signature|token|session|authorization)=)[^&\s]+/gi,"$1[REDACTED]").replace(/(authorization|cookie|set-cookie|token|secret|password|session|signature)(\s*[:=]\s*)[^\s,;]+/gi,"$1$2[REDACTED]").replace(/[A-Za-z0-9_-]{48,}/g,"[LONG_TOKEN]").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g," ").slice(0,360);}
function candidates(source){
 const base=[
 ["accept-webp","原 URL · Accept: image/webp","image/webp"],
 ["accept-avif","原 URL · Accept: image/avif","image/avif"],
 ["accept-heic","原 URL · Accept: image/heic","image/heic"],
 ["accept-jpeg-png","原 URL · Accept: JPEG/PNG","image/jpeg,image/png,*/*;q=0.8"],
 ["accept-browser","原 URL · Chromium 常见 Accept","image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"],
 ["accept-priority","原 URL · HEIC/AVIF/WebP 全部声明","image/heic,image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8"],
 ["accept-unset","原 URL · 不显式设置 Accept",null]
 ].map(([id,label,accept])=>({id,label,accept,url:new URL(source.href),mutation:"accept-only"}));
 const suffix=["webp","avif","jpeg"].map(ext=>{const url=new URL(source.href);url.pathname=url.pathname.replace(HEIC_PATH,"."+ext);return{id:"suffix-"+ext,label:"后缀改为 ."+ext+"（保留原签名，可能被拒）",accept:"image/"+ext,url,mutation:"path-suffix"};});
 const queries=[["query-x-tos-process","x-tos-process"],["query-x-oss-process","x-oss-process"]].map(([id,name])=>{const url=new URL(source.href);url.searchParams.set(name,"image/format,webp");return{id,label:"追加 "+name+"=image/format,webp（可能被签名拒绝）",accept:"image/webp",url,mutation:"legacy-query"};});
 return base.concat(suffix,queries);
}
async function cancelBody(response){try{await response.body?.cancel();}catch(_){}}
async function sampleText(response){
 if(!response.body)return "";const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(size<MAX_SAMPLE){const {done,value}=await reader.read();if(done||!value?.byteLength)break;const take=value.subarray(0,MAX_SAMPLE-size);chunks.push(take);size+=take.byteLength;if(take.byteLength<value.byteLength)break;}}
 catch(_){}finally{try{await reader.cancel();}catch(_){}try{reader.releaseLock();}catch(_){}}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return safeText(new TextDecoder().decode(bytes));
}
async function runCandidate(v,fetchImpl,timeoutMs){
 const out={id:v.id,label:v.label,method:"GET",accept:v.accept||"(未显式设置)",mutation:v.mutation,status:null,ok:false,contentType:"",contentLength:null,durationMs:0,redirects:0,redirectHost:"",redirectBlocked:false,errorCode:"",responseSample:""};
 const started=Date.now();let target=new URL(v.url.href);
 try{for(let hop=0;hop<=MAX_REDIRECTS;hop++){
   const headers={};if(v.accept)headers.Accept=v.accept;
   const response=await fetchImpl(target.href,{method:"GET",headers,redirect:"manual",cache:"no-store",signal:AbortSignal.timeout(timeoutMs)});
   out.status=response.status;out.ok=response.ok;out.contentType=(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
   const raw=response.headers.get("content-length"),n=raw==null||raw===""?NaN:Number(raw);out.contentLength=Number.isFinite(n)&&n>=0?n:null;out.redirects=hop;
   if(response.status>=300&&response.status<400){const location=response.headers.get("location");await cancelBody(response);if(!location||hop===MAX_REDIRECTS){out.errorCode="REDIRECT_LIMIT";break;}let next;try{next=new URL(location,target);}catch(_){out.errorCode="REDIRECT_INVALID";break;}out.redirectHost=next.hostname.toLowerCase();if(next.protocol!=="https:"||next.username||next.password||next.port||!allowedHost(next.hostname)){out.redirectBlocked=true;out.errorCode="REDIRECT_HOST_REJECTED";break;}target=next;continue;}
   if(!response.ok||!out.contentType.startsWith("image/"))out.responseSample=TEXT_TYPES.test(out.contentType)?await sampleText(response):"";else await cancelBody(response);
   if(!response.ok)out.errorCode="HTTP_"+response.status;out.durationMs=Date.now()-started;return out;
 }}catch(error){out.errorCode=error&&error.name==="TimeoutError"?"TIMEOUT":"FETCH_FAILED";out.responseSample=safeText(error?.message||error||"");}
 out.durationMs=out.durationMs||(Date.now()-started);return out;
}
function summarize(results){
 const successful=results.filter(x=>x.ok&&/^image\//.test(x.contentType)),observed=[...new Set(successful.map(x=>x.contentType).sort())],safe=observed.filter(x=>!/^image\/(?:heic|heif)$/i.test(x));
 const webp=results.find(x=>x.id==="accept-webp"),avif=results.find(x=>x.id==="accept-avif"),suffixWebp=results.find(x=>x.id==="suffix-webp");
 const legacy=results.find(x=>x.id==="query-x-tos-process"&&x.ok&&x.contentType==="image/webp")||results.find(x=>x.id==="query-x-oss-process"&&x.ok&&x.contentType==="image/webp");
 const directWebp=!!webp&&webp.ok&&webp.contentType==="image/webp",isWebp=x=>!!x&&x.ok&&x.contentType==="image/webp";let recommendation;
 if(directWebp)recommendation="已证实：普通 Worker GET + Accept:image/webp 可直接从源站拿到 WebP。正式链路可优先透传该响应，避免 cf.image 再解码 HEIC；仍需完整响应验证图像可解码。";
 else if(isWebp(suffixWebp))recommendation="改写 .webp 后缀返回了 WebP，但当前请求保留原签名；正式使用前必须确认签名规则并让上游重新签发该格式 URL。";
 else if(isWebp(legacy))recommendation="旧式 x-tos-process/x-oss-process 参数实验返回了 WebP；先确认该参数在此模板/签名模式下受支持。";
 else if(successful.some(x=>x.contentType==="image/avif"))recommendation="已观察到源站能直接返回 AVIF，但 Accept:image/webp 未得到 WebP。需确认客户端与模板策略后再调整生产链路。";
 else if(safe.some(x=>["image/jpeg","image/png","image/webp"].includes(x)))recommendation="至少一种 GET 变体直接返回了浏览器可显示格式；优先检查成功的测试标签，并选无需改签名的 Accept 变体。";
 else if(results.some(x=>x.status===403||x.responseSample.toLowerCase().includes("signature")))recommendation="出现签名/鉴权拒绝。改写 URL 的测试不能证明格式不支持；先看原 URL 的 Accept-only 结果。若这些结果仍是 HEIC，需要上游模板/签发逻辑提供显式输出格式。";
 else recommendation="本轮没有探测到可直接显示的格式。若 Accept-only 结果全部仍是 HEIC，需进一步查 tplv 模板的输出格式/自适应或上游 URL 签发逻辑；这不证明 VeImageX 其他 API 不支持格式转换。";
 return{tested:results.length,directWebp,directAvif:!!avif&&avif.ok&&avif.contentType==="image/avif",observedMimeTypes:observed,browserSafeFormats:safe,recommendation};
}
export async function probeUpstreamImage(rawUrl,options={}){
 const source=validateUrl(rawUrl),fetchImpl=typeof options.fetchImpl==="function"?options.fetchImpl:fetch,timeoutMs=Math.max(1000,Math.min(7000,Number(options.timeoutMs)||5000)),concurrency=Math.max(1,Math.min(3,Number(options.concurrency)||3));
 const variants=candidates(source),results=new Array(variants.length);let cursor=0;const worker=async()=>{while(cursor<variants.length){const i=cursor++;results[i]=await runCandidate(variants[i],fetchImpl,timeoutMs);}};
 await Promise.all(Array.from({length:Math.min(concurrency,variants.length)},worker));
 return{probeVersion:1,testedAt:new Date().toISOString(),source:{host:source.hostname.toLowerCase(),extension:(source.pathname.match(HEIC_PATH)||["",""])[1].toLowerCase(),templateUrl:/~tplv-/i.test(source.pathname),signed:source.searchParams.has("x-signature"),expiryPresent:source.searchParams.has("x-expires"),lk3sPresent:source.searchParams.has("lk3s")},summary:summarize(results),tests:results};
}
