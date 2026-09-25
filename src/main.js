import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createBeadGeometry, BeadMotion } from './beads.js';
import { mountUI, onUI, setUIStatus } from './ui.jsx';
import { frameCount, frameRange } from './frame-range.js';
import './style.css';

mountUI();
const $ = id => document.getElementById(id);
const state = { columns:64, rows:36, fps:12, time:0, duration:12, playing:true, speed:1, palette:'original', view:'3d', spacing:.9, height:1, texture:true, motion:true, source:'demo', exporting:false, muted:true, includeAudio:true, exportResolution:'preview', rangeStart:1, rangeEnd:144 };
const sample = document.createElement('canvas');
const ctx = sample.getContext('2d', { willReadFrequently:true });
const source = document.createElement('canvas'); source.width=640; source.height=360;
const sourceCtx = source.getContext('2d');
const video = document.createElement('video'); video.muted=true; video.playsInline=true; video.loop=true; video.preload='auto';
let sourceUrl, sourceFile, mesh, pegs, beadMotion, lastSample=-1, lastTime=performance.now(), toastTimer, exportController, generation=0;
let pendingSeek=null, currentThumbnail=-1;
const timelineCanvases=[...document.querySelectorAll('[data-frame]')];
const overviewCanvases=timelineCanvases.map(()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;return canvas;});
const palette = ['#f7edda','#eed09c','#efba66','#dc9956','#dd7953','#c45447','#a43e48','#753d50','#54344f','#343746','#263440','#375461','#527783','#789395','#a3b4aa','#b5be96','#809064','#546945','#384d40','#dba1a0','#bb7b88','#986d8a','#80688f','#616782','#60799e','#83a4b7','#a6cbd0','#d4d7c5','#a59380','#7b6b62','#514846','#24262e'].map(c=>new THREE.Color(c));
const paletteRGB=palette.map(c=>{const s=c.clone().convertLinearToSRGB();return [s.r*255,s.g*255,s.b*255];});
const colorCache=new Map();
function toast(message) { $('toast').textContent=message; $('toast').classList.add('show'); clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4000); }
function clock(t) {return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;}
function demoDraw(t, target=sourceCtx, w=640, h=360) {
 target.save();target.scale(w/640,h/360);
 const g=target.createLinearGradient(0,0,0,360);g.addColorStop(0,'#343b60');g.addColorStop(.32,'#a76677');g.addColorStop(.64,'#efb084');g.addColorStop(1,'#426c79');target.fillStyle=g;target.fillRect(0,0,640,360);
 target.fillStyle='#f9d59d';target.beginPath();target.arc(420+Math.sin(t*Math.PI/6)*14,137,49,0,Math.PI*2);target.fill();
 const mountain=(points,c)=>{target.fillStyle=c;target.beginPath();target.moveTo(0,360);points.forEach(p=>target.lineTo(...p));target.lineTo(640,360);target.fill();};
 mountain([[0,194],[35,180],[70,196],[138,119],[184,178],[239,154],[285,204],[353,169],[416,205],[473,171],[515,197],[570,144],[640,199]],'#75667d');
 mountain([[0,236],[56,218],[120,241],[191,203],[261,222],[327,189],[386,227],[446,208],[518,232],[589,199],[640,217]],'#4b657a');
 const lake=target.createLinearGradient(0,242,0,360);lake.addColorStop(0,'#739295');lake.addColorStop(1,'#294b63');target.fillStyle=lake;target.fillRect(0,246,640,114);
 for(let i=0;i<32;i++){const y=250+i*3.5;const x=418+Math.sin(i*1.8+t*2)*13;target.fillStyle=`rgba(249,190,141,${.65-i*.012})`;target.fillRect(x-(12+i*1.2),y,24+i*2.4,1.8);}
 for(let i=0;i<19;i++){target.fillStyle='rgba(161,185,181,.22)';target.fillRect((i*97+t*(8+i%3))%690-50,260+(i*17)%93,25+(i%4)*10,1.4);}
 mountain([[0,270],[30,280],[70,274],[98,291],[130,288],[180,322],[206,335],[228,360]],'#283f50');
 mountain([[440,360],[477,327],[508,328],[545,303],[578,310],[617,287],[640,289]],'#253c4a');
 const tree=(x,y,s)=>{target.fillStyle='#243946';target.fillRect(x-s*.045,y-s,s*.09,s);for(let i=0;i<3;i++){target.beginPath();target.moveTo(x,y-s-i*s*.2);target.lineTo(x-s*(.32-i*.065),y-i*s*.22);target.lineTo(x+s*(.32-i*.065),y-i*s*.22);target.fill();}};
 tree(38,302,69);tree(75,319,48);tree(600,332,67);tree(627,316,86);
 target.strokeStyle='#41455b';target.lineWidth=2;for(let i=0;i<3;i++){const x=(125+t*11+i*24)%620;const y=80+i%2*12;target.beginPath();target.moveTo(x-6,y+2);target.quadraticCurveTo(x-3,y-3,x,y);target.quadraticCurveTo(x+3,y-3,x+6,y+2);target.stroke();}
 target.restore();
}

