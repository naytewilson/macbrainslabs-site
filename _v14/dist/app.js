'use strict';
(() => {
 const video=document.querySelector('#notch'),button=document.querySelector('#motion-toggle'),status=document.querySelector('#motion-status');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let loading=false;
 function label(state){button.innerHTML=state==='playing'?'<span aria-hidden="true">Ⅱ</span> Pause Notch':state==='ended'?'<span aria-hidden="true">↻</span> Replay Notch':'<span aria-hidden="true">▷</span> Play Notch <span class="duration">20 sec</span>';button.setAttribute('aria-label',state==='playing'?'Pause Notch animation':state==='ended'?'Replay Notch animation':'Play Notch animation');}
 function resting(){if(reduced.matches&&!video.currentTime)video.poster='assets/notch-held.png';else if(!video.currentTime)video.poster='assets/notch-rest.png';}
 button.addEventListener('click',async()=>{if(loading)return;if(!video.paused){video.pause();return;}if(video.ended)video.currentTime=0;loading=true;button.textContent='Loading Notch…';status.textContent='Loading animation.';try{await video.play();status.textContent='Animation playing.';}catch(e){status.textContent='Animation could not play. The still image remains available.';label('paused');}finally{loading=false;}});
 video.addEventListener('play',()=>label('playing'));video.addEventListener('pause',()=>{label(video.ended?'ended':'paused');status.textContent=video.ended?'Notch has settled. Replay is available.':'Animation paused. Play is available.';});video.addEventListener('ended',()=>{label('ended');status.textContent='Notch has settled. Replay is available.'});video.addEventListener('error',()=>{loading=false;label('paused');status.textContent='The animation is unavailable. Please try again.'});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)video.pause();});
 reduced.addEventListener?.('change',()=>{if(reduced.matches)video.pause();resting();});resting();
 // Ordinary scrolling, never intercepted. Content is readable before enhancement.
 const folios=[...document.querySelectorAll('.folio')];let observer;
 function revealAll(){folios.forEach(el=>el.classList.remove('reveal-waiting'));observer?.disconnect();}
 if(!reduced.matches&&'IntersectionObserver'in window){try{observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.remove('reveal-waiting');observer.unobserve(e.target);}}),{threshold:.1});folios.forEach(el=>{if(el.getBoundingClientRect().top>innerHeight){el.classList.add('reveal-waiting');observer.observe(el);}});}catch(e){revealAll();}}
 document.addEventListener('focusin',e=>e.target.closest('.folio')?.classList.remove('reveal-waiting'));
 reduced.addEventListener?.('change',e=>{if(e.matches)revealAll();});addEventListener('beforeprint',revealAll);
})();
