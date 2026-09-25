import React, { useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ThemeProvider } from '@appica/ui-react/providers/theme-provider';
import { Button } from '@appica/ui-react/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@appica/ui-react/select';
import { Slider } from '@appica/ui-react/slider';
import { Switch } from '@appica/ui-react/switch';
import { Checkbox } from '@appica/ui-react/checkbox';
import { ToggleGroup } from '@appica/ui-react/toggle-group';
import { Toggle } from '@appica/ui-react/toggle';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@appica/ui-react/tooltip';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter, DialogClose } from '@appica/ui-react/dialog';
import { Upload, Download, Play, Pause, SkipBack, SkipForward, RotateCcw, Maximize, Grid2x2, Box, Image, CircleHelp, Film, LockKeyhole, VolumeX, Volume2, X } from 'lucide-react';
import ThoughtLine from './components/ThoughtLine.jsx';

// Rendering stays outside React. Only UI actions and playback/export status
// cross this boundary; GPU frames never cause a React rerender.
const handlers = new Map();
export const onUI = (name, handler) => handlers.set(name, handler);
const emit = (name, value) => handlers.get(name)?.(value);
let status = { locked:false, playing:true, muted:true, hasVideo:false, rangeStart:1, rangeEnd:144, totalFrames:144, fps:12, duration:12, includeAudio:true, progress:0, exportPhase:'video', exportDone:0, exportTotal:0 };
const listeners = new Set();
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export function setUIStatus(patch) { status={...status,...patch};listeners.forEach(fn=>fn()); }
const useStatus = () => useSyncExternalStore(subscribe,()=>status);