const stage=$('stage');
let renderer;
try { renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); }
catch(error){stage.innerHTML='<div class="webgl-error">无法启动 3D 预览，请使用支持 WebGL 的浏览器并开启硬件加速。</div>';throw error;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor('#e9e8e1');renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;stage.prepend(renderer.domElement);
const scene=new THREE.Scene();
const room=new RoomEnvironment();const pmrem=new THREE.PMREMGenerator(renderer);const environment=pmrem.fromScene(room,.04);
scene.environment=environment.texture;scene.environmentIntensity=.55;room.dispose();pmrem.dispose();
const camera=new THREE.PerspectiveCamera(36,1,.1,500);camera.position.set(0,0,110);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.enablePan=true;controls.enableRotate=true;controls.minDistance=12;controls.maxDistance=210;controls.maxPolarAngle=Math.PI*.82;
scene.add(new THREE.HemisphereLight(0xf5f7ff,0x77736a,.65));
const light=new THREE.DirectionalLight(0xfff5e7,2.2);light.position.set(-35,50,85);light.castShadow=true;
light.shadow.mapSize.set(4096,4096);Object.assign(light.shadow.camera,{left:-68,right:68,top:48,bottom:-48,near:1,far:220});light.shadow.normalBias=.025;light.shadow.bias=-.00005;light.shadow.camera.updateProjectionMatrix();scene.add(light);
const fillLight=new THREE.DirectionalLight(0xddeaff,.6);fillLight.position.set(35,-20,50);scene.add(fillLight);
const board=new THREE.Mesh(new THREE.BoxGeometry(100,58,.85),new THREE.MeshPhysicalMaterial({color:'#dedacf',roughness:.5,clearcoat:.18}));board.position.z=-.425;board.receiveShadow=true;board.castShadow=true;scene.add(board);
const table=new THREE.Mesh(new THREE.PlaneGeometry(500,500),new THREE.MeshStandardMaterial({color:'#e9e8e1',roughness:1}));table.position.z=-1.0;table.receiveShadow=true;scene.add(table);
const beadGeometry=createBeadGeometry();
const beadMaterial=new THREE.MeshPhysicalMaterial({roughness:.29,metalness:0,clearcoat:.28,clearcoatRoughness:.3,ior:1.46,vertexColors:true});
const flatMaterial=new THREE.MeshBasicMaterial();
const pegGeometry=new THREE.CylinderGeometry(.078,.105,.8,8);pegGeometry.rotateX(Math.PI/2);pegGeometry.translate(0,0,.4);
const pegMaterial=new THREE.MeshPhysicalMaterial({color:'#c6c3b4',roughness:.5,clearcoat:.15});
function buildBoard(){
 if(mesh){scene.remove(mesh);mesh.dispose();}
 if(pegs){scene.remove(pegs);pegs.dispose();}
 state.rows=Math.round(state.columns*9/16);sample.width=state.columns;sample.height=state.rows;
 mesh=new THREE.InstancedMesh(beadGeometry,state.texture?beadMaterial:flatMaterial,state.columns*state.rows);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 mesh.castShadow=state.texture;mesh.receiveShadow=state.texture;mesh.frustumCulled=false;
 pegs=new THREE.InstancedMesh(pegGeometry,pegMaterial,mesh.count);pegs.receiveShadow=true;
 const object=new THREE.Object3D();const step=96/state.columns;
 for(let y=0;y<state.rows;y++)for(let x=0;x<state.columns;x++){object.position.set((x-(state.columns-1)/2)*step,((state.rows-1)/2-y)*step,0);object.scale.setScalar(step);object.updateMatrix();const i=y*state.columns+x;pegs.setMatrixAt(i,object.matrix);mesh.setColorAt(i,new THREE.Color('#e8ad80'));}
 beadMotion=new BeadMotion(mesh,state);beadMotion.enabled=state.motion;
 scene.add(mesh,pegs);$('density-value').textContent=`${state.columns} × ${state.rows}`;$('resolution').textContent=`${state.columns} × ${state.rows}`;$('bead-count').textContent=`${(state.columns*state.rows).toLocaleString()} 颗拼豆`;lastSample=-1;paintFrame();beadMotion.settle();
}
function drawSource(){
 if(state.source==='demo'){demoDraw(state.time);return true;}
 // currentTime changes before decoding completes. Never sample the old image
 // while seeking, including when the user rapidly changes the destination.
 if(video.readyState<2||video.seeking||pendingSeek!==null)return false;
 sourceCtx.fillStyle='#24262e';sourceCtx.fillRect(0,0,640,360);
 const scale=Math.min(640/video.videoWidth,360/video.videoHeight);const w=video.videoWidth*scale,h=video.videoHeight*scale;sourceCtx.drawImage(video,(640-w)/2,(360-h)/2,w,h);return true;
}
const color=new THREE.Color();
function paintFrame({settle=false}={}){
 if(!mesh || !drawSource())return false;
 sampleBeads();
 if(settle||!state.playing)beadMotion.settle();
 return true;
}
function sampleBeads(updateThumbnail=true){
 ctx.drawImage(source,0,0,state.columns,state.rows);const data=ctx.getImageData(0,0,state.columns,state.rows).data;
 for(let i=0;i<mesh.count;i++){const p=i*4,r=data[p],g=data[p+1],b=data[p+2];if(state.palette==='beads'){const key=(r>>3)*1024+(g>>3)*32+(b>>3);let index=colorCache.get(key);if(index===undefined){let best=Infinity;paletteRGB.forEach((c,j)=>{const d=(r-c[0])**2+(g-c[1])**2+(b-c[2])**2;if(d<best){best=d;index=j;}});colorCache.set(key,index);}beadMotion.setTarget(i,palette[index]);}else{color.setRGB(r/255,g/255,b/255,THREE.SRGBColorSpace);beadMotion.setTarget(i,color);}}
 if(updateThumbnail){$('source-thumb').getContext('2d').drawImage(source,0,0,96,64);updateTimelinePreview();}
}
function updateTimelinePreview(){
 const index=Math.min(timelineCanvases.length-1,Math.floor(state.time/state.duration*timelineCanvases.length));
 if(currentThumbnail!==index&&currentThumbnail>=0){const previous=timelineCanvases[currentThumbnail];previous.getContext('2d').drawImage(overviewCanvases[currentThumbnail],0,0);delete previous.dataset.current;previous.removeAttribute('aria-label');}
 currentThumbnail=index;const canvas=timelineCanvases[index];
 canvas.getContext('2d').drawImage(source,0,0,160,90);canvas.dataset.current='true';
 canvas.setAttribute('aria-label',`当前帧：第 ${currentFrame()} 帧`);
 $('current-thumb-label').style.left=`${canvas.offsetLeft}px`;
}
function refreshOverview(index){
 if(index!==currentThumbnail)timelineCanvases[index].getContext('2d').drawImage(overviewCanvases[index],0,0);
}
function resetThumbnails(){
 currentThumbnail=-1;
 timelineCanvases.forEach((canvas,i)=>{delete canvas.dataset.current;canvas.removeAttribute('aria-label');overviewCanvases[i].getContext('2d').clearRect(0,0,160,90);canvas.getContext('2d').clearRect(0,0,160,90);});
}
function currentFrame(){return Math.min(frameCount(state.duration,state.fps),Math.floor(state.time*state.fps+1e-4)+1);}
function updateUI(){ $('current-time').textContent=clock(state.time);$('duration').textContent=clock(state.duration);$('seek').max=state.duration;$('seek').value=state.time;$('playhead').style.left=`${state.time/state.duration*100}%`;$('frame-count').innerHTML=`${frameCount(state.duration,state.fps).toLocaleString()} 帧 <b>·</b> ${state.fps} 帧 / 秒`;$('stage-fps').textContent=`${state.fps} FPS`;$('current-frame').textContent=`第 ${currentFrame()} 帧`; }
function setExportRange(start,end){
 const range=frameRange(start,end,state.duration,state.fps);state.rangeStart=range.start;state.rangeEnd=range.end;
 setUIStatus({rangeStart:range.start,rangeEnd:range.end,totalFrames:range.total,fps:state.fps,duration:state.duration});
 const left=range.startTime/state.duration*100,right=range.endTime/state.duration*100;
 $('range-before').style.width=`${left}%`;$('range-after').style.width=`${100-right}%`;
 $('range-highlight').style.left=`${left}%`;$('range-highlight').style.width=`${right-left}%`;
}
function updateTicks(){ $('ticks').innerHTML=Array.from({length:5},(_,i)=>`<span>${clock(state.duration*i/4)}</span>`).join(''); }
function demoThumbnails(){overviewCanvases.forEach((c,i)=>{demoDraw(state.duration*(i+.5)/timelineCanvases.length,c.getContext('2d'),160,90);refreshOverview(i);});}
async function play(value){const wasPlaying=state.playing;state.playing=value;if(state.source==='video'){if(value){try{await video.play();}catch{state.playing=false;toast('无法播放这个视频，请尝试 MP4（H.264）格式。');}}else{video.pause();if(wasPlaying&&!video.seeking&&pendingSeek===null)state.time=video.currentTime;}}if(!state.playing&&!state.exporting){paintFrame({settle:true});updateUI();}setUIStatus({playing:state.playing});}
function setTime(t){
 // Sample boundaries match the exported frame sequence, including stepping.
 // Allow for the video element rounding currentTime to microseconds.
 const frame=Math.min(frameCount(state.duration,state.fps)-1,Math.max(0,Math.floor(t*state.fps+1e-4)));
 state.time=frame/state.fps;lastSample=-1;
 if(state.source==='video'){
   pendingSeek=state.time;video.currentTime=state.time;
   if(!video.seeking){pendingSeek=null;paintFrame({settle:true});}
 }else paintFrame({settle:true});
 updateUI();
}
function resetView(){
 const margin=state.view==='3d'?67:57;
 const distance=Math.max(110,margin/(Math.tan(THREE.MathUtils.degToRad(18))*camera.aspect));
 // Drain pending orbit inertia before resetting, so a recent drag cannot
 // reintroduce a sideways angle on the following animation frames.
 controls.enableDamping=false;controls.update();
 camera.up.set(0,1,0);
 camera.position.set(...(state.view==='3d'?[0,-distance*.48,distance*.87]:[0,0,distance]));
 controls.target.set(0,0,0);controls.enableRotate=state.view==='3d';controls.update();controls.enableDamping=true;
 $('view-hint').textContent=state.view==='3d'?'拖拽旋转 · 滚轮放大 · 右键平移':'滚轮放大 · 右键平移';
}
function resizePreview(){if(currentThumbnail>=0)$('current-thumb-label').style.left=`${timelineCanvases[currentThumbnail].offsetLeft}px`;const w=stage.clientWidth,h=stage.clientHeight;const size=renderer.getSize(new THREE.Vector2());if(size.x===w&&size.y===h&&Math.abs(camera.aspect-w/h)<.001)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();resetView();}
new ResizeObserver(()=>{if(!state.exporting)resizePreview();}).observe(stage);
function animate(now){requestAnimationFrame(animate);const delta=Math.min((now-lastTime)/1000,.1);lastTime=now;if(state.exporting)return;if(state.playing){if(state.source==='demo'){state.time=(state.time+delta*state.speed)%state.duration;}else if(!video.seeking&&pendingSeek===null)state.time=video.currentTime;}
 const frame=Math.floor(state.time*state.fps+1e-4);if(frame!==lastSample&&paintFrame()){lastSample=frame;updateUI();}beadMotion.duration=Math.min(.19,.7/(state.fps*state.speed));beadMotion.update(now/1000);controls.update();renderer.render(scene,camera);
}
buildBoard();demoThumbnails();updateTicks();updateUI();setExportRange(1,frameCount(state.duration,state.fps));requestAnimationFrame(animate);
onUI('play',()=>play(!state.playing));onUI('prev',()=>{play(false);setTime(state.time-1/state.fps);});onUI('next',()=>{play(false);setTime(state.time+1/state.fps);});
$('seek').oninput=e=>{if(!state.exporting){const time=Number(e.target.value);play(false);setTime(time);}};
video.addEventListener('seeked',()=>{
 if(state.source!=='video'||video.seeking)return;
 if(pendingSeek!==null&&Math.abs(video.currentTime-pendingSeek)>.001)return;
 const landedTime=pendingSeek??video.currentTime;pendingSeek=null;
 if(!state.exporting){state.time=landedTime;lastSample=-1;paintFrame({settle:true});updateUI();}
});
onUI('density',value=>{state.columns=[64,96,128,160][Number(value)];buildBoard();});
onUI('spacing',value=>{state.spacing=Number(value);buildBoard();});onUI('fps',value=>{const previous=frameRange(state.rangeStart,state.rangeEnd,state.duration,state.fps);state.fps=Number(value);setExportRange(Math.floor(previous.startTime*state.fps+1e-7)+1,Math.ceil(previous.endTime*state.fps-1e-7));lastSample=-1;updateUI();});
onUI('height',value=>{state.height=Number(value);$('height-value').textContent=state.height===1?'标准长筒':`${state.height.toFixed(1)}× 高度`;beadMotion.height=state.height;beadMotion.settle();});
onUI('motion',checked=>{state.motion=checked;beadMotion.enabled=checked;if(!checked)beadMotion.settle();});
onUI('speed',value=>{state.speed=Number(value);video.playbackRate=state.speed;});
onUI('sound',()=>{if(state.source!=='video'||state.exporting)return;state.muted=!state.muted;video.muted=state.muted;setUIStatus({muted:state.muted});});
onUI('range-start',value=>{if(state.exporting)return;play(false);setExportRange(Math.min(value,state.rangeEnd),state.rangeEnd);setTime((state.rangeStart-1)/state.fps);});
onUI('range-end',value=>{if(state.exporting)return;play(false);setExportRange(state.rangeStart,Math.max(value,state.rangeStart));setTime((state.rangeEnd-1)/state.fps);});
onUI('range-all',()=>setExportRange(1,frameCount(state.duration,state.fps)));
onUI('include-audio',checked=>{state.includeAudio=checked;setUIStatus({includeAudio:checked});});
onUI('export-resolution',value=>{if(!state.exporting)state.exportResolution=value;});
for(const id of ['palette','view'])onUI(id,value=>{state[id]=value;if(id==='view')resetView();else{$('palette-note').textContent=state.palette==='beads'?'32 色':'全彩';lastSample=-1;paintFrame();}});
onUI('texture',checked=>{state.texture=checked;mesh.material=state.texture?beadMaterial:flatMaterial;mesh.castShadow=state.texture;mesh.receiveShadow=state.texture;});onUI('reset-view',resetView);
onUI('fullscreen',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await stage.requestFullscreen();}catch{toast('当前浏览器不支持全屏模式。');}});

