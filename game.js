(() => {
  'use strict';
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const radar = document.querySelector('#radar');
  const rctx = radar.getContext('2d');
  const $ = s => document.querySelector(s);
  const ui = { time:$('#time'), score:$('#score'), kills:$('#kills'), threat:$('#threat'), hint:$('#hint'), danger:$('#danger'), title:$('#titleScreen'), start:$('#startScreen'), pause:$('#pauseScreen'), enemy:$('#enemyIntro'), over:$('#gameOverScreen') };

  let W=0,H=0,dpr=1,last=0,state='menu',elapsed=0,spawnClock=0,nextBurstAt=45,kills=0,score=0,shake=0,flash=0,enemyIntroShown=false,enemyTransition=0,musicFadeFrame=0;
  let pointer={active:false,x:0,y:0}, keys=new Set(), missiles=[], particles=[], trails=[], callouts=[], blasts=[];
  let lastTouchTap=0,lastTouchX=0,lastTouchY=0,dashNoticeAt=0;
  let best=Number(localStorage.getItem('skytrace-best')||0);
  let plane;
  const TAU=Math.PI*2;
  const ENEMY_INTRO_TIME=45,ENEMY_CLEAR_DELAY=.5,MUSIC_VOLUME=.18,MUSIC_FADE_MS=900;
  const BURST_TRIGGER_RADIUS=126,BURST_BLAST_RADIUS=145,BURST_FUSE=1.65,BURST_CHAIN_FUSE=1.1,BURST_WAVE_SPEED=250;
  const DASH_COST=500,DASH_DURATION=.75,DASH_MULTIPLIER=1.9;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const wrapAngle=a=>Math.atan2(Math.sin(a),Math.cos(a));
  const fmt=(s,tenths=false)=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}${tenths?'.'+Math.floor((s%1)*10):''}`;
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  let audioContext=null,sfxMaster=null,soundLoadPromise=null;
  const makeSoundBank=(src,voices,volume,cooldown=0)=>({src,voiceCount:voices,fallbackVoices:null,buffer:null,index:0,volume,cooldown,last:-Infinity});
  const sounds={
    click:makeSoundBank('audio/ui-click.wav',4,.58),
    collision:makeSoundBank('audio/collision.wav',4,.72,40),
    perfect:makeSoundBank('audio/perfect-kill.wav',3,.68,40),
    burstWarning:makeSoundBank('audio/burst-warning.wav',2,.42,80),
    explosion:makeSoundBank('audio/explosion.wav',3,.44,90),
    gameOver:makeSoundBank('audio/game-over.wav',1,.5),
    dash:makeSoundBank('audio/dash.wav',2,.56),
    nearMiss:makeSoundBank('audio/near-miss.wav',3,.9,90),
    newEnemy:makeSoundBank('audio/new-enemy.wav',1,.48)
  };
  const backgroundMusic=new Audio('audio/background-loop.wav');
  backgroundMusic.id='backgroundMusic';backgroundMusic.hidden=true;backgroundMusic.preload='auto';backgroundMusic.loop=true;backgroundMusic.playsInline=true;backgroundMusic.setAttribute('playsinline','');backgroundMusic.volume=MUSIC_VOLUME;document.body.append(backgroundMusic);
  $('#bestStart').textContent=fmt(best);

  function getAudioContext(){
    if(!AudioContextClass)return null;
    if(!audioContext){audioContext=new AudioContextClass();sfxMaster=audioContext.createGain();sfxMaster.gain.value=.96;sfxMaster.connect(audioContext.destination)}
    return audioContext;
  }
  function decodeSound(context,data){
    return new Promise((resolve,reject)=>{
      let settled=false;
      const done=buffer=>{if(!settled){settled=true;resolve(buffer)}};
      const fail=error=>{if(!settled){settled=true;reject(error)}};
      try{const result=context.decodeAudioData(data,done,fail);if(result&&typeof result.then==='function')result.then(done,fail)}catch(error){fail(error)}
    });
  }
  function prepareSounds(){
    const context=getAudioContext();
    if(!context)return Promise.resolve();
    if(!soundLoadPromise)soundLoadPromise=Promise.all(Object.values(sounds).map(async bank=>{
      try{const response=await fetch(new URL(bank.src,document.baseURI));if(!response.ok)throw new Error(`HTTP ${response.status}`);bank.buffer=await decodeSound(context,await response.arrayBuffer())}
      catch(error){console.warn(`音效加载失败：${bank.src}`,error)}
    }));
    return soundLoadPromise;
  }
  function unlockAudio(){
    const context=getAudioContext();
    if(!context)return;
    if(context.state==='suspended'||context.state==='interrupted')context.resume().catch(()=>{});
    prepareSounds();
  }
  function playFallback(bank,rate){
    if(!bank.fallbackVoices)bank.fallbackVoices=Array.from({length:bank.voiceCount},()=>{const audio=new Audio(bank.src);audio.preload='auto';audio.volume=bank.volume;return audio});
    const audio=bank.fallbackVoices[bank.index++%bank.fallbackVoices.length];audio.pause();audio.currentTime=0;audio.playbackRate=rate;audio.preservesPitch=false;audio.volume=bank.volume;audio.play().catch(()=>{});
  }
  function playSound(name,rate=1){
    const bank=sounds[name],now=performance.now();if(!bank||now-bank.last<bank.cooldown)return;bank.last=now;unlockAudio();
    if(audioContext&&sfxMaster&&bank.buffer){const source=audioContext.createBufferSource(),gain=audioContext.createGain();source.buffer=bank.buffer;source.playbackRate.value=rate;gain.gain.value=bank.volume;source.connect(gain);gain.connect(sfxMaster);source.start();return}
    playFallback(bank,rate);
  }
  function startBackgroundMusic(){
    unlockAudio();cancelAnimationFrame(musicFadeFrame);musicFadeFrame=0;backgroundMusic.pause();backgroundMusic.currentTime=0;backgroundMusic.volume=MUSIC_VOLUME;backgroundMusic.play().catch(()=>{});
  }
  function fadeOutBackgroundMusic(duration=MUSIC_FADE_MS){
    cancelAnimationFrame(musicFadeFrame);const started=performance.now(),startVolume=backgroundMusic.volume;
    const fade=now=>{if(state!=='over'){musicFadeFrame=0;return}const progress=Math.min(1,(now-started)/duration);backgroundMusic.volume=startVolume*(1-progress);if(progress<1)musicFadeFrame=requestAnimationFrame(fade);else{backgroundMusic.pause();backgroundMusic.currentTime=0;backgroundMusic.volume=MUSIC_VOLUME;musicFadeFrame=0}};
    musicFadeFrame=requestAnimationFrame(fade);
  }
  document.addEventListener('pointerdown',unlockAudio,{capture:true,passive:true});
  document.addEventListener('touchstart',unlockAudio,{capture:true,passive:true});
  document.addEventListener('keydown',unlockAudio,{capture:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state==='playing')unlockAudio()});
  document.addEventListener('click',e=>{if(e.target instanceof Element&&e.target.closest('button,.author-link'))playSound('click')});

  function resize(){dpr=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)}
  addEventListener('resize',resize);resize();

  function reset(){
    elapsed=0;spawnClock=-1.6;nextBurstAt=ENEMY_INTRO_TIME;kills=0;score=0;shake=0;flash=0;enemyIntroShown=false;enemyTransition=0;missiles=[];particles=[];trails=[];callouts=[];blasts=[];
    plane={x:0,y:0,a:-Math.PI/2,speed:190,turn:2.9,trail:0,dash:0,alive:true};
    pointer.active=false;lastTouchTap=0;dashNoticeAt=0;ui.hint.style.opacity='1';show(ui.enemy,false);updateHUD();
  }
  function show(el,on){el.classList.toggle('visible',on)}
  function showIntro(){if(state!=='menu')return;state='intro';show(ui.title,false);show(ui.start,true)}
  function begin(){reset();state='playing';show(ui.title,false);show(ui.start,false);show(ui.pause,false);show(ui.over,false);last=performance.now();startBackgroundMusic()}
  function pause(){if(state!=='playing')return;state='paused';pointer.active=false;backgroundMusic.pause();show(ui.pause,true)}
  function resume(){if(state!=='paused')return;state='playing';show(ui.pause,false);last=performance.now();backgroundMusic.volume=MUSIC_VOLUME;backgroundMusic.play().catch(()=>{})}
  function startEnemyTransition(){
    if(enemyIntroShown)return;
    enemyIntroShown=true;state='enemyTransition';pointer.active=false;enemyTransition=ENEMY_CLEAR_DELAY;
    if(missiles.length){for(const m of missiles)burst(m.x,m.y,m.type==='burst'?'255,137,84':'255,102,72',12);playSound('collision');shake=Math.max(shake,7);flash=Math.max(flash,.08)}
    missiles=[];blasts=[];updateHUD();
  }
  function showEnemyIntro(){
    if(state!=='enemyTransition')return;
    state='enemyIntro';show(ui.enemy,true);playSound('newEnemy');
  }
  function continueFromEnemyIntro(){
    if(state!=='enemyIntro')return;
    state='playing';spawnClock=999;show(ui.enemy,false);last=performance.now();
  }
  $('#titleStartBtn').onclick=showIntro;$('#startBtn').onclick=begin;$('#restartBtn').onclick=begin;$('#restartPauseBtn').onclick=begin;$('#resumeBtn').onclick=resume;$('#pauseBtn').onclick=()=>state==='paused'?resume():pause();
  $('#enemyContinueBtn').onclick=continueFromEnemyIntro;
  addEventListener('keydown',e=>{
    keys.add(e.key.toLowerCase());
    if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase()))e.preventDefault();
    if(state==='enemyIntro'&&(e.key==='Enter'||e.code==='Space')){continueFromEnemyIntro();return}
    if(state==='playing'&&e.code==='Space'&&!e.repeat){tryDash();return}
    if(e.key.toLowerCase()==='p'||e.key==='Escape')state==='playing'?pause():state==='paused'&&resume();
  });
  addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('pointerdown',e=>{
    if(state!=='playing')return;
    if(e.pointerType==='touch'){
      const now=performance.now(),nearLastTap=Math.hypot(e.clientX-lastTouchX,e.clientY-lastTouchY)<80;
      if(now-lastTouchTap<330&&nearLastTap){tryDash();lastTouchTap=0}else{lastTouchTap=now;lastTouchX=e.clientX;lastTouchY=e.clientY}
    }
    pointer.active=true;pointer.x=e.clientX;pointer.y=e.clientY;canvas.setPointerCapture(e.pointerId);ui.hint.style.opacity='0';
  });
  canvas.addEventListener('pointermove',e=>{if(state==='playing'&&pointer.active){pointer.x=e.clientX;pointer.y=e.clientY}});
  canvas.addEventListener('pointerup',()=>pointer.active=false);
  canvas.addEventListener('pointercancel',()=>pointer.active=false);

  function spawnMissile(){
    const count=missiles.length,burstCount=missiles.filter(m=>m.type==='burst').length;
    const isBurst=elapsed>=ENEMY_INTRO_TIME&&elapsed>=nextBurstAt&&burstCount<2;
    if(count>=14&&!isBurst||count>=15)return;
    const ang=Math.random()*TAU,dist=Math.max(W,H)*.7+120;
    const difficulty=Math.min(elapsed/75,1);
    if(isBurst)nextBurstAt=elapsed+18+Math.random()*12;
    missiles.push({type:isBurst?'burst':'standard',x:plane.x+Math.cos(ang)*dist,y:plane.y+Math.sin(ang)*dist,a:ang+Math.PI,speed:isBurst?205+difficulty*22+Math.random()*7:216+difficulty*32+Math.random()*9,turn:isBurst?1.08+difficulty*.16:1.22+difficulty*.2,r:isBurst?11:8,life:0,trail:0,armed:false,near:false,nearAwarded:false,activated:false,fuse:BURST_FUSE,pendingDetonation:false,pendingFuse:0});
    if(isBurst)updateHUD();
  }
  function burst(x,y,color,n=20){for(let i=0;i<n;i++){let a=Math.random()*TAU,s=40+Math.random()*170;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.35+Math.random()*.55,max:1,size:1+Math.random()*3,color})}}
  function addScore(points,x,y,label,color='117,240,190'){score+=points;callouts.push({x,y,text:label,life:1.15,max:1.15,color})}
  function tryDash(){
    if(state!=='playing'||!plane.alive||plane.dash>0)return false;
    if(score<DASH_COST){
      const now=performance.now();
      if(now-dashNoticeAt>700){dashNoticeAt=now;callouts.push({x:plane.x,y:plane.y-25,text:'需要 500 积分',life:.9,max:.9,color:'255,185,143'})}
      return false;
    }
    score-=DASH_COST;plane.dash=DASH_DURATION;
    playSound('dash');burst(plane.x,plane.y,'117,240,190',18);callouts.push({x:plane.x,y:plane.y-28,text:'冲刺  -500',life:1,max:1,color:'185,255,231'});updateHUD();return true;
  }
  function startBurstExplosions(seeds,removed=new Set()){
    const started=new Set();
    for(const i of seeds){
      const m=missiles[i];if(!m||m.type!=='burst'||started.has(i))continue;
      started.add(i);removed.add(i);playSound('explosion');blasts.push({x:m.x,y:m.y,radius:0,maxRadius:BURST_BLAST_RADIUS,speed:BURST_WAVE_SPEED,done:false,linger:.16});burst(m.x,m.y,'255,103,76',34);burst(m.x,m.y,'42,47,44',18);shake=Math.max(shake,10);flash=Math.max(flash,.16);
    }
    return removed;
  }
  function removeMissiles(removed){kills+=removed.size;[...removed].sort((a,b)=>b-a).forEach(i=>missiles.splice(i,1))}
  function primeBurst(m,label){
    if(!m||m.type!=='burst'||m.pendingDetonation)return false;
    m.pendingDetonation=true;m.pendingFuse=BURST_CHAIN_FUSE;m.activated=false;m.fuse=BURST_FUSE;
    playSound('burstWarning',BURST_FUSE/BURST_CHAIN_FUSE);callouts.push({x:m.x,y:m.y-25,text:label,life:1,max:1,color:'255,185,143'});return true;
  }
  function advanceBlastWaves(dt){
    const removed=new Set();let planeHit=false;
    for(const b of blasts){
      if(b.done){b.linger-=dt;continue}
      const previousRadius=b.radius;
      b.radius=Math.min(b.maxRadius,b.radius+b.speed*dt);
      const planeDistance=Math.hypot(plane.x-b.x,plane.y-b.y);
      if(planeDistance+12>=previousRadius&&planeDistance-12<=b.radius)planeHit=true;
      for(let i=0;i<missiles.length;i++)if(!removed.has(i)){
        const distance=Math.hypot(missiles[i].x-b.x,missiles[i].y-b.y),radius=missiles[i].r;
        if(distance+radius>=previousRadius&&distance-radius<=b.radius){if(missiles[i].type==='burst')primeBurst(missiles[i],'连锁蓄爆');else removed.add(i)}
      }
      if(b.radius>=b.maxRadius)b.done=true;
    }
    if(removed.size)removeMissiles(removed);
    blasts=blasts.filter(b=>!b.done||b.linger>0);return planeHit;
  }
  function resolveMissileCollisions(){
    const links=missiles.map(()=>[]);
    for(let i=0;i<missiles.length;i++)for(let j=i+1;j<missiles.length;j++)if(missiles[i].armed&&missiles[j].armed&&!missiles[i].pendingDetonation&&!missiles[j].pendingDetonation&&Math.hypot(missiles[i].x-missiles[j].x,missiles[i].y-missiles[j].y)<24){links[i].push(j);links[j].push(i)}
    const visited=new Set(),groups=[];
    for(let i=0;i<links.length;i++)if(links[i].length&&!visited.has(i)){const stack=[i],group=[];visited.add(i);while(stack.length){const n=stack.pop();group.push(n);for(const k of links[n])if(!visited.has(k)){visited.add(k);stack.push(k)}}if(group.length>=2)groups.push(group)}
    const removed=new Set();
    for(const group of groups){
      let x=0,y=0;for(const i of group){x+=missiles[i].x;y+=missiles[i].y;if(missiles[i].type==='burst')primeBurst(missiles[i],'碰撞蓄爆');else removed.add(i)}x/=group.length;y/=group.length;
      const angle=group.length===2?Math.abs(wrapAngle(missiles[group[0]].a-missiles[group[1]].a)):0;
      const perfect=group.length===2&&angle>=Math.PI/2-.015;
      const bonus=group.length>=3?(group.length-2)*150:perfect?100:0;
      const points=100+bonus;
      playSound(perfect?'perfect':'collision');
      addScore(points,x,y,perfect?`完美击杀  +${points}`:group.length>=3?`${group.length} 连撞  +${points}`:`碰撞  +${points}`,perfect?'255,221,126':'255,138,107');
      burst(x,y,perfect?'255,220,116':'255,102,72',24+group.length*7);shake=Math.min(13,6+group.length*1.5);flash=.16;
    }
    removeMissiles(removed);
  }
  function update(dt){
    elapsed+=dt;
    if(!enemyIntroShown&&elapsed>=ENEMY_INTRO_TIME){startEnemyTransition();return}
    spawnClock+=dt;const spawnEvery=Math.max(1.65,3.7-elapsed*.018);
    if(spawnClock>=spawnEvery){spawnClock=0;spawnMissile();if(state!=='playing')return}
    let desired=plane.a;
    const left=keys.has('a')||keys.has('arrowleft'),right=keys.has('d')||keys.has('arrowright');
    if(left)desired=plane.a-Math.PI/2;if(right)desired=plane.a+Math.PI/2;
    if(keys.has('w')||keys.has('arrowup'))desired=-Math.PI/2;if(keys.has('s')||keys.has('arrowdown'))desired=Math.PI/2;
    if(pointer.active)desired=Math.atan2(pointer.y-H*.5,pointer.x-W*.5);
    if(pointer.active||left||right||keys.has('w')||keys.has('s')||keys.has('arrowup')||keys.has('arrowdown'))plane.a+=clamp(wrapAngle(desired-plane.a),-plane.turn*dt,plane.turn*dt);
    plane.dash=Math.max(0,plane.dash-dt);const planeSpeed=plane.speed*(plane.dash>0?DASH_MULTIPLIER:1);
    plane.x+=Math.cos(plane.a)*planeSpeed*dt;plane.y+=Math.sin(plane.a)*planeSpeed*dt;
    plane.trail+=dt;const trailEvery=plane.dash>0?.018:.035;if(plane.trail>trailEvery){plane.trail=0;const dashing=plane.dash>0;trails.push({x:plane.x-Math.cos(plane.a)*14,y:plane.y-Math.sin(plane.a)*14,life:dashing?.55:.42,max:dashing?.55:.42,color:dashing?'166,255,229':'80,235,181',size:dashing?3.4:2})}
    const timedBursts=[];
    for(let i=0;i<missiles.length;i++){
      const m=missiles[i];
      m.life+=dt;m.armed=m.life>.45;
      if(m.pendingDetonation){m.pendingFuse-=dt;if(m.pendingFuse<=0)timedBursts.push(i);continue}
      const target=Math.atan2(plane.y-m.y,plane.x-m.x);m.a+=clamp(wrapAngle(target-m.a),-m.turn*dt,m.turn*dt);m.x+=Math.cos(m.a)*m.speed*dt;m.y+=Math.sin(m.a)*m.speed*dt;m.trail+=dt;
      if(m.trail>.025){m.trail=0;trails.push({x:m.x-Math.cos(m.a)*12,y:m.y-Math.sin(m.a)*12,life:.62,max:.62,color:m.type==='burst'?'255,137,84':'255,82,67',size:m.type==='burst'?2.8:2.4})}
      const distance=Math.hypot(m.x-plane.x,m.y-plane.y);if(m.armed&&!m.nearAwarded){if(distance<52&&distance>16)m.near=true;if(m.near&&distance>108){m.nearAwarded=true;playSound('nearMiss');addScore(40,plane.x,plane.y-24,'极限掠过  +40')}}
      if(m.type==='burst'&&m.armed){if(!m.activated&&distance<BURST_TRIGGER_RADIUS){m.activated=true;m.fuse=BURST_FUSE;playSound('burstWarning');callouts.push({x:m.x,y:m.y-24,text:'爆弹已激活',life:1,max:1,color:'255,146,111'})}if(m.activated){m.fuse-=dt;if(m.fuse<=0)timedBursts.push(i)}}
    }
    if(timedBursts.length){const removed=startBurstExplosions(timedBursts);removeMissiles(removed)}
    resolveMissileCollisions();
    if(advanceBlastWaves(dt)){gameOver();return}
    for(const m of missiles)if(Math.hypot(m.x-plane.x,m.y-plane.y)<15&&m.armed){gameOver();return}
    updateHUD();
  }
  function updateEffects(dt){
    trails.forEach(t=>t.life-=dt);trails=trails.filter(t=>t.life>0);
    particles.forEach(p=>{p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.97;p.vy*=.97});particles=particles.filter(p=>p.life>0);
    callouts.forEach(c=>{c.life-=dt;c.y-=18*dt});callouts=callouts.filter(c=>c.life>0);
    shake=Math.max(0,shake-dt*25);flash=Math.max(0,flash-dt);
  }
  function updateHUD(){ui.time.textContent=fmt(elapsed);ui.score.textContent=score.toLocaleString('zh-CN');ui.kills.textContent=kills;ui.threat.textContent=missiles.length;let nearest=9999;for(const m of missiles)nearest=Math.min(nearest,Math.hypot(m.x-(plane?.x||0),m.y-(plane?.y||0)));ui.danger.classList.toggle('show',nearest<125)}
  function gameOver(){state='over';plane.alive=false;fadeOutBackgroundMusic();playSound('gameOver');burst(plane.x,plane.y,'117,240,190',34);shake=13;const record=elapsed>best;if(record){best=elapsed;localStorage.setItem('skytrace-best',String(best))}$('#bestStart').textContent=fmt(best);$('#finalTime').textContent=fmt(elapsed,true);$('#finalScore').textContent=score.toLocaleString('zh-CN');$('#finalKills').textContent=kills;$('#resultTitle').textContent=record?'新的飞行纪录。':elapsed<12?'再来一次。':'差一点。';$('#recordLine').textContent=record?'这条尾迹比之前所有记录都长。':score?'冒险靠近导弹，才能把生存变成高分。':'再绕紧一点，导弹就会替你解决彼此。';setTimeout(()=>show(ui.over,true),520)}

  function worldToScreen(x,y){return{x:x-plane.x+W/2,y:y-plane.y+H/2}}
  function drawGrid(){
    ctx.fillStyle='#07110f';ctx.fillRect(-20,-20,W+40,H+40);
    const grid=56,major=grid*5,ox=(((-plane.x)%grid)+grid)%grid,oy=(((-plane.y)%grid)+grid)%grid;
    ctx.lineWidth=1;ctx.strokeStyle='rgba(105,170,148,.075)';ctx.beginPath();for(let x=ox;x<W;x+=grid){ctx.moveTo(x,0);ctx.lineTo(x,H)}for(let y=oy;y<H;y+=grid){ctx.moveTo(0,y);ctx.lineTo(W,y)}ctx.stroke();
    const mx=(((-plane.x)%major)+major)%major,my=(((-plane.y)%major)+major)%major;ctx.strokeStyle='rgba(105,170,148,.12)';ctx.beginPath();for(let x=mx;x<W;x+=major){ctx.moveTo(x,0);ctx.lineTo(x,H)}for(let y=my;y<H;y+=major){ctx.moveTo(0,y);ctx.lineTo(W,y)}ctx.stroke();
    ctx.fillStyle='rgba(122,176,158,.21)';ctx.font='8px monospace';for(let x=mx;x<W;x+=major)for(let y=my;y<H;y+=major)ctx.fillText(`${Math.round((plane.x+x-W/2)/10)} · ${Math.round((plane.y+y-H/2)/10)}`,x+6,y-6);
    const g=ctx.createRadialGradient(W/2,H/2,40,W/2,H/2,Math.max(W,H)*.68);g.addColorStop(0,'rgba(21,58,47,.12)');g.addColorStop(1,'rgba(0,0,0,.48)');ctx.fillStyle=g;ctx.fillRect(0,0,W,H)
  }
  function drawPlane(){const p={x:W/2,y:H/2},dashing=plane.dash>0;ctx.save();ctx.translate(p.x,p.y);if(dashing){ctx.strokeStyle='rgba(142,255,218,.5)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,24+Math.sin(elapsed*24)*2,0,TAU);ctx.stroke()}ctx.rotate(plane.a+Math.PI/2);if(plane.alive){ctx.shadowColor='#75f0be';ctx.shadowBlur=dashing?34:18;ctx.fillStyle=dashing?'#effff9':'#c9ffec';ctx.beginPath();ctx.moveTo(0,-16);ctx.lineTo(6,-3);ctx.lineTo(17,8);ctx.lineTo(15,12);ctx.lineTo(4,7);ctx.lineTo(3,15);ctx.lineTo(-3,15);ctx.lineTo(-4,7);ctx.lineTo(-15,12);ctx.lineTo(-17,8);ctx.lineTo(-6,-3);ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#0d4a3a';ctx.fillRect(-2,-8,4,14)}ctx.restore()}
  function drawMissile(m){
    const p=worldToScreen(m.x,m.y);ctx.save();ctx.translate(p.x,p.y);
    if(m.type==='burst'){
      const warning=m.activated||m.pendingDetonation,rate=m.pendingDetonation?34:12+(1-m.fuse/BURST_FUSE)*18;
      const blink=warning&&Math.sin(m.life*rate)>0;
      ctx.rotate(m.life*.55);ctx.shadowColor=blink?'#ff503d':'#101715';ctx.shadowBlur=blink?28:11;ctx.fillStyle=blink?'#59130d':'#020303';ctx.strokeStyle=m.pendingDetonation?'#fff0df':m.activated?'#ff725f':'#7b8e87';ctx.lineWidth=m.pendingDetonation?2:1.3;ctx.beginPath();for(let i=0;i<24;i++){const a=i/24*TAU-Math.PI/2,r=i%2?9:14;const x=Math.cos(a)*r,y=Math.sin(a)*r;i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle=blink?'#ff725f':'#111a17';ctx.beginPath();ctx.arc(0,0,6.5,0,TAU);ctx.fill();
    }else{
      ctx.rotate(m.a+Math.PI/2);ctx.shadowColor='#ff4738';ctx.shadowBlur=12;ctx.fillStyle='#ff8a78';ctx.beginPath();ctx.moveTo(0,-11);ctx.lineTo(4,-5);ctx.lineTo(4,7);ctx.lineTo(8,11);ctx.lineTo(2,9);ctx.lineTo(0,13);ctx.lineTo(-2,9);ctx.lineTo(-8,11);ctx.lineTo(-4,7);ctx.lineTo(-4,-5);ctx.closePath();ctx.fill();
    }
    ctx.restore();
  }
  function draw(){
    const sx=shake?(Math.random()-.5)*shake:0,sy=shake?(Math.random()-.5)*shake:0;ctx.save();ctx.translate(sx,sy);drawGrid();
    for(const t of trails){const p=worldToScreen(t.x,t.y),a=t.life/t.max;ctx.fillStyle=`rgba(${t.color},${a*.55})`;ctx.beginPath();ctx.arc(p.x,p.y,t.size*a,0,TAU);ctx.fill()}
    ctx.save();ctx.setLineDash([7,8]);ctx.lineWidth=1;ctx.strokeStyle='rgba(245,255,251,.38)';for(const m of missiles)if(m.type==='burst'){const p=worldToScreen(m.x,m.y);ctx.beginPath();ctx.arc(p.x,p.y,BURST_BLAST_RADIUS,0,TAU);ctx.stroke()}ctx.restore();
    for(const b of blasts){const p=worldToScreen(b.x,b.y),alpha=b.done?clamp(b.linger/.16,0,1):1;ctx.save();ctx.strokeStyle=`rgba(255,82,58,${alpha*.92})`;ctx.lineWidth=4;ctx.shadowColor='#ff4937';ctx.shadowBlur=18;ctx.beginPath();ctx.arc(p.x,p.y,b.radius,0,TAU);ctx.stroke();ctx.restore()}
    for(const p0 of particles){const p=worldToScreen(p0.x,p0.y);ctx.globalAlpha=clamp(p0.life/.4,0,1);ctx.fillStyle=`rgb(${p0.color})`;ctx.fillRect(p.x,p.y,p0.size,p0.size)}ctx.globalAlpha=1;
    missiles.forEach(drawMissile);for(const c of callouts){const p=worldToScreen(c.x,c.y),a=clamp(c.life/.35,0,1);ctx.globalAlpha=a;ctx.fillStyle=`rgb(${c.color})`;ctx.font='700 13px Inter, sans-serif';ctx.textAlign='center';ctx.shadowColor=`rgba(${c.color},.35)`;ctx.shadowBlur=9;ctx.fillText(c.text,p.x,p.y)}ctx.globalAlpha=1;ctx.shadowBlur=0;drawPlane();ctx.restore();if(flash){ctx.fillStyle=`rgba(255,100,72,${flash*.45})`;ctx.fillRect(0,0,W,H)}drawRadar();
  }
  function drawRadar(){
    const S=152,c=S/2,range=600;rctx.clearRect(0,0,S,S);rctx.strokeStyle='rgba(117,240,190,.18)';rctx.lineWidth=1;rctx.beginPath();rctx.arc(c,c,70,0,TAU);rctx.arc(c,c,45,0,TAU);rctx.moveTo(c,7);rctx.lineTo(c,145);rctx.moveTo(7,c);rctx.lineTo(145,c);rctx.stroke();rctx.fillStyle='#75f0be';rctx.beginPath();rctx.arc(c,c,3,0,TAU);rctx.fill();for(const m of missiles){let dx=(m.x-plane.x)/range*69,dy=(m.y-plane.y)/range*69,d=Math.hypot(dx,dy);if(d>69){dx*=69/d;dy*=69/d}rctx.fillStyle=m.type==='burst'?'#ffbd75':'#ff604f';rctx.beginPath();rctx.arc(c+dx,c+dy,m.type==='burst'?3.5:2.5,0,TAU);rctx.fill()}}
  function frame(t){const dt=Math.min((t-last)/1000,.034)||0;last=t;if(state==='playing')update(dt);if(state==='enemyTransition'){enemyTransition-=dt;if(enemyTransition<=0)showEnemyIntro()}if(state==='playing'||state==='over'||state==='enemyTransition'||state==='enemyIntro')updateEffects(dt);draw();requestAnimationFrame(frame)}
  reset();requestAnimationFrame(frame);
})();

