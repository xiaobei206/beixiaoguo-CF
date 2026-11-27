//go:build js && wasm

package main

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"syscall/js"
	"time"

	"example.com/beixiaoguo-cf/edge-cenc/cenc"
)

type layoutEntry struct { layout *cenc.Layout; expiresAt int64; lastUsed int64 }
var layoutsMu sync.Mutex
var layouts = make(map[string]layoutEntry)

func main() {
	js.Global().Set("__BXG_CENC", js.ValueOf(map[string]any{
		"open": js.FuncOf(openCENC),
		"decrypt": js.FuncOf(decryptCENC),
		"close": js.FuncOf(closeCENC),
		"ping": js.FuncOf(func(js.Value, []js.Value) any { return true }),
	}))
	if ready := js.Global().Get("__BXG_CENC_READY_CALLBACK"); ready.Type() == js.TypeFunction {
		ready.Invoke()
	}
	select {}
}
func openCENC(_ js.Value,args []js.Value) any {
	return promise(func()(any,error){
		if len(args)<4{return nil,errors.New("cenc.open needs id, total size, key hex and expiry")}
		id:=args[0].String();total:=int64(args[1].Float());keyHex:=args[2].String();exp:=int64(args[3].Float())
		if id==""||total<=0||exp<=time.Now().UnixMilli(){return nil,errors.New("invalid CENC session parameters")}
		now:=time.Now().UnixMilli()
		layoutsMu.Lock();purgeExpired(now)
		if cached,ok:=layouts[id];ok&&cached.expiresAt>now{cached.lastUsed=now;layouts[id]=cached;layoutsMu.Unlock();return map[string]any{"protected":cached.layout.IsProtected(),"cached":true},nil}
		layoutsMu.Unlock()
		key,err:=hex.DecodeString(keyHex);if err!=nil||len(key)!=16{return nil,cenc.ErrInvalidKey}
		defer func(){for i:=range key{key[i]=0}}()
		fetch:=func(offset,count int64)([]byte,error){
			if offset<0||count<0||offset>total||count>total-offset{return nil,errors.New("CENC fetch range outside media file")}
			if count==0{return []byte{},nil}
			fn:=js.Global().Get("__BXG_CENC_FETCH_RANGE");if fn.Type()!=js.TypeFunction{return nil,errors.New("CENC range callback is not installed")}
			value,err:=awaitPromise(fn.Invoke(id,offset,count));if err!=nil{return nil,err}
			if value.Type()!=js.TypeObject||value.Get("byteLength").Type()!=js.TypeNumber{return nil,errors.New("CENC callback did not return Uint8Array")}
			length:=value.Get("byteLength").Int();if int64(length)!=count{return nil,fmt.Errorf("CENC callback returned %d bytes; expected %d",length,count)}
			data:=make([]byte,length);js.CopyBytesToGo(data,value);return data,nil
		}
		layout,err:=cenc.Open(total,key,fetch);if err!=nil{return nil,err};if !layout.IsProtected(){return nil,errors.New("MP4 contains no protected CENC samples")}
		layoutsMu.Lock();purgeExpired(time.Now().UnixMilli());if len(layouts)>=8{evictOldest()}
		layouts[id]=layoutEntry{layout:layout,expiresAt:exp,lastUsed:time.Now().UnixMilli()};layoutsMu.Unlock()
		return map[string]any{"protected":true,"cached":false},nil
	})
}
func decryptCENC(_ js.Value,args []js.Value) any {
	if len(args)<3{return false}
	id:=args[0].String();offset:=int64(args[1].Float());value:=args[2]
	if value.Type()!=js.TypeObject||value.Get("byteLength").Type()!=js.TypeNumber||offset<0{return false}
	layoutsMu.Lock();purgeExpired(time.Now().UnixMilli());entry,ok:=layouts[id]
	if ok{entry.lastUsed=time.Now().UnixMilli();layouts[id]=entry};layoutsMu.Unlock()
	if !ok||entry.layout==nil{return false}
	data:=make([]byte,value.Get("byteLength").Int());js.CopyBytesToGo(data,value);entry.layout.Decrypt(data,offset);js.CopyBytesToJS(value,data);return true
}
func closeCENC(_ js.Value,args []js.Value) any {if len(args)==0{return false};layoutsMu.Lock();delete(layouts,args[0].String());layoutsMu.Unlock();return true}
func purgeExpired(now int64){for id,entry:=range layouts{if entry.expiresAt<=now{delete(layouts,id)}}}
func evictOldest(){var id string;var oldest int64;for key,entry:=range layouts{if id==""||entry.lastUsed<oldest{id,oldest=key,entry.lastUsed}};if id!=""{delete(layouts,id)}}
func promise(f func()(any,error)) js.Value {
	var executor js.Func
	executor=js.FuncOf(func(_ js.Value,args []js.Value)any{
		resolve,reject:=args[0],args[1]
		go func(){defer executor.Release();value,err:=f();if err!=nil{reject.Invoke(js.Global().Get("Error").New(err.Error()));return};raw,err:=json.Marshal(value);if err!=nil{reject.Invoke(js.Global().Get("Error").New(err.Error()));return};resolve.Invoke(string(raw))}()
		return nil
	})
	return js.Global().Get("Promise").New(executor)
}
func awaitPromise(p js.Value)(js.Value,error){
	if p.Type()!=js.TypeObject||p.Get("then").Type()!=js.TypeFunction{return p,nil}
	type result struct{value js.Value;err error}
	done:=make(chan result,1)
	onOK:=js.FuncOf(func(_ js.Value,args []js.Value)any{if len(args)==0{done<-result{value:js.Undefined()}}else{done<-result{value:args[0]}};return nil})
	onErr:=js.FuncOf(func(_ js.Value,args []js.Value)any{err:=errors.New("CENC range callback failed");if len(args)>0{if value:=args[0];value.Type()==js.TypeObject&&value.Get("message").Type()==js.TypeString{err=errors.New(value.Get("message").String())}else{err=errors.New(value.String())}};done<-result{err:err};return nil})
	p.Call("then",onOK,onErr);out:=<-done;onOK.Release();onErr.Release();return out.value,out.err
}
