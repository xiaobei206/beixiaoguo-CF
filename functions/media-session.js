const encoder = new TextEncoder();
const AAD = encoder.encode("beixiaoguo-media-session-v1");

async function sessionKey(secret, usage) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("BXG_MEDIA_SECRET must contain at least 32 characters");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [usage]);
}
function toBase64Url(bytes) {
  let binary = "";
  for (let i=0;i<bytes.length;i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function fromBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid media session token");
  const padded=value.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-value.length%4)%4);
  return Uint8Array.from(atob(padded),(char)=>char.charCodeAt(0));
}
export async function sealMediaSession(payload,secret) {
  const key=await sessionKey(secret,"encrypt");
  const nonce=crypto.getRandomValues(new Uint8Array(12));
  const plain=encoder.encode(JSON.stringify(payload));
  if(plain.byteLength>16384) throw new Error("media session payload is too large");
  const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,additionalData:AAD,tagLength:128},key,plain));
  const packed=new Uint8Array(nonce.length+encrypted.length); packed.set(nonce,0); packed.set(encrypted,nonce.length);
  return toBase64Url(packed);
}
export async function openMediaSession(token,secret) {
  const packed=fromBase64Url(token);
  if(packed.byteLength<28||packed.byteLength>16512) throw new Error("invalid media session token size");
  const key=await sessionKey(secret,"decrypt");
  try {
    const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:packed.subarray(0,12),additionalData:AAD,tagLength:128},key,packed.subarray(12));
    const payload=JSON.parse(new TextDecoder().decode(plain));
    if(!payload||payload.v!==1||!Array.isArray(payload.sources)||payload.sources.length<1||payload.sources.length>2||
       typeof payload.key!=="string"||! /^[a-fA-F0-9]{32}$/.test(payload.key)||
       !Number.isSafeInteger(payload.exp)||typeof payload.episodeId!=="string") throw new Error("invalid media session payload");
    return payload;
  } catch (_) { throw new Error("media session token is invalid or cannot be decrypted"); }
}
function rangeError(code,message){const error=new Error(message);error.code=code;return error;}
export function parseByteRange(header,size) {
  if(!Number.isSafeInteger(size)||size<=0) throw rangeError("RANGE_UNSATISFIABLE","media size is invalid");
  if(header==null||String(header).trim()==="") return {start:0,end:size-1,partial:false};
  const value=String(header).trim();
  if(!/^bytes=/i.test(value)||value.includes(",")) throw rangeError("RANGE_INVALID","only a single bytes range is supported");
  const match=value.slice(6).match(/^(\d*)-(\d*)$/);
  if(!match||(!match[1]&&!match[2])) throw rangeError("RANGE_INVALID","invalid bytes range");
  if(!match[1]) {
    const suffix=Number(match[2]);
    if(!Number.isSafeInteger(suffix)||suffix<=0) throw rangeError("RANGE_INVALID","invalid suffix range");
    const count=Math.min(suffix,size);return {start:size-count,end:size-1,partial:true};
  }
  const start=Number(match[1]);
  if(!Number.isSafeInteger(start)||start<0||start>=size) throw rangeError("RANGE_UNSATISFIABLE","range starts outside media");
  let end=size-1;
  if(match[2]) {end=Number(match[2]);if(!Number.isSafeInteger(end)||end<start) throw rangeError("RANGE_INVALID","invalid range end");end=Math.min(end,size-1);}
  return {start,end,partial:true};
}
export function parseContentRange(value) {
  const match=String(value||"").trim().match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  if(!match) throw new Error("upstream Content-Range is missing or invalid");
  const start=Number(match[1]),end=Number(match[2]),total=Number(match[3]);
  if(![start,end,total].every(Number.isSafeInteger)||start<0||end<start||total<=end) throw new Error("upstream Content-Range bounds are invalid");
  return {start,end,total};
}
export function safeMediaSource(raw) {
  let target;try{target=new URL(raw);}catch(_){throw new Error("media source URL is invalid");}
  const host=target.hostname.toLowerCase().replace(/\.$/,"");
  const literalIP=host.includes(":")||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
  if(target.protocol!=="https:"||target.username||target.password||(target.port&&target.port!=="443")||
     !host||literalIP||host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")) {
    throw new Error("media source must be public HTTPS without credentials or a literal IP");
  }
  return target.href;
}
