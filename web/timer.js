export function timerCommand(timer, command, now=Date.now()) {
  if (!command) return timer;
  if (command.command==='start') return {duration:command.duration,rest:command.rest||0,title:command.title||'',phase:'work',startedAt:now,elapsed:0,paused:false,done:false};
  if (!timer) return timer;
  if (command.command==='s' || command.command==='0') return null;
  if (command.command==='r') return {...timer,phase:'work',startedAt:now,elapsed:0,paused:false,done:false};
  if (command.command==='p') {
    if (timer.done) return timer;
    return timer.paused ? {...timer,paused:false,startedAt:now} : {...timer,paused:true,elapsed:timer.elapsed+(now-timer.startedAt)/1000};
  }
  return timer;
}
export function timerDisplay(timer, now=Date.now()) {
  if (!timer) return null;
  const elapsed=timer.elapsed+(timer.paused||timer.done?0:(now-timer.startedAt)/1000);
  const length=timer.phase==='rest'?timer.rest:timer.duration;
  const seconds=Math.max(0,Math.floor(length ? length-elapsed : elapsed));
  const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
  return {text:(h?`${h}:`:'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'),elapsed,length,finished:!!length && elapsed>=length};
}
export function advanceTimer(timer, now=Date.now()) {
  const d=timerDisplay(timer,now);
  if (!d?.finished || timer.done) return timer;
  if (!timer.rest) return {...timer,elapsed:timer.duration,done:true,paused:true};
  // Anchor the next phase to its scheduled boundary even if the UI was suspended.
  let phase=timer.phase, boundary=timer.startedAt+(d.length-timer.elapsed)*1000;
  for(let i=0;i<10000 && boundary<=now;i++) {
    phase=phase==='work'?'rest':'work';
    const length=phase==='work'?timer.duration:timer.rest;
    if(boundary+length*1000>now) return {...timer,phase,startedAt:boundary,elapsed:0};
    boundary+=length*1000;
  }
  return {...timer,phase,startedAt:now,elapsed:0};
}
