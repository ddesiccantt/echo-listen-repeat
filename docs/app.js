/* Echo — browser-local Listen & Repeat practice. No keys or backend required. */
'use strict';
const $ = id => document.getElementById(id);
const icons = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const labels = {campus:'校园生活', academic:'学术课堂', daily:'日常交流', custom:'我的自定义'};
const samples = {
  campus:[
    'The library will stay open until midnight during exam week.',
    'Please bring your student ID when you pick up your textbooks.',
    'The campus shuttle leaves every fifteen minutes from the main entrance.',
    'You can reserve a study room through the university website.',
    'The deadline for submitting your housing application is next Friday.',
    'Students who need financial assistance should contact the advising office.',
    'The guest lecture has been moved to the second floor of the science building.',
    'Remember to return all borrowed equipment before the end of the semester.'
  ],
  academic:[
    'Today we will discuss how climate change affects coastal ecosystems.',
    'The results of the experiment support our original hypothesis.',
    'Please read the first two chapters before our next class.',
    'Working in small groups can help students develop critical thinking skills.',
    'This discovery changed the way scientists understood human memory.',
    'You should include at least three academic sources in your research paper.',
    'The professor explained the relationship between supply and demand.',
    'Several factors may have contributed to the decline of this ancient civilization.'
  ],
  daily:[
    'Could you let me know when the next train is expected to arrive?',
    'I would like to change my appointment to Thursday afternoon.',
    'The restaurant across the street serves excellent vegetarian food.',
    'Please make sure all the windows are closed before you leave.',
    'We decided to take a different route because of the heavy traffic.',
    'You can get a full refund if you return the item within thirty days.',
    'I was wondering if you could help me carry these boxes upstairs.',
    'The weather forecast says it will probably rain later this evening.'
  ]
};
const builtin = Object.entries(samples).flatMap(([scene, sentences]) => sentences.map((text,i)=>({id:`${scene}-${i}`,scene,text})));
let persistent = true;
function readStore(key,fallback){try{return JSON.parse(localStorage.getItem('echo-'+key))??fallback;}catch{return fallback;}}
function writeStore(key,value){try{localStorage.setItem('echo-'+key,JSON.stringify(value));}catch{persistent=false;}}
let custom = readStore('sentences',[]);
if(!Array.isArray(custom)) custom=[];
custom=custom.filter(s=>s && typeof s.text==='string' && typeof s.id==='string').map(s=>({...s,scene:'custom'}));
let settings = readStore('settings',{});
if(!settings || typeof settings!=='object') settings={};
let stats = readStore('stats',{});
if(!stats || typeof stats!=='object') stats={};
let pool = [], index=0, filter='all', phase='idle', run=0, timer=null, recorder=null, recognition=null, stream=null;
let audioUrl=null, finalTranscript='', interimTranscript='', recordingRun=0, recordingStarted=0, stopPromise=null;
let voices=[], toastTimer=null, counted=false, warnedRecognition=false;
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const hasSpeech = 'speechSynthesis' in window;
const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
const escapeHtml = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function allSentences(){return [...builtin,...custom];}
function current(){return pool[index];}
function localDate(){const d=new Date();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;}
function updateStats(){ $('todayCount').textContent=Number(stats[localDate()])||0; }
function countAttempt(){if(counted)return;counted=true;stats[localDate()]=(Number(stats[localDate()])||0)+1;writeStore('stats',stats);updateStats();}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4300);}
function saveSettings(){settings={wait:Number($('waitSelect').value),rate:Number($('rate').value),limit:Number($('recordLimit').value),auto:$('autoRecord').checked,shuffle:$('shuffle').checked,voice:$('voiceSelect').value,scene:$('sceneSelect').value};writeStore('settings',settings);}
function updateWait(){let n=Math.round(Number($('waitSelect').value));n=Math.max(0,Math.min(30,Number.isFinite(n)?n:2));$('waitSelect').value=n;$('stepWait').textContent=n;document.querySelectorAll('[data-wait]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.wait)===n));updateCaption();saveSettings();}
function updateCaption(){if(phase==='idle')$('stageCaption').innerHTML=`<span class="tiny-dot"></span>听完后等待 ${$('waitSelect').value} 秒 · 录音最长 ${$('recordLimit').value} 秒`;}
function loadVoices(){if(!hasSpeech)return;const selected=$('voiceSelect').value || settings.voice;voices=speechSynthesis.getVoices().filter(v=>/^en([-_]|$)/i.test(v.lang));$('voiceSelect').innerHTML='<option value="">系统英语语音</option>'+voices.map(v=>`<option value="${escapeHtml(v.voiceURI)}">${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>`).join('');if(voices.some(v=>v.voiceURI===selected))$('voiceSelect').value=selected;}
function setPool(id){const scene=$('sceneSelect').value;pool=allSentences().filter(s=>scene==='all'||s.scene===scene);index=Math.max(0,pool.findIndex(s=>s.id===id));renderCurrent();}
function renderCurrent(){const s=current();$('navCount').textContent=allSentences().length;$('position').textContent=s?String(index+1).padStart(2,'0'):'00';$('total').textContent=pool.length;$('sceneBadge').textContent=s?labels[s.scene]:'暂无句子';$('answerPeek').hidden=true;$('revealButton').textContent='查看原句';$('reviewCard').hidden=true;$('comparison').hidden=true;$('scoreBadge').hidden=true;$('transcript').value='';$('primaryButton').disabled=!s;$('replayButton').disabled=!s;$('nextButton').disabled=!s;$('revealButton').disabled=!s;if(!s){setPhase('idle','这里还没有练习句子','去「我的句库」导入句子，或选择其他场景。');}else setPhase('idle');}
function setPhase(next,title,description){phase=next;const stage=$('stage');stage.className='stage '+next;const info={
  idle:['先听清楚，再慢慢说','点击开始，专注听一句英语。原句会在复述后揭晓。','play','开始练习'],
  preparing:['正在准备麦克风','请在浏览器提示中允许麦克风访问。','mic','准备中…'],
  listening:['专注听，把意思留住','不用急着说，听完后会开始倒计时。','close','停止播放'],
  waiting:['留住刚才听到的意思','倒计时结束后，再把这句话说出来。','close','取消本次'],
  ready:['轮到你了，开口吧','点击开始录音，复述刚才听到的句子。','mic','开始录音'],
  recording:['正在听你说…','尽量完整复述，说完就可以结束录音。','close','结束录音'],
  review:['这一次开口，完成了。','往下看看原句与复述，找到下一次可以进步的地方。','repeat','再练一次']
}[next];$('stageTitle').textContent=title||info[0];$('stageDescription').textContent=description||info[1];$('primaryButton').innerHTML=icons(info[2])+`<span>${info[3]}</span>`;$('primaryButton').disabled=next==='preparing'||!current();$('wave').hidden=next==='waiting';$('countNumber').hidden=next!=='waiting';const step={idle:1,preparing:1,listening:1,waiting:2,ready:3,recording:3,review:4}[next];document.querySelectorAll('[data-step]').forEach(e=>{e.classList.toggle('active',+e.dataset.step===step);e.classList.toggle('done',+e.dataset.step<step);});document.querySelectorAll('.settings-card input,.settings-card select,.settings-card button').forEach(e=>e.disabled=['preparing','listening','waiting','recording'].includes(next));if(next==='idle')updateCaption();}
function releaseAudio(){if(audioUrl){URL.revokeObjectURL(audioUrl);audioUrl=null;}$('recordingAudio').pause();$('recordingAudio').removeAttribute('src');$('recordingAudio').hidden=true;}
function releaseStream(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}}
function cancelRun(){run++;clearInterval(timer);timer=null;if(hasSpeech)speechSynthesis.cancel();if(recognition){recognition.onend=null;try{recognition.abort();}catch{}recognition=null;}if(recorder){recorder.onstop=null;recorder.ondataavailable=null;if(recorder.state!=='inactive')try{recorder.stop();}catch{}recorder=null;}releaseStream();releaseAudio();stopPromise=null;$('answerPeek').hidden=true;$('revealButton').textContent='查看原句';$('reviewCard').hidden=true;$('comparison').hidden=true;$('scoreBadge').hidden=true;}
async function getMic(token){if(!canRecord)throw new Error('unsupported');if(stream?.active)return stream;const received=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});if(token!==run){received.getTracks().forEach(t=>t.stop());throw new Error('cancelled');}stream=received;return stream;}
async function startPractice(){if(!current())return;cancelRun();const token=run;counted=false;finalTranscript='';interimTranscript='';$('transcript').value='';if(!hasSpeech){setPhase('idle','此浏览器暂不支持语音播放','请使用 Chrome、Edge 或 Safari 打开练习。');toast('浏览器没有提供语音播放，请换用支持的浏览器。');return;}
  let auto=$('autoRecord').checked;
  if(auto){setPhase('preparing');try{await getMic(token);}catch(e){if(token!==run)return;auto=false;toast(canRecord?'麦克风未获授权。听完后可重试录音，或输入复述内容。':'此环境不支持录音，请使用 HTTPS 下的 Chrome 或 Edge。');}}
  if(token!==run)return;setPhase('listening');$('stageCaption').textContent='正在播放英语语音';
  const u=new SpeechSynthesisUtterance(current().text);u.lang='en-US';u.rate=Number($('rate').value);const v=voices.find(v=>v.voiceURI===$('voiceSelect').value)||voices.find(v=>/^en-US/i.test(v.lang));if(v)u.voice=v;
  let ended=false;
  const fail=()=>{if(token!==run||ended)return;ended=true;releaseStream();setPhase('idle','这次语音没有播出来','请检查设备音量或更换英语发音后，再试一次。');toast('语音播放失败，请重试或切换设备英语语音。');};
  u.onerror=fail;u.onend=()=>{if(token!==run||ended)return;ended=true;beginWait(token,auto);};
  try{speechSynthesis.speak(u);}catch{fail();}
}
function beginWait(token,auto){const seconds=Number($('waitSelect').value);if(seconds===0){afterWait(token,auto);return;}setPhase('waiting');const end=performance.now()+seconds*1000;const tick=()=>{if(token!==run)return;const left=Math.max(0,Math.ceil((end-performance.now())/1000));$('countNumber').textContent=left;$('stageCaption').textContent=`还有 ${left} 秒，先别急着说`;if(left<=0){clearInterval(timer);timer=null;afterWait(token,auto);}};tick();timer=setInterval(tick,80);}
function offerManualResponse(){$('stageCaption').innerHTML='<button class="text-button" id="manualResponse">输入复述内容 →</button>';$('manualResponse').onclick=()=>{releaseStream();showReview('请手动输入你刚才复述的内容，然后对照原句。');$('transcript').focus();};}
function afterWait(token,auto){if(token!==run)return;setPhase('ready');offerManualResponse();if(auto)startRecording(token);else releaseStream();}
async function startRecording(token=run){setPhase('preparing','正在准备录音','请允许麦克风权限，然后复述刚才的句子。');try{await getMic(token);}catch(e){if(token!==run)return;setPhase('ready','暂时无法使用麦克风','检查浏览器权限后重试，或用文字记录你的复述。');$('stageCaption').innerHTML='<button class="text-button" id="manualResponse">输入复述内容 →</button>';$('manualResponse').onclick=()=>showReview('麦克风不可用，请手动输入你复述的内容。');return;}if(token!==run)return;
  finalTranscript='';interimTranscript='';$('transcript').value='';recordingRun=token;recordingStarted=performance.now();const chunks=[];
  try{recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=()=>{if(token!==run)return;const blob=new Blob(chunks,{type:recorder?.mimeType||chunks[0]?.type||'audio/webm'});if(blob.size){releaseAudio();audioUrl=URL.createObjectURL(blob);$('recordingAudio').src=audioUrl;$('recordingAudio').hidden=false;}recorder=null;releaseStream();};recorder.start();}catch{releaseStream();setPhase('ready','录音没有成功启动','请检查麦克风是否被其他应用占用，再试一次。');return;}
  setPhase('recording');let hint=Recognition?'正在识别你的复述…':'当前浏览器不支持自动转写，录音结束后可回放并手动输入。';$('transcriptHint').textContent=hint;warnedRecognition=false;
  if(Recognition){try{recognition=new Recognition();recognition.lang='en-US';recognition.continuous=true;recognition.interimResults=true;recognition.onresult=e=>{if(token!==run)return;let interim='';for(let i=e.resultIndex;i<e.results.length;i++){if(e.results[i].isFinal)finalTranscript+=e.results[i][0].transcript+' ';else interim+=e.results[i][0].transcript;}interimTranscript=interim;$('transcript').value=(finalTranscript+interimTranscript).trim();if(phase==='review'&&$('transcript').value.trim())compareText();};recognition.onerror=e=>{if(token!==run)return;if(e.error!=='aborted'){warnedRecognition=true;$('transcriptHint').textContent=e.error==='no-speech'?'没有识别到语音，可回放录音并输入复述内容。':'自动转写暂不可用，录音仍在进行；结束后可回放并手动输入。';}};recognition.start();}catch{recognition=null;warnedRecognition=true;$('transcriptHint').textContent='自动转写启动失败，结束录音后可手动输入。';}}
  const limit=Number($('recordLimit').value);const tick=()=>{if(token!==run)return;const left=Math.max(0,Math.ceil(limit-(performance.now()-recordingStarted)/1000));$('stageCaption').textContent=`● 录音中 · 剩余 ${left} 秒`;if(left<=0)stopRecording();};tick();timer=setInterval(tick,100);
}
function stopRecording(){if(phase!=='recording')return;clearInterval(timer);timer=null;const token=run;if(recorder?.state==='recording')recorder.stop();if(recognition){try{recognition.stop();}catch{}stopPromise=setTimeout(()=>{if(token!==run)return;try{recognition?.abort();}catch{}recognition=null;},1700);}countAttempt();showReview();}
function showReview(hint){countAttempt();setPhase('review');$('stageCaption').textContent='可以反复练习，也可以继续下一句';$('reviewCard').hidden=false;$('originalText').textContent=current().text;$('transcript').value=(finalTranscript+interimTranscript).trim();if(hint)$('transcriptHint').textContent=hint;else if(!warnedRecognition)$('transcriptHint').textContent=Recognition?'识别文字可编辑；请先核对识别结果，再查看文字对照。':'当前浏览器不支持自动转写。可播放录音后输入复述内容。';if($('transcript').value.trim())compareText();}
// Longest common subsequence compares word order and handles repeated words.
function tokenize(s){return (s.toLowerCase().replace(/[’‘]/g,"'").match(/[a-z0-9]+(?:'[a-z0-9]+)*/g)||[]);}
function wordDiff(reference,response){const a=tokenize(reference),b=tokenize(response);if(a.length>800||b.length>800)return null;const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);let i=0,j=0,out=[];while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){out.push({kind:'good',word:a[i]});i++;j++;}else if(j<b.length&&(i===a.length||dp[i][j+1]>dp[i+1][j])){out.push({kind:'extra',word:b[j++]});}else out.push({kind:'missing',word:a[i++]});}return {out,matches:dp[0][0],reference:a.length,response:b.length};}
function compareText(){if(!current())return;const response=$('transcript').value.trim();if(!response){toast('请先录音转写，或输入你复述的内容。');$('transcript').focus();return;}const diff=wordDiff(current().text,response);if(!diff){toast('文字太长，请每次对照不超过 800 个单词。');return;}const good=diff.matches,miss=diff.reference-good,extra=diff.response-good;const score=Math.round(100*good/Math.max(diff.reference,diff.response,1));$('scoreBadge').textContent=`文字匹配 ${score}%`;$('scoreBadge').hidden=false;$('comparison').hidden=false;$('diffText').innerHTML=diff.out.map(w=>`<span class="${w.kind}" title="${{good:'匹配',missing:'遗漏或不同',extra:'多说'}[w.kind]}">${escapeHtml(w.word)}</span>`).join(' ');$('comparisonSummary').textContent=`匹配 ${good} 词 · 遗漏或不同 ${miss} 词 · 多说 ${extra} 词`;}
function nextSentence(){if(!pool.length)return;cancelRun();if($('shuffle').checked&&pool.length>1){const r=Math.floor(Math.random()*(pool.length-1));index=r>=index?r+1:r;}else{index=(index+1)%pool.length;if(index===0)toast('已回到句库开头，继续按自己的节奏练习。');}renderCurrent();}
function showTab(tab){if(tab==='library'&&['preparing','listening','waiting','recording','ready'].includes(phase)){cancelRun();renderCurrent();}$('practiceView').hidden=tab!=='practice';$('libraryView').hidden=tab!=='library';document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));if(tab==='library')renderLibrary();}
function renderLibrary(){const q=$('searchInput').value.trim().toLowerCase();const sentences=allSentences().filter(s=>(filter==='all'||s.scene===filter)&&s.text.toLowerCase().includes(q));$('navCount').textContent=allSentences().length;$('sentenceList').innerHTML=sentences.length?sentences.map((s,i)=>`<div class="sentence-row"><span class="row-number">${String(i+1).padStart(2,'0')}</span><div class="row-content"><p lang="en">${escapeHtml(s.text)}</p><small>${labels[s.scene]} · ${tokenize(s.text).length} 词</small></div><div class="row-actions"><button data-practice="${escapeHtml(s.id)}" aria-label="练习第 ${i+1} 句">${icons('play')}</button>${s.scene==='custom'?`<button class="delete-sentence" data-delete="${escapeHtml(s.id)}" aria-label="删除第 ${i+1} 句">${icons('close')}</button>`:''}</div></div>`).join(''):'<div class="empty-state">还没有找到句子。试试其他分类，或导入自己的材料。</div>';}
function importedLines(){const seen=new Set();return $('importText').value.split(/\r?\n/).map(s=>s.trim()).filter(s=>{const k=s.toLowerCase();if(!s||seen.has(k))return false;seen.add(k);return true;});}
function newLines(){const exists=new Set(allSentences().map(s=>s.text.toLowerCase()));return importedLines().filter(s=>!exists.has(s.toLowerCase()));}
function openImport(){$('importDialog').showModal();$('importText').focus();}
$('primaryButton').onclick=()=>{if(['idle','review'].includes(phase))startPractice();else if(['listening','waiting'].includes(phase)){cancelRun();renderCurrent();}else if(phase==='ready')startRecording();else if(phase==='recording')stopRecording();};
$('replayButton').onclick=startPractice;$('retryButton').onclick=()=>{startPractice();$('stage').scrollIntoView({behavior:'smooth',block:'center'});};$('nextButton').onclick=nextSentence;$('continueButton').onclick=()=>{nextSentence();$('stage').scrollIntoView({behavior:'smooth',block:'center'});};$('compareButton').onclick=compareText;
$('revealButton').onclick=()=>{if(!current())return;const show=$('answerPeek').hidden;$('answerPeek').hidden=!show;$('answerPeek').textContent=current().text;$('revealButton').textContent=show?'隐藏原句':'查看原句';};
$('transcript').oninput=()=>{$('comparison').hidden=true;$('scoreBadge').hidden=true;};
$('waitSelect').onchange=updateWait;document.querySelectorAll('[data-wait]').forEach(b=>b.onclick=()=>{$('waitSelect').value=b.dataset.wait;updateWait();});
$('rate').oninput=()=>{$('rateValue').textContent=Number($('rate').value).toFixed(1)+'×';saveSettings();};$('recordLimit').onchange=()=>{saveSettings();updateCaption();};$('voiceSelect').onchange=saveSettings;$('autoRecord').onchange=saveSettings;$('shuffle').onchange=saveSettings;
$('sceneSelect').onchange=()=>{cancelRun();setPool();saveSettings();};document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));document.querySelector('.brand').onclick=e=>{e.preventDefault();showTab('practice');};
$('helpButton').onclick=()=>$('helpDialog').showModal();$('openImportButton').onclick=openImport;$('importShortcut').onclick=openImport;document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}));
$('importText').oninput=()=>{$('importCount').textContent=`${newLines().length} 句待导入 · 自动忽略空行和重复句子`;};
$('importConfirm').onclick=()=>{const lines=newLines();if(!lines.length){toast('请粘贴新句子，每行一句，已有句子会自动忽略。');return;}if(lines.some(s=>tokenize(s).length>150)){toast('有句子超过 150 个单词，请拆成更短的句子后导入。');return;}if(lines.some(s=>!/[a-z]/i.test(s))){toast('请导入含有英语单词的句子。');return;}const added=lines.map(text=>({id:'custom-'+crypto.randomUUID(),scene:'custom',text}));custom.push(...added);writeStore('sentences',custom);cancelRun();$('sceneSelect').value='custom';setPool(added[0].id);saveSettings();$('importDialog').close();$('importText').value='';$('importCount').textContent='0 句待导入 · 自动忽略空行和重复句子';renderLibrary();toast(persistent?`已加入 ${added.length} 句，选择「复述练习」即可开始。`:'已加入句库，但浏览器禁止本地存储，关闭页面后可能丢失。');};
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(e=>e.classList.toggle('selected',e===b));renderLibrary();});$('searchInput').oninput=renderLibrary;
$('sentenceList').onclick=e=>{const practice=e.target.closest('[data-practice]'),del=e.target.closest('[data-delete]');if(practice){cancelRun();$('sceneSelect').value='all';setPool(practice.dataset.practice);showTab('practice');saveSettings();window.scrollTo({top:0,behavior:'smooth'});}if(del){const removed=custom.find(s=>s.id===del.dataset.delete);const selected=current()?.id;custom=custom.filter(s=>s.id!==del.dataset.delete);writeStore('sentences',custom);cancelRun();setPool(selected);renderLibrary();toast('已删除自定义句子。');/* Short undo without a destructive confirmation. */const undo=document.createElement('button');undo.textContent='撤销';undo.style.cssText='background:transparent;color:#fff;text-decoration:underline;margin-left:12px;font:inherit';undo.onclick=()=>{if(removed){custom.push(removed);writeStore('sentences',custom);setPool(selected);renderLibrary();toast('已恢复句子。');}};$('toast').appendChild(undo);}};
// Restore bounded, validated preferences only.
$('waitSelect').value=Number.isFinite(settings.wait)?Math.min(30,Math.max(0,settings.wait)):2;$('rate').value=Number.isFinite(settings.rate)?Math.min(1.2,Math.max(.6,settings.rate)):1;$('rateValue').textContent=Number($('rate').value).toFixed(1)+'×';$('recordLimit').value=[15,20,30,60].includes(settings.limit)?settings.limit:20;$('autoRecord').checked=settings.auto!==false;$('shuffle').checked=settings.shuffle===true;if(['all','campus','academic','daily','custom'].includes(settings.scene))$('sceneSelect').value=settings.scene;loadVoices();if(hasSpeech)speechSynthesis.addEventListener('voiceschanged',loadVoices);setPool();updateWait();updateStats();
if(!Recognition)$('browserNote').textContent='当前浏览器不支持自动转写，仍可录音回放并手动输入。自动转写建议使用 Chrome 或 Edge；首次使用需允许麦克风。';
if(!canRecord)$('browserNote').textContent='当前环境暂不支持录音。请使用 HTTPS 网址，在 Chrome、Edge 或 Safari 中打开；也可以手动输入复述内容。';
document.addEventListener('visibilitychange',()=>{if(document.hidden&&['preparing','listening','waiting','recording'].includes(phase)){if(phase==='recording')stopRecording();else{cancelRun();renderCurrent();toast('页面切到后台，练习已暂停。点击开始可重新练习本句。');}}});
window.addEventListener('pagehide',()=>cancelRun());
