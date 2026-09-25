import {
  Input, ALL_FORMATS, BlobSource, CanvasSink, AudioSampleSink,
  Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat,
  CanvasSource, AudioSampleSource, Quality, canEncodeVideo, canEncodeAudio,
} from 'mediabunny';

// This pipeline never plays a video or captures a stream. Each decoded frame
// receives an explicit output timestamp, independent of processing speed.
export async function exportFrameSequence({file,range,fps,canvas,includeAudio,renderFrame,signal,onProgress,onReady=()=>{}}) {
  let input, output, videoSource, audioSource, iterator;
  let finalized=false;
  const check=()=>signal.throwIfAborted();
  try {
    check();
    let videoTrack, audioTrack;
    if(file){
      input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});
      videoTrack=await input.getPrimaryVideoTrack();
      if(!videoTrack||!await videoTrack.canDecode())throw new Error('浏览器无法逐帧解码此视频，请转换为 H.264 MP4 或 VP9 WebM 后重试。');
      if(includeAudio){
        audioTrack=await input.getPrimaryAudioTrack();
        if(audioTrack&&!await audioTrack.canDecode())throw new Error('浏览器无法解码原片音轨，可关闭“保留原声”后导出。');
      }
    }
    check();
    const quality=new Quality({bitrate:Math.round(6_000_000*Math.max(1,canvas.width*canvas.height/(1920*1080)))});
    const audioOptions=audioTrack?{
      sampleRate:await audioTrack.getSampleRate(),
      numberOfChannels:await audioTrack.getNumberOfChannels(),
    }:null;
    let format, videoCodec, audioCodec;
    for(const candidate of [
      {format:new Mp4OutputFormat({fastStart:'in-memory'}),video:'avc',audio:'aac'},
      {format:new WebMOutputFormat(),video:'vp9',audio:'opus'},
      {format:new WebMOutputFormat(),video:'vp8',audio:'opus'},
    ]){
      if(await canEncodeVideo(candidate.video,{width:canvas.width,height:canvas.height,frameRate:fps,quality})
        &&(!audioTrack||await canEncodeAudio(candidate.audio,audioOptions))){
        format=candidate.format;videoCodec=candidate.video;audioCodec=candidate.audio;break;
      }
    }
    if(!format)throw new Error('此浏览器不支持所需的离线视频编码，请使用新版 Chrome 或 Edge。');
    check();
    output=new Output({format,target:new BufferTarget()});
    videoSource=new CanvasSource(canvas,{codec:videoCodec,quality,keyFrameInterval:2});
    output.addVideoTrack(videoSource,{frameRate:fps});
    if(audioTrack){
      audioSource=new AudioSampleSource({codec:audioCodec,quality:new Quality({bitrate:128_000})});
      output.addAudioTrack(audioSource);
    }
    await output.start();
    onReady({format:format.fileExtension.slice(1).toUpperCase(),hasAudio:!!audioTrack});
    if(videoTrack){
      const firstTimestamp=await videoTrack.getFirstTimestamp();
      const timestamps=(function*(){for(let i=0;i<range.count;i++)yield Math.max(firstTimestamp,range.startTime+i/fps);})();
      iterator=new CanvasSink(videoTrack,{width:640,height:360,fit:'contain',poolSize:2}).canvasesAtTimestamps(timestamps);
    }
    for(let i=0;i<range.count;i++){
      check();
      const image=iterator?(await iterator.next()).value?.canvas:null;
      if(iterator&&!image)throw new Error(`无法读取第 ${range.start+i} 帧，请检查视频文件。`);
      check();
      await renderFrame({image,index:i,time:range.startTime+i/fps});
      await videoSource.add(i/fps,Math.min(1/fps,range.duration-i/fps));
      check();
      if(i%4===0||i===range.count-1){
        onProgress({phase:'video',done:i+1,total:range.count,progress:(i+1)/range.count*(audioTrack ? .9 : .98)});
        // Yield to input events for cancellation; this is not a frame timer.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    videoSource.close();
    if(audioTrack){
      const sink=new AudioSampleSink(audioTrack);
      for await(const sample of sink.samples(range.startTime,range.endTime)){
        let trimmed;
        try{
          check();
          const from=Math.max(0,Math.ceil((range.startTime-sample.timestamp)*sample.sampleRate-1e-6));
          const to=Math.min(sample.numberOfFrames,Math.ceil((range.endTime-sample.timestamp)*sample.sampleRate-1e-6));
          if(to>from){
            trimmed=sample.trim(from,to);
            trimmed.setTimestamp(Math.max(0,trimmed.timestamp-range.startTime));
            await audioSource.add(trimmed);
            onProgress({phase:'audio',done:range.count,total:range.count,progress:.9+.08*Math.min(1,(sample.timestamp+sample.duration-range.startTime)/range.duration)});
          }
        }finally{trimmed?.close();sample.close();}
      }
      audioSource.close();
    }
    check();onProgress({phase:'finalize',done:range.count,total:range.count,progress:.99});
    await output.finalize();finalized=true;check();
    return {blob:new Blob([output.target.buffer],{type:format.mimeType}),extension:format.fileExtension,hasAudio:!!audioTrack};
  }finally{
    await iterator?.return().catch(()=>{});
    if(output&&!finalized)await output.cancel().catch(()=>{});
    input?.dispose();
  }
}