function Action({ id, children, label, lockable=false, ...props }) {
  const {locked}=useStatus();
  const button=<Button id={id} type="button" size="sm" variant="ghost" disabled={lockable&&locked} aria-label={label} onClick={()=>emit(id)} {...props}>{children}</Button>;
  return label ? <Tooltip><TooltipTrigger render={button}/><TooltipContent>{label}</TooltipContent></Tooltip> : button;
}
function Choice({ id, label, initial, options }) {
  const [value,setValue]=useState(initial);const {locked}=useStatus();
  return <Select size="sm" value={value} items={options} disabled={locked} alignItemWithTrigger={false} onValueChange={v=>{if(v!==null){setValue(v);emit(id,v);}}}>
    <SelectTrigger id={id} aria-label={label} className="choice-trigger"><SelectValue/></SelectTrigger>
    <SelectContent className="choice-menu">{Object.entries(options).map(([value,text])=><SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent>
  </Select>;
}
function Range({id,label,initial,min,max,step}) {
  const [value,setValue]=useState(initial);const {locked}=useStatus();
  return <Slider id={id} className="setting-slider" value={value} min={min} max={max} step={step} disabled={locked} thumbAriaLabel={label} tooltipVisibility="never" onValueChange={v=>{const next=Array.isArray(v)?v[0]:v;setValue(next);emit(id,next);}}/>;
}
function SwitchRow({id,label,description}) {
  const [checked,setChecked]=useState(true);const {locked}=useStatus();
  return <div className="switch-row"><div><label htmlFor={id}>{label}</label><small id={`${id}-description`}>{description}</small></div><Switch id={id} aria-describedby={`${id}-description`} size="sm" checked={checked} disabled={locked} onCheckedChange={v=>{setChecked(v);emit(id,v);}}/></div>;
}
function Segment({id,label,initial,options}) {
  const [value,setValue]=useState([initial]);const {locked}=useStatus();
  return <ToggleGroup id={id} aria-label={label} className="control-segment" value={value} disabled={locked} onValueChange={next=>{if(next.length){setValue(next);emit(id,next[0]);}}}>
    {options.map(({value,label,Icon})=><Toggle key={value} value={value} data-value={value}>{Icon&&<Icon size={14}/>} {label}</Toggle>)}
  </ToggleGroup>;
}
function PlaybackButton(){const {playing}=useStatus();return <Action id="play" className="play-button" label={playing?'暂停（空格）':'播放（空格）'} lockable>{playing?<Pause/>:<Play/>}</Action>;}
function ExportButton(){const {locked,progress}=useStatus();return <Action id="export" variant="primary" className="export-button">{locked?<X/>:<Download/>}{locked?`取消导出 ${Math.floor(progress*100)}%`:'导出所选帧'}</Action>;}
function SoundButton(){const {muted,hasVideo,locked}=useStatus();return <Action id="sound" className="sound-button" label={!hasVideo?'内置演示无音轨':muted?'开启预览声音':'关闭预览声音'} aria-pressed={hasVideo&&!muted} disabled={!hasVideo||locked} lockable>{muted||!hasVideo?<VolumeX/>:<Volume2/>}<span>{!hasVideo?'无音轨':muted?'已静音':'声音开启'}</span></Action>;}
function RangeCursor({edge}){
  const {locked,rangeStart,rangeEnd,totalFrames,fps,duration}=useStatus();
  const drag=useRef(null);
  const start=edge==='start',value=start?rangeStart:rangeEnd;
  const min=start?1:rangeStart,max=start?rangeEnd:totalFrames;
  const position=Math.min(duration,(start?value-1:value)/fps)/duration;
  const label=start?'开始帧':'结束帧';
  const change=next=>emit(`range-${edge}`,Math.max(min,Math.min(max,next)));
  const finish=e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);};
  return <button type="button" id={`range-${edge}`} className={`range-cursor range-cursor-${edge}`} role="slider" aria-label={label} aria-orientation="horizontal" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`第 ${value} 帧`} aria-describedby="range-instruction" disabled={locked} style={{left:`${position*100}%`}}
    onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);const track=e.currentTarget.parentElement.getBoundingClientRect();drag.current={x:e.clientX,value,width:track.width};}}
    onPointerMove={e=>{if(!drag.current)return;const {x,value,width}=drag.current;change(value+Math.round((e.clientX-x)/width*duration*fps));}}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={()=>{drag.current=null;}}
    onKeyDown={e=>{const moves={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1,PageDown:-10,PageUp:10};if(e.key==='Home'||e.key==='End'||e.key in moves){e.preventDefault();change(e.key==='Home'?min:e.key==='End'?max:value+moves[e.key]);}}}>
    <span className="cursor-grip" aria-hidden="true"/><span className="cursor-label" style={position<.5?{left:0}:{right:0}}>{label} {value}</span>
  </button>;
}
function ExportAudio(){const {locked,includeAudio,hasVideo}=useStatus();return <label className="export-audio"><Checkbox id="include-audio" checked={includeAudio&&hasVideo} disabled={locked||!hasVideo} onCheckedChange={v=>emit('include-audio',v)}/>保留原声</label>;}
function ExportOverlay(){
  const {locked,exportVisible,exportSession,exportOutcome,exportInfo,exportError,exportCancelling,exportPhase,exportDone,exportTotal,progress}=useStatus();
  if(!exportVisible||!exportInfo)return null;
  const {fps,width,height,format,hasAudio}=exportInfo;
  const phaseLabel={prepare:'正在准备导出',video:'正在生成拼豆视频',audio:'正在处理原片声音',finalize:'正在封装视频'}[exportPhase];
  const steps=['准备所选帧与编码器'];
  if(exportPhase!=='prepare')steps.push(`逐帧渲染与编码 · ${exportDone} / ${exportTotal} 帧`);
  if(exportPhase==='audio'||(exportPhase==='finalize'&&hasAudio))steps.push('裁切并同步原片声音');
  if(exportPhase==='finalize')steps.push(`封装 ${format||'视频'} 文件`);
  const doneLabel=exportOutcome==='done'?'导出完成，用时':exportOutcome==='cancelled'?'已取消，用时':'导出失败，用时';
  return <div className="stage-export-overlay" id="export-overlay">
    <section className="stage-export-card" aria-label="视频导出状态" aria-busy={locked}>
      <ThoughtLine key={exportSession} working={locked} label={exportCancelling?'正在取消导出':phaseLabel} doneLabel={doneLabel} glyph="dot" fontSize={16} steps={!locked&&exportOutcome!=='done'?[]:steps} collapsible collapseOnSettle showTimer color="var(--foreground)" glyphColor="var(--primary)"/>
      <p className="export-job-format">{width?`${width} × ${height}`:'正在确认分辨率'} · {fps} FPS{format?` · ${format}`:''} · {hasAudio===null?'检测原片音轨':hasAudio?'保留原声':'无声视频'}</p>
      {locked?<><div className="export-job-progress"><progress aria-label="视频导出进度" value={progress} max="1"/><span>{Math.floor(progress*100)}%</span></div><div className="export-job-footer"><span>正在本地处理</span><Button id="cancel-export" size="sm" variant="ghost" disabled={exportCancelling} onClick={()=>emit('export')}>{exportCancelling?'正在取消…':'取消导出'}</Button></div></>:<div className="export-job-result"><p role="status">{exportOutcome==='done'?'视频已生成，下载已开始。':exportOutcome==='cancelled'?'已停止处理，未生成视频文件。':exportError||'导出未完成，请重试。'}</p><Button id="dismiss-export" size="sm" variant="outline" onClick={()=>setUIStatus({exportVisible:false})}>关闭</Button></div>}
    </section>
  </div>;
}
function ExportRange(){
  const {locked,rangeStart,rangeEnd,fps,duration,progress,exportPhase,exportDone,exportTotal}=useStatus();
  const seconds=Math.max(0,Math.min(duration,rangeEnd/fps)-(rangeStart-1)/fps);
  return <div className="export-range">
    <div className="range-fields"><span id="range-instruction">拖动两端游标选择导出范围</span><Action id="range-all" lockable>全部帧</Action></div>
    <div className="range-summary"><span id="range-summary">第 {rangeStart}–{rangeEnd} 帧 · 共 {rangeEnd-rangeStart+1} 帧 · {seconds.toFixed(2)} 秒</span><span>{locked?(exportPhase==='audio'?'正在编码音轨':exportPhase==='finalize'?'正在封装视频':`正在编码 ${exportDone} / ${exportTotal} 帧`):'包含起止帧'}</span></div>
    {locked&&<progress className="export-progress" aria-label="导出进度" value={progress} max="1"/>}
  </div>;
}
function Help(){return <Dialog><DialogTrigger id="help" render={<Button variant="ghost" size="icon-sm" aria-label="使用指南"/>}><CircleHelp/></DialogTrigger>
  <DialogContent id="help-dialog" className="help-dialog" frame={false} closeLabel="关闭指南">
    <DialogHeader className="help-header"><DialogTitle>使用指南</DialogTitle><DialogDescription>将本地视频转换为拼豆动画。</DialogDescription></DialogHeader>
    <DialogBody className="help-body">
      <ol className="help-steps">
        <li><strong>导入素材</strong><p>选择或拖入 MP4、WebM、MOV 视频。素材只在本地处理。</p></li>
        <li><strong>调整拼豆</strong><p>设置密度、色板、豆子高度和帧率。滚轮缩放，拖拽旋转，右键平移；点击“重置视角”恢复居中视角。</p></li>
        <li><strong>预览与导出</strong><p>预览时可开启原片声音。游标所在的缩略图实时显示当前帧，其余缩略图为整段视频的概览；暂停或拖动后，拼豆画面会直接对齐当前帧。拖动帧序列两端的游标选择开始帧和结束帧，默认包含全部帧，再点击“导出所选帧”；起止帧均包含在内。视频会逐帧编码，优先保存为 MP4，也可在右侧选择保留原声。预览静音不影响导出音轨。</p></li>
      </ol>
      <div className="help-shortcuts" aria-label="键盘快捷键"><span>播放 / 暂停</span><kbd>Space</kbd><span>逐帧查看</span><span className="key-pair"><kbd>←</kbd><kbd>→</kbd></span></div>
    </DialogBody>
    <DialogFooter className="help-footer"><DialogClose render={<Button size="sm"/>}>知道了</DialogClose></DialogFooter>
  </DialogContent></Dialog>;}

