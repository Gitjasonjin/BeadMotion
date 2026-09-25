import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Input, ALL_FORMATS, BufferSource } from 'mediabunny';

await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1120,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  // Export must work with recording APIs entirely unavailable.
  window.MediaRecorder=undefined;
  HTMLCanvasElement.prototype.captureStream=()=>{throw Error('Recording is forbidden in this test');};
  const original=HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play=function(){window.__previewVideo=this;return original.call(this);};
});
try{
  await page.goto('http://localhost:5173');
  await page.locator('#play').click();
  // This export fixture intentionally exercises the optional 24 FPS mode.
  await page.locator('#fps').click();
  await page.getByRole('option',{name:'24 FPS',exact:true}).click();
  await expect(page.locator('.brand strong')).toHaveText('BeanMotion');
  await expect(page.locator('.panel-title #view')).toBeVisible();
  assert.equal(await page.locator('.timeline .export-audio').count(),0);
  await expect(page.locator('.settings .export-audio')).toHaveText('保留原声');
  await expect(page.locator('#range-start')).toHaveAttribute('aria-valuenow','1');
  await expect(page.locator('#range-end')).toHaveAttribute('aria-valuenow','288');
  const track=await page.locator('#filmstrip').boundingBox();
  async function dragCursor(edge,delta){
    const cursor=await page.locator('#range-'+edge).boundingBox();
    await page.mouse.move(cursor.x+cursor.width/2,cursor.y+cursor.height/2);
    await page.mouse.down();await page.mouse.move(cursor.x+cursor.width/2+delta,cursor.y+cursor.height/2,{steps:10});await page.mouse.up();
  }
  await dragCursor('start',track.width/4);
  await expect(page.locator('#range-start')).toHaveAttribute('aria-valuenow','73');
  await dragCursor('end',-track.width/4);
  await expect(page.locator('#range-end')).toHaveAttribute('aria-valuenow','216');
  await page.locator('#range-start').press('End');
  await page.locator('#range-start').press('ArrowRight');
  await expect(page.locator('#range-start')).toHaveAttribute('aria-valuenow','216');
  await expect(page.locator('#range-end')).toHaveAttribute('aria-valuenow','216');
  await page.locator('#range-all').click();
  await expect(page.locator('#range-summary')).toContainText('共 288 帧');
  await page.screenshot({path:'test-results/beanmotion-desktop.png',fullPage:true});
  const fixture=await page.evaluate(async()=>{
    const {Output,WebMOutputFormat,BufferTarget,CanvasSource,AudioSampleSource,AudioSample,Quality}=await import('/node_modules/mediabunny/dist/modules/src/index.js');
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
    const context=canvas.getContext('2d');
    const output=new Output({format:new WebMOutputFormat(),target:new BufferTarget()});
    const video=new CanvasSource(canvas,{codec:'vp9',quality:new Quality('high')});
    const audio=new AudioSampleSource({codec:'opus',quality:new Quality({bitrate:128000})});
    output.addVideoTrack(video,{frameRate:24});output.addAudioTrack(audio);await output.start();
    for(let i=0;i<72;i++){
      context.fillStyle=i<24?'#e04020':i<48?'#20b060':'#3050e0';context.fillRect(0,0,160,90);
      context.fillStyle='white';context.fillRect((i%24)*5,30,10,20);await video.add(i/24,1/24);
    }
    video.close();
    const samples=new Float32Array(48000*3);
    for(let i=0;i<samples.length;i++){const t=i/48000;const hz=t<1?220:t<2?880:440;samples[i]=.2*Math.sin(2*Math.PI*hz*t);}
    const sample=new AudioSample({data:samples,format:'f32',sampleRate:48000,numberOfChannels:1,timestamp:0});
    await audio.add(sample);sample.close();audio.close();await output.finalize();
    return Array.from(new Uint8Array(output.target.buffer));
  });
  await writeFile('test-results/audio-fixture.webm',Buffer.from(fixture));
  await page.locator('#file').setInputFiles('test-results/audio-fixture.webm');
  await expect(page.locator('#source-name')).toHaveText('audio-fixture.webm');
  await expect(page.locator('#sound')).toBeEnabled();
  await page.locator('#sound').click();
  assert.equal(await page.evaluate(()=>window.__previewVideo.muted),false,'Preview can play source audio');
  await page.locator('#sound').click();
  assert.equal(await page.evaluate(()=>window.__previewVideo.muted),true,'Preview can be muted again');
  await page.locator('#play').click();
  await page.locator('#palette [data-value="original"]').click();
  // A seek must display its decoded image in both the active thumbnail and
  // the bead board. Rapid seeks must not publish an earlier request's image.
  async function seekTo(time){await page.locator('#seek').evaluate((node,t)=>{node.value=t;node.dispatchEvent(new Event('input',{bubbles:true}));},time);}
  async function verifyCurrentColor(channel){
    await page.waitForFunction(channel=>{
      const canvas=document.querySelector('[data-frame][data-current]');
      if(!canvas)return false;const p=canvas.getContext('2d').getImageData(3,3,1,1).data;
      return p[channel]>Math.max(p[(channel+1)%3],p[(channel+2)%3])*1.5;
    },channel);
    const pixels=await page.evaluate(async channel=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const live=document.querySelector('[data-current]');
      const thumb=live.getContext('2d').getImageData(3,3,1,1).data;
      const source=document.querySelector('#source-thumb').getContext('2d').getImageData(3,3,1,1).data;
      const stage=document.querySelector('#stage canvas'),copy=document.createElement('canvas');copy.width=stage.width;copy.height=stage.height;
      const ctx=copy.getContext('2d');ctx.drawImage(stage,0,0);const data=ctx.getImageData(0,0,copy.width,copy.height).data;
      let correct=0,stale=0;
      for(let i=0;i<data.length;i+=4){for(let c=0;c<3;c++)if(data[i+c]>Math.max(data[i+(c+1)%3],data[i+(c+2)%3])*1.5&&data[i+c]>60){if(c===channel)correct++;else stale++;}}
      return {correct,stale,thumb:Array.from(thumb),source:Array.from(source)};
    },channel);
    assert.deepEqual(pixels.thumb,pixels.source,'Live timeline and source preview use the same decoded image');
    assert.ok(pixels.correct>1000&&pixels.stale<1000,'Paused beads immediately match decoded frame: '+JSON.stringify(pixels));
  }
  await seekTo(.25);await verifyCurrentColor(0);
  await page.locator('#seek').evaluate(node=>{for(const t of [2.25,.25,1.25]){node.value=t;node.dispatchEvent(new Event('input',{bubbles:true}));}});
  await verifyCurrentColor(1);
  await seekTo(.96);await verifyCurrentColor(0);
  await page.locator('#next').click();await verifyCurrentColor(1);
  await page.locator('#prev').click();await verifyCurrentColor(0);
  await seekTo(2.25);await verifyCurrentColor(2);
  await page.locator('#fps').click();await page.getByRole('option',{name:'12 FPS',exact:true}).click();
  await seekTo(.92);await verifyCurrentColor(0);
  await page.locator('#next').click();await verifyCurrentColor(1);
  await page.locator('#prev').click();await verifyCurrentColor(0);
  await seekTo(2.25);await verifyCurrentColor(2);
  await page.screenshot({path:'test-results/synchronized-preview.png',fullPage:true});
  await page.locator('#fps').click();await page.getByRole('option',{name:'24 FPS',exact:true}).click();
  console.log('PASS: decoded seeking, rapid seek replacement, next/previous frame, settled bead colors and live timeline thumbnail agree.');
  await page.locator('#range-start').press('Home');
  for(let i=0;i<24;i++)await page.locator('#range-start').press('ArrowRight');
  await page.locator('#range-end').press('Home');
  for(let i=0;i<23;i++)await page.locator('#range-end').press('ArrowRight');
  await expect(page.locator('#range-summary')).toContainText('共 24 帧 · 1.00 秒');
  const savedTime=await page.locator('#seek').inputValue();
  const downloadPromise=page.waitForEvent('download',{timeout:60000});
  await page.locator('#export').click();
  await expect(page.locator('#fps')).toBeDisabled();
  await expect(page.locator('#range-start')).toBeDisabled();
  await expect(page.locator('#range-end')).toBeDisabled();
  const download=await downloadPromise;
  const path=`test-results/trimmed-audio${download.suggestedFilename().endsWith('.mp4')?'.mp4':'.webm'}`;
  await download.saveAs(path);
  const bytes=await readFile(path);
  const input=new Input({source:new BufferSource(bytes),formats:ALL_FORMATS});
  const video=await input.getPrimaryVideoTrack(), audio=await input.getPrimaryAudioTrack();
  const stats=await video.computePacketStats();
  assert.equal(stats.packetCount,24);assert.ok(Math.abs(stats.averagePacketRate-24)<.01);
  assert.ok(Math.abs(await video.computeDuration()-1)<.002);
  assert.ok(audio,'Original audio is exported even when preview is muted');
  assert.ok(Math.abs(await audio.computeDuration()-1)<.05,'Audio is trimmed to selected duration');
  input.dispose();
  const decoded=await page.evaluate(async data=>{
    const {Input,ALL_FORMATS,BufferSource,AudioSampleSink,CanvasSink}=await import('/node_modules/mediabunny/dist/modules/src/index.js');
    const input=new Input({source:new BufferSource(new Uint8Array(data)),formats:ALL_FORMATS});
    const audio=await input.getPrimaryAudioTrack();
    const sample=await new AudioSampleSink(audio).getSample(.5);
    const floats=new Float32Array(sample.numberOfFrames);
    sample.copyTo(floats,{planeIndex:0,format:'f32-planar'});
    let crossings=0;for(let i=1;i<floats.length;i++)if(floats[i-1]<0&&floats[i]>=0)crossings++;
    const frequency=crossings/sample.duration;sample.close();
    const video=await input.getPrimaryVideoTrack();
    const frame=await new CanvasSink(video).getCanvas(.5);
    const pixels=frame.canvas.getContext('2d').getImageData(0,0,frame.canvas.width,frame.canvas.height).data;
    let green=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>pixels[i]*1.04&&pixels[i+1]>pixels[i+2]*1.04)green++;
    input.dispose();return {frequency,green};
  },Array.from(bytes));
  assert.ok(decoded.frequency>800&&decoded.frequency<960,`Expected middle 880 Hz segment, got ${decoded.frequency}`);
  assert.ok(decoded.green>1000,'Export contains the selected middle video segment');
  await expect(page.locator('#fps')).toBeEnabled();
  assert.equal(await page.locator('#seek').inputValue(),savedTime,'Export restores preview position');
  console.log('PASS: preview mute, offline export without recording APIs, exactly 24 frames at 24 FPS, 1 s trimmed audio/video, correct middle-segment content.');

  // Cancellation must not download a partial file, and a later export works.
  await page.locator('#demo').click();
  let downloads=0;page.on('download',()=>downloads++);
  await page.locator('#export').click();
  await expect(page.locator('#export')).toContainText('取消导出');
  await page.waitForFunction(()=>document.querySelector('.export-progress')?.value>0);
  await page.locator('#export').click();
  await expect(page.locator('#export')).toHaveText('导出所选帧',{timeout:10000});
  await expect(page.locator('#toast')).toContainText('已取消');assert.equal(downloads,0);
  await page.locator('#range-start').press('End');
  await expect(page.locator('#range-summary')).toContainText('共 1 帧');
  const singlePromise=page.waitForEvent('download',{timeout:30000});await page.locator('#export').click();
  const single=await singlePromise;const singlePath='test-results/last-frame.mp4';await single.saveAs(singlePath);
  const one=new Input({source:new BufferSource(await readFile(singlePath)),formats:ALL_FORMATS});
  assert.equal((await (await one.getPrimaryVideoTrack()).computePacketStats()).packetCount,1);
  assert.equal(await one.getPrimaryAudioTrack(),null);one.dispose();
  assert.equal(await page.locator('footer.status-bar').count(),0);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
  await page.locator('#range-all').click();
  const mobileTrack=await page.locator('#filmstrip').boundingBox(),mobileCursor=await page.locator('#range-start').boundingBox();
  const touch=await page.context().newCDPSession(page);
  const x=mobileCursor.x+mobileCursor.width/2,y=mobileCursor.y+mobileCursor.height/2;
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+mobileTrack.width/4,y}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('#range-start')).toHaveAttribute('aria-valuenow','73');
  await touch.detach();
  await page.locator('#range-all').click();
  await page.screenshot({path:'test-results/export-mobile.png',fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  const title=await page.locator('.panel-title h1').boundingBox(),view=await page.locator('#view').boundingBox();
  assert.ok(view.x>title.x+title.width&&Math.abs(view.y+view.height/2-title.y-title.height/2)<2,'View group shares settings title row');
  const mobileBrand=await page.locator('.brand').boundingBox(),actions=await page.locator('.header-actions').boundingBox();
  assert.ok(mobileBrand.x+mobileBrand.width<actions.x,'Mobile header does not overlap');
  assert.deepEqual(errors,[]);
  console.log('PASS: cancel without partial download, final inclusive single-frame export, silent demo, removed footer, mobile layout.');
}finally{await browser.close();}
