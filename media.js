/* Composite decoded video frames into the page instead of using video overlays.
   Independent images stay visible until a nonempty frame has actually been drawn. */
(() => {
  'use strict';
  document.querySelectorAll('[data-video-surface]').forEach(surface => {
    const video = surface.querySelector('video');
    const canvas = surface.querySelector('.media-canvas');
    const context = canvas.getContext('2d', {alpha:true});
    if (!context) return;
    const probe = document.createElement('canvas');
    probe.width = probe.height = 24;
    const probeContext = probe.getContext('2d', {willReadFrequently:true});
    let callback = 0, animation = 0, ready = false, lastDraw = 0;

    function showFallback() {
      ready = false;
      surface.classList.remove('media-frame-ready');
      surface.dataset.mediaStatus = 'fallback';
    }
    function usableFrame() {
      if (!probeContext) return false;
      probeContext.clearRect(0,0,24,24);
      probeContext.drawImage(video,0,0,24,24);
      const pixels = probeContext.getImageData(0,0,24,24).data;
      let visiblePixels = 0;
      for (let i=0; i<pixels.length; i+=4) {
        if (pixels[i+3]>16 && Math.max(pixels[i],pixels[i+1],pixels[i+2])>35) visiblePixels++;
      }
      return visiblePixels>4;
    }
    function paint() {
      if (video.readyState<2 || !video.videoWidth || !video.videoHeight) return;
      try {
        if (!ready && !usableFrame()) return;
        const width = Math.min(video.videoWidth,video.id==='card-video'?1080:1600);
        const height = Math.round(width*video.videoHeight/video.videoWidth);
        if (canvas.width!==width || canvas.height!==height) {canvas.width=width;canvas.height=height;}
        context.clearRect(0,0,width,height);
        context.drawImage(video,0,0,width,height);
        ready = true;
        surface.classList.add('media-frame-ready');
        surface.dataset.mediaStatus = 'playing';
      } catch {showFallback();}
    }
    function stop() {
      if (callback && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(callback);
      if (animation) cancelAnimationFrame(animation);
      callback=animation=0;
    }
    function start() {
      if (document.hidden) return;
      if (video.paused || callback || animation) return;
      if (video.requestVideoFrameCallback) {
        callback=video.requestVideoFrameCallback(()=>{callback=0;paint();start();});
      } else {
        animation=requestAnimationFrame(time=>{
          animation=0;
          if(time-lastDraw>=32){lastDraw=time;paint();}
          start();
        });
      }
    }
    function resume() {paint();start();}
    video.addEventListener('loadeddata',resume);
    video.addEventListener('playing',resume);
    video.addEventListener('seeked',paint);
    video.addEventListener('pause',()=>{stop();paint();});
    video.addEventListener('error',()=>{stop();showFallback();});
    video.addEventListener('emptied',()=>{stop();showFallback();});
    video.addEventListener('waiting',showFallback);
    video.addEventListener('stalled',()=>{if(video.readyState<2)showFallback();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else resume();});
    showFallback();resume();
  });
})();
