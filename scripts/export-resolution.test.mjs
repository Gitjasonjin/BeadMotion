import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { Input, ALL_FORMATS, BufferSource } from 'mediabunny';

await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1120,height:800},deviceScaleFactor:1.5});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.__renderSizes=new Set();
    const draw=WebGL2RenderingContext.prototype.drawElementsInstanced;
    WebGL2RenderingContext.prototype.drawElementsInstanced=function(...args){
      if(!this.getParameter(this.FRAMEBUFFER_BINDING))window.__renderSizes.add(`${this.drawingBufferWidth}x${this.drawingBufferHeight}`);
      return draw.apply(this,args);
    };
  });
  await page.goto('http://localhost:5173');
  await page.locator('#play').click();
  await page.locator('#range-end').press('Home');
  await page.locator('#range-end').press('ArrowRight');
  const original=await page.locator('#stage canvas').evaluate(c=>[c.width,c.height]);
  for(const [label,width,height] of [['1080p',1920,1080],['2K',2560,1440],['4K',3840,2160]]){
    await page.locator('#export-resolution').click();
    await page.getByRole('option',{name:`${label} · ${width} × ${height}`,exact:true}).click();
    const finished=page.waitForEvent('download',{timeout:90000});
    await page.locator('#export').click();
    await expect(page.locator('#export-resolution')).toBeDisabled();
    const download=await finished;
    const path=`test-results/${label}-${download.suggestedFilename()}`;
    await download.saveAs(path);
    const input=new Input({source:new BufferSource(await readFile(path)),formats:ALL_FORMATS});
    const track=await input.getPrimaryVideoTrack();
    assert.equal(track.displayWidth,width);assert.equal(track.displayHeight,height);
    const stats=await track.computePacketStats();assert.equal(stats.packetCount,2);
    assert.ok(Math.abs(stats.averagePacketRate-12)<.01);input.dispose();
    assert.ok(await page.evaluate(size=>window.__renderSizes.has(size),`${width}x${height}`),'Actual WebGL render uses requested resolution');
    await expect(page.locator('#export-resolution')).toBeEnabled();
    assert.deepEqual(await page.locator('#stage canvas').evaluate(c=>[c.width,c.height]),original,'Preview pixels and device ratio restored');
    console.log(`PASS: ${label} actual render and encoded dimensions ${width}x${height}, 12 FPS, preview restored.`);
  }
  await page.locator('#range-all').click();
  await page.locator('#export').click();
  await page.waitForFunction(()=>document.querySelector('.export-progress')?.value>0);
  await page.locator('#export').click();
  await expect(page.locator('#export-resolution')).toBeEnabled();
  assert.deepEqual(await page.locator('#stage canvas').evaluate(c=>[c.width,c.height]),original,'Cancelled 4K export restores preview');
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