document.addEventListener('keydown',e=>{if(document.activeElement.closest('input,select,button,textarea,[role=slider],[role=combobox],[role=switch],[role=checkbox],[role=spinbutton],[role=option]')||document.querySelector('[role=dialog]')||state.exporting)return;if(e.code==='Space'){e.preventDefault();play(!state.playing);}if(e.code==='ArrowLeft'||e.code==='ArrowRight'){e.preventDefault();play(false);setTime(state.time+(e.code==='ArrowRight'?1:-1)/state.fps);}});
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
onUI('snapshot',()=>{renderer.render(scene,camera);renderer.domElement.toBlob(blob=>{if(blob){download(blob,`BeanMotion-第${currentFrame()}帧.png`);toast('当前拼豆画面已保存为 PNG');}});});
async function loadVideo(file){
 if(!file||state.exporting)return;
 if(!file.type.startsWith('video/')&&!/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)){toast('请选择 MP4、WebM 或 MOV 视频文件。');return;}
 const token=++generation;await play(false);const candidate=document.createElement('video');candidate.preload='auto';candidate.muted=true;const url=URL.createObjectURL(file);toast('正在读取视频…');
 try{await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('视频读取超时，请重试。')),15000);candidate.onloadeddata=()=>{clearTimeout(timeout);resolve();};candidate.onerror=()=>{clearTimeout(timeout);reject(new Error('无法解码视频，请尝试 MP4（H.264）格式。'));};candidate.src=url;});
 if(token!==generation){URL.revokeObjectURL(url);return;}
 if(!Number.isFinite(candidate.duration)){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('无法读取视频时长，请换一个视频重试。')),8000);candidate.onseeked=()=>{clearTimeout(timer);resolve();};candidate.currentTime=1e10;});}
 if(!Number.isFinite(candidate.duration)||candidate.duration<=0)throw new Error('无法读取视频时长，请选择有效视频。');
 if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=url;pendingSeek=null;video.src=url;video.load();await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('视频加载失败'));});
 state.source='video';sourceFile=file;resetThumbnails();state.duration=candidate.duration;state.time=0;video.playbackRate=state.speed;video.muted=state.muted;setUIStatus({hasVideo:true,muted:state.muted});setExportRange(1,frameCount(state.duration,state.fps));$('source-name').textContent=file.name;$('project-name').textContent=file.name;$('source-name').title=file.name;$('source-meta').textContent=`${candidate.videoWidth} × ${candidate.videoHeight} · ${clock(state.duration)}`;updateTicks();updateUI();lastSample=-1;await play(true);toast('视频已就绪，正在用拼豆重新绘制');
 const canvases=overviewCanvases;
 for(let i=0;i<canvases.length;i++){if(token!==generation)break;const time=Math.min(state.duration-.01,state.duration*(i+.5)/canvases.length);await new Promise(resolve=>{const timer=setTimeout(resolve,2500);candidate.onseeked=()=>{clearTimeout(timer);resolve();};candidate.currentTime=time;});if(token!==generation)break;const c=canvases[i],cx=c.getContext('2d');cx.fillStyle='#24262e';cx.fillRect(0,0,160,90);const scale=Math.min(160/candidate.videoWidth,90/candidate.videoHeight);const w=candidate.videoWidth*scale,h=candidate.videoHeight*scale;cx.drawImage(candidate,(160-w)/2,(90-h)/2,w,h);refreshOverview(i);}
 }catch(error){if(url!==sourceUrl)URL.revokeObjectURL(url);if(token===generation)toast(error.message);}finally{candidate.removeAttribute('src');candidate.load();}
}
onUI('upload',()=>$('file').click());$('file').onchange=e=>{loadVideo(e.target.files[0]);e.target.value='';};
['dragenter','dragover'].forEach(event=>$('upload').addEventListener(event,e=>{e.preventDefault();$('upload').classList.add('dragging');}));$('upload').addEventListener('dragleave',()=>$('upload').classList.remove('dragging'));$('upload').addEventListener('drop',e=>{e.preventDefault();$('upload').classList.remove('dragging');loadVideo(e.dataTransfer.files[0]);});
onUI('demo',()=>{generation++;pendingSeek=null;resetThumbnails();video.pause();video.removeAttribute('src');video.load();if(sourceUrl){URL.revokeObjectURL(sourceUrl);sourceUrl=null;}sourceFile=null;state.source='demo';state.duration=12;state.time=0;setUIStatus({hasVideo:false});setExportRange(1,frameCount(state.duration,state.fps));$('source-name').textContent='落日漫游';$('project-name').textContent='落日漫游';$('source-meta').textContent='内置演示 · 12 秒循环';lastSample=-1;demoThumbnails();updateTicks();play(true);});
function lockExport(locked){state.exporting=locked;controls.enabled=!locked;$('seek').disabled=locked;$('file').disabled=locked;setUIStatus({locked});}
onUI('export',async()=>{
 if(state.exporting){setUIStatus({exportCancelling:true});exportController?.abort();return;}
 const range=frameRange(state.rangeStart,state.rangeEnd,state.duration,state.fps);
 exportController=new AbortController();const signal=exportController.signal;
 let exportInfo={start:range.start,end:range.end,count:range.count,seconds:range.duration,fps:state.fps,width:null,height:null,format:null,hasAudio:sourceFile&&state.includeAudio?null:false};
 setUIStatus({exportVisible:true,exportSession:Date.now(),exportOutcome:null,exportError:null,exportCancelling:false,exportInfo,progress:0,exportPhase:'prepare',exportDone:0,exportTotal:range.count});
 lockExport(true);await play(false);
 let virtualTime=0;
 const previewSize=renderer.getSize(new THREE.Vector2()),previewPixelRatio=renderer.getPixelRatio();
 try{
   const {exportFrameSequence}=await import('./export-video.js');signal.throwIfAborted();
   const outputCanvas=document.createElement('canvas');
   const scale=Math.min(1,1920/renderer.domElement.width,1080/renderer.domElement.height);
   const preset={'1080p':[1920,1080],'2k':[2560,1440],'4k':[3840,2160]}[state.exportResolution];
   outputCanvas.width=preset?.[0]??Math.max(2,Math.floor(renderer.domElement.width*scale/2)*2);
   outputCanvas.height=preset?.[1]??Math.max(2,Math.floor(renderer.domElement.height*scale/2)*2);
   exportInfo={...exportInfo,width:outputCanvas.width,height:outputCanvas.height};setUIStatus({exportInfo});
   const exportCamera=camera.clone();
   exportCamera.aspect=outputCanvas.width/outputCanvas.height;
   // Preserve the visible composition when fitting the preview into 16:9.
   if(exportCamera.aspect<camera.aspect)exportCamera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect/exportCamera.aspect));
   exportCamera.updateProjectionMatrix();
   renderer.setPixelRatio(1);
   renderer.setSize(outputCanvas.width,outputCanvas.height,false);
   const outputContext=outputCanvas.getContext('2d',{alpha:false});
   beadMotion.duration=Math.min(.19,.7/state.fps);
   const advanceMotion=until=>{while(virtualTime<until-1e-8){virtualTime=Math.min(until,virtualTime+1/120);beadMotion.update(virtualTime);}};
   const result=await exportFrameSequence({file:sourceFile,range,fps:state.fps,canvas:outputCanvas,includeAudio:state.includeAudio,signal,
     onReady:({format,hasAudio})=>{exportInfo={...exportInfo,format,hasAudio};setUIStatus({exportInfo,exportPhase:'video'});},
     renderFrame:({image,index,time})=>{
       if(index>0)advanceMotion(index/state.fps);
       if(image){sourceCtx.drawImage(image,0,0,640,360);}else{demoDraw(time);}
       sampleBeads(false);
       if(index===0||!state.motion){beadMotion.settle();}else{beadMotion.update(virtualTime);advanceMotion((index+.5)/state.fps);}
       renderer.render(scene,exportCamera);outputContext.drawImage(renderer.domElement,0,0);
     },
     onProgress:({phase,done,total,progress})=>setUIStatus({exportPhase:phase,exportDone:done,exportTotal:total,progress}),
   });
   signal.throwIfAborted();download(result.blob,`BeanMotion-${range.start}-${range.end}帧${result.extension}`);
   setUIStatus({exportOutcome:'done',progress:1});
   toast(`已导出 ${range.count} 帧${result.hasAudio?'，包含原片声音':''}`);
 }catch(error){setUIStatus({exportOutcome:signal.aborted?'cancelled':'error',exportError:error.message||'导出失败，请重试。'});toast(signal.aborted?'已取消导出，未生成文件':error.message||'导出失败，请重试。');}
 finally{
   renderer.setPixelRatio(previewPixelRatio);renderer.setSize(previewSize.x,previewSize.y,false);
   lockExport(false);exportController=null;lastTime=performance.now();lastSample=-1;
   resizePreview();paintFrame();beadMotion.settle();updateUI();renderer.render(scene,camera);
 }
});
