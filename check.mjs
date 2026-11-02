import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync('docs/index.html','utf8');
const elements=new Map();
class Element{
  constructor(id){this.id=id;this.value='';this.hidden=false;this.checked=false;this.disabled=false;this.dataset={};this.classList={toggle(){}};}
  set innerHTML(v){this.html=v;} get innerHTML(){return this.html;}
  focus(){} pause(){} removeAttribute(){} scrollIntoView(){} showModal(){this.open=true;} close(){this.open=false;} appendChild(){} addEventListener(){}
}
for(const [,id]of html.matchAll(/id="([^"]+)"/g))elements.set(id,new Element(id));
elements.get('sceneSelect').value='all';elements.get('rate').value='1';elements.get('waitSelect').value='2';elements.get('recordLimit').value='20';elements.get('autoRecord').checked=true;
let now=0, intervals=new Map(),nextTimer=0, synthUtterance, tracksStopped=0;
const localData=new Map();
const context=vm.createContext({console,Uint16Array,Math,Date,Number,String,Set,Array,JSON,Blob,Error,crypto:globalThis.crypto,performance:{now:()=>now},
  document:{getElementById:id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);},querySelectorAll:()=>[],querySelector:()=>new Element('brand'),addEventListener(){},createElement:()=>new Element('new')},
  window:{speechSynthesis:true,MediaRecorder:true,addEventListener(){},scrollTo(){}},
  navigator:{mediaDevices:{getUserMedia:async()=>({active:true,getTracks:()=>[{stop(){tracksStopped++;}}]})}},
  localStorage:{getItem:k=>localData.get(k)||null,setItem:(k,v)=>localData.set(k,v)},
  speechSynthesis:{getVoices:()=>[],cancel(){},speak:u=>{synthUtterance=u;},addEventListener(){}},SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},
  MediaRecorder:class{constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['sound'])});this.onstop?.();}},
  setInterval:fn=>{const id=++nextTimer;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id),setTimeout:()=>++nextTimer,clearTimeout(){},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}}
});
const app=fs.readFileSync('docs/app.js','utf8');vm.runInContext(app,context);
const evaluate=code=>vm.runInContext(code,context);
const tick=ms=>{now+=ms;for(const fn of [...intervals.values()])fn();};
assert.equal(evaluate('pool.length'),24);
assert.equal(evaluate('wordDiff("The cat sat.","the CAT sat!").matches'),3);
assert.equal(evaluate('wordDiff("a b a", "a a").matches'),2);
assert.equal(evaluate('wordDiff("one two", "one extra two").out.filter(x=>x.kind==="extra").length'),1);
elements.get('importText').value=' A sentence.\na sentence.\n\nAnother sentence.';
assert.equal(evaluate('newLines().length'),2);
// Real flow: time cannot begin before the utterance end event.
await evaluate('startPractice()');assert.equal(evaluate('phase'),'listening');tick(5000);assert.equal(evaluate('phase'),'listening');
synthUtterance.onend();assert.equal(evaluate('phase'),'waiting');tick(1999);assert.equal(evaluate('phase'),'waiting');
tick(1);await Promise.resolve();await Promise.resolve();assert.equal(evaluate('phase'),'recording');
evaluate('stopRecording()');assert.equal(evaluate('phase'),'review');assert.equal(elements.get('todayCount').textContent,1);assert.equal(elements.get('recordingAudio').hidden,false);
elements.get('transcript').value=evaluate('current().text');evaluate('compareText()');assert.equal(elements.get('scoreBadge').textContent,'文字匹配 100%');
evaluate('stopRecording()');assert.equal(elements.get('todayCount').textContent,1);
// Skip invalidates in-flight speech callbacks and releases resources.
await evaluate('startPractice()');const stale=synthUtterance;evaluate('nextSentence()');assert.equal(evaluate('index'),1);stale.onend();assert.equal(evaluate('phase'),'idle');assert.equal(intervals.size,0);assert.ok(tracksStopped>0);
// No waiting and manual recording mode remain usable.
elements.get('autoRecord').checked=false;elements.get('waitSelect').value='0';await evaluate('startPractice()');synthUtterance.onend();assert.equal(evaluate('phase'),'ready');assert.equal(intervals.size,0);
evaluate('offerManualResponse()');elements.get('manualResponse').onclick();assert.equal(evaluate('phase'),'review');assert.equal(elements.get('todayCount').textContent,2);
// Import is retained locally; its contents are escaped in rendered markup.
elements.get('importText').value='Please say <hello>.';elements.get('importConfirm').onclick();assert.equal(evaluate('custom.length'),1);assert.ok(localData.has('echo-sentences'));evaluate('renderLibrary()');assert.ok(elements.get('sentenceList').innerHTML.includes('&lt;hello&gt;'));
console.log('PASS: 24 samples, ordered word comparison, duplicate import, end-triggered 2s wait, recording/replay, attempt counting, cancellation, zero-wait manual mode, local persistence, HTML escaping.');