function Editor(){return <div className="app-shell">
  <header className="app-header"><div className="brand"><span className="brandmark" aria-hidden="true">{Array.from({length:9},(_,i)=><b key={i}/>)}</span><strong>BeanMotion</strong></div><span className="header-divider"/><span className="project-name" id="project-name">落日漫游</span><span className="project-type">拼豆视频</span><div className="header-actions"><Help/><Action id="snapshot" variant="outline" lockable><Image/>保存当前帧</Action><ExportButton/></div></header>
  <main className="workspace">
    <section className="editor" aria-label="拼豆画板">
      <div className="preview-toolbar"><span className="preview-title">画板预览</span><div className="toolbar-actions"><span id="bead-count">2,304 颗拼豆</span><span className="toolbar-separator"/><Action id="reset-view" label="重置视角" size="icon-sm" lockable><RotateCcw/></Action><Action id="fullscreen" label="全屏预览" size="icon-sm" lockable><Maximize/></Action></div></div>
      <div id="stage"><span className="canvas-meta"><span id="resolution">64 × 36</span><span>拼豆板</span></span><div className="stage-bottom"><span id="view-hint">拖拽旋转 · 滚轮缩放 · 右键平移</span><span id="stage-fps">12 FPS</span></div><ExportOverlay/></div>
      <div className="transport"><div className="transport-controls"><Action id="prev" label="上一帧（←）" size="icon-sm" lockable><SkipBack/></Action><PlaybackButton/><Action id="next" label="下一帧（→）" size="icon-sm" lockable><SkipForward/></Action><span className="time"><b id="current-time">00:00</b><span>/</span><span id="duration">00:12</span></span><span id="current-frame">第 1 帧</span></div><div className="transport-right"><SoundButton/><Choice id="speed" label="播放速度" initial="1" options={{'0.5':'0.5×','1':'1×','1.5':'1.5×','2':'2×'}}/></div></div>
      <div className="timeline"><div className="timeline-heading"><span><Film/>帧序列</span><span id="frame-count">144 帧 · 12 帧 / 秒</span></div><div className="filmstrip" id="filmstrip">{Array.from({length:8},(_,i)=><canvas key={i} width="160" height="90" data-frame={i}/>)}<div className="range-dim range-dim-before" id="range-before"/><div className="range-dim range-dim-after" id="range-after"/><div className="range-highlight" id="range-highlight"/><RangeCursor edge="start"/><RangeCursor edge="end"/><span id="current-thumb-label" aria-hidden="true">当前帧</span><div id="playhead"><span/></div><input id="seek" type="range" min="0" max="12" defaultValue="0" step="0.001" aria-label="视频时间轴"/></div><div className="timeline-ticks" id="ticks"/><ExportRange/></div>
    </section>
    <aside className="settings" aria-label="视频与拼豆设置"><div className="panel-title"><h1>画板设置</h1><Segment id="view" label="画板视角" initial="3d" options={[{value:'front',label:'正面',Icon:Grid2x2},{value:'3d',label:'立体',Icon:Box}]}/></div><div className="settings-scroll">
      <section className="setting-section"><h2>视频素材</h2><Action id="upload" className="drop-zone" variant="outline" lockable><Upload/><span>导入视频<small>MP4、WebM 或 MOV</small></span></Action><input type="file" id="file" accept="video/*,.mov" hidden/><div className="source-card"><canvas id="source-thumb" width="96" height="64"/><div><strong id="source-name">落日漫游</strong><span id="source-meta">内置演示 · 12 秒循环</span></div><Action id="demo" label="恢复演示素材" size="icon-sm" lockable><RotateCcw/></Action></div></section>
      <section className="setting-section"><h2>拼豆</h2><div className="field-heading"><label id="density-label">画面密度</label><output id="density-value">64 × 36</output></div><Range id="density" label="画面密度" initial={0} min={0} max={3} step={1}/><div className="range-labels"><span>颗粒更大</span><span>画面更细</span></div>
        <div className="field-grid"><div><label>采样帧率</label><Choice id="fps" label="采样帧率" initial="12" options={{'6':'6 FPS · 定格','12':'12 FPS','24':'24 FPS','30':'30 FPS'}}/></div><div><label>豆子间距</label><Choice id="spacing" label="豆子间距" initial="0.9" options={{'0.9':'紧密','0.82':'适中','0.68':'疏朗'}}/></div></div>
        <div className="field-heading"><label>色彩</label><span id="palette-note">全彩</span></div><Segment id="palette" label="色彩模式" initial="original" options={[{value:'original',label:'原片色彩'},{value:'beads',label:'拼豆色板'}]}/><div className="swatches" aria-label="拼豆色板示例">{['#f7edda','#efba66','#dd7953','#c45447','#bb7b88','#80688f','#527783','#375461','#546945','#24312e'].map(c=><span key={c} style={{backgroundColor:c}}/>)}</div>
      </section>
      <section className="setting-section"><h2>质感与动作</h2><div className="field-heading"><label>豆子高度</label><output id="height-value">标准长筒</output></div><Range id="height" label="豆子高度" initial={1} min={.7} max={1.7} step={.1}/><div className="range-labels"><span>矮筒</span><span>加高</span></div><SwitchRow id="texture" label="塑料质感" description="反光、孔壁与接触阴影"/><SwitchRow id="motion" label="逐颗换豆" description="提起旧豆，再放入新豆"/></section>
    <section className="setting-section export-settings"><h2>导出</h2><div className="export-resolution-field"><label htmlFor="export-resolution">分辨率</label><Choice id="export-resolution" label="导出分辨率" initial="preview" options={{preview:'跟随画板','1080p':'1080p · 1920 × 1080','2k':'2K · 2560 × 1440','4k':'4K · 3840 × 2160'}}/></div><ExportAudio/><p>按选定帧范围导出。1080p、2K 和 4K 均为 16:9。</p></section></div><div className="local-note"><LockKeyhole/>素材只在本地处理</div></aside>
  </main><div id="toast" role="status"/>
</div>;}

export function mountUI(){flushSync(()=>createRoot(document.getElementById('app')).render(<ThemeProvider forcedTheme="light"><TooltipProvider><Editor/></TooltipProvider></ThemeProvider>));}
