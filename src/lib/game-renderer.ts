import { cells, ghost, GARBAGE, HEIGHT, TICK_MS, WIDTH, type Cell, type FilledCell, type Game, type MotionStep, type Resolution } from './game';

const S = 48;
const PALETTE = ['', '#fb648b', '#a38bfa', '#a4d876', '#ffce69', '#d6e0e2'];
const SHADE = ['', '#da4978', '#7e66cb', '#7bb94c', '#e6a43d', '#8d9da3'];
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t;
export function sampleResolution(motion: Resolution, elapsed: number) {
  let start = 0;
  for (const step of motion.steps) {
    const duration = step.ticks * TICK_MS;
    if (elapsed < start + duration) return {step, progress:clamp((elapsed-start)/duration), start};
    start += duration;
  }
  return null;
}
export function presentation(game: Game) {
  let pending = 0, start = 0, chain = 0;
  if (!game.motion) return {score:game.score, chain:game.lastChain};
  const elapsed = (game.tick-game.motion.startTick)*TICK_MS;
  for (const step of game.motion.steps) {
    if (step.kind === 'clear') {
      if (elapsed < start + step.ticks*TICK_MS*.36) pending += step.score ?? 0;
      else chain = step.chain ?? 0;
    }
    start += step.ticks*TICK_MS;
  }
  return {score:game.score-pending, chain};
}

type Pose = { x: number; y: number; angle: number };
type BlobStyle = { sx?: number; sy?: number; alpha?: number; glow?: number; flash?: number; closed?: boolean };

/** A presentation-only timeline. All collisions, timing and scores stay in game.ts. */
export class GameRenderer {
  private motion: Resolution | null = null;
  private motionStart = 0;
  private seenMotion = 0;
  private pose: Pose | null = null;
  private renderedPiece = -1;
  private spawnAt = 0;
  private lastFrame = 0;
  private tickAt = 0;
  private lastTick = -1;
  constructor(private reducedMotion = false) {}
  setReducedMotion(value: boolean) { this.reducedMotion = value; }

  reset() {
    this.motion = null; this.seenMotion = 0; this.pose = null;
    this.renderedPiece = -1; this.lastTick = -1; this.lastFrame = 0;
  }
  sync(game: Game, now: number) {
    if (game.tick !== this.lastTick) { this.tickAt = now; this.lastTick = game.tick; }
    if (game.motion && game.motion.id !== this.seenMotion) {
      this.motion = game.motion; this.seenMotion = game.motion.id;
      this.motionStart = now - (game.tick - game.motion.startTick) * TICK_MS;
    }
    // Drop stale effects after a background-tab catch-up, instead of replaying a backlog.
    if (!game.motion && this.motion && game.tick >= this.motion.startTick + this.motion.ticks) {
      this.motionStart = Math.min(this.motionStart, now - this.motion.ticks * TICK_MS);
    }
  }
  remaining(now: number) { return this.motion ? Math.max(0, this.motion.ticks*TICK_MS - (now-this.motionStart)) : 0; }

  draw(ctx: CanvasRenderingContext2D, game: Game, now: number) {
    const dt = clamp((now - (this.lastFrame || now)) / 1000, 0, .05);
    this.lastFrame = now;
    const elapsed = now - this.motionStart;
    const sampled = this.motion ? sampleResolution(this.motion, elapsed) : null;
    ctx.clearRect(0,0,WIDTH*S,HEIGHT*S);
    ctx.save();
    if (sampled && !this.reducedMotion) {
      const {step,progress:p} = sampled;
      if (step.kind === 'land') ctx.translate(0, Math.sin(p*Math.PI*3)*2.4*(1-p));
      if (step.kind === 'clear' && p > .3 && p < .7) ctx.translate(Math.sin(p*43)*1.8*(1-p),0);
    }
    for(let y=0;y<HEIGHT;y++) for(let x=0;x<WIDTH;x++) {
      ctx.fillStyle=(x+y)%2?'#102c36':'#122f39'; ctx.fillRect(x*S,y*S,S,S);
    }
    // A quiet mascot watermark gives the field its own arcade-cabinet identity.
    ctx.save();ctx.globalAlpha=.045;ctx.fillStyle='#b5fff0';
    ctx.beginPath();ctx.roundRect(33,188,222,208,[100,100,65,65]);ctx.fill();
    ctx.globalAlpha=.065;ctx.fillStyle='#061923';ctx.beginPath();
    ctx.ellipse(117,292,22,35,-.12,0,Math.PI*2);ctx.ellipse(174,292,22,35,.12,0,Math.PI*2);ctx.fill();
    ctx.restore();
    if (sampled) this.drawStep(ctx,sampled.step,sampled.progress);
    else {
      this.drawBoard(ctx,game.board);
      if (!game.ended) this.drawActive(ctx,game,now,dt);
    }
    if (this.motion) this.drawBursts(ctx,this.motion,elapsed);
    ctx.strokeStyle='#fb648b55';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(116,15);ctx.lineTo(124,23);ctx.moveTo(124,15);ctx.lineTo(116,23);ctx.stroke();
    ctx.restore();
  }

  private blob(ctx:CanvasRenderingContext2D,x:number,y:number,color:FilledCell,style:BlobStyle={}) {
    if(y < -1.5) return;
    ctx.save();
    // Bottom anchoring makes compression read as an impact rather than a shrinking sprite.
    ctx.translate(x*S+24,y*S+44);
    ctx.scale(style.sx??1,style.sy??1);
    ctx.globalAlpha=style.alpha??1;
    if(style.glow){ctx.shadowBlur=style.glow;ctx.shadowColor=PALETTE[color];}
    const fill=ctx.createLinearGradient(0,-39,0,0);
    fill.addColorStop(0,PALETTE[color]);fill.addColorStop(.65,PALETTE[color]);fill.addColorStop(1,SHADE[color]);
    ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(-20,-39,40,39,[18,18,14,14]);ctx.fill();
    ctx.shadowBlur=0;
    ctx.fillStyle='#ffffff66';ctx.beginPath();ctx.ellipse(-10,-31,7,3,-.4,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#ffffff24';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(-19.5,-38.5,39,38,[18,18,14,14]);ctx.stroke();
    if(style.closed){
      ctx.strokeStyle='#363149';ctx.lineWidth=2.5;ctx.lineCap='round';
      for(const eye of [-6,6]){ctx.beginPath();ctx.moveTo(eye-3,-18);ctx.lineTo(eye,-16);ctx.lineTo(eye+3,-18);ctx.stroke();}
    } else {
      ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(-5,-18,5,7,0,0,Math.PI*2);ctx.ellipse(7,-18,5,7,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#25273d';ctx.beginPath();ctx.ellipse(-4,-16,2.5,3.5,0,0,Math.PI*2);ctx.ellipse(8,-16,2.5,3.5,0,0,Math.PI*2);ctx.fill();
      if(color===GARBAGE){ctx.strokeStyle='#718087';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(1,-8,5,0,Math.PI);ctx.stroke();}
    }
    if(style.flash){ctx.globalAlpha=(style.alpha??1)*style.flash;ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(-20,-39,40,39,[18,18,14,14]);ctx.fill();}
    ctx.restore();
  }
  private drawBoard(ctx:CanvasRenderingContext2D,board:Cell[][],skip=new Set<string>()) {
    board.forEach((row,y)=>row.forEach((color,x)=>{if(color && !skip.has(`${x},${y}`)) this.blob(ctx,x,y,color);}));
  }
  private drawActive(ctx:CanvasRenderingContext2D,game:Game,now:number,dt:number) {
    const piece=game.active, landing=ghost(game);
    for(const [x,y,color] of cells(landing)) this.blob(ctx,x,y,color,{alpha:.14});
    const interval=Math.max(4,14-Math.floor(game.tick/600));
    const fraction=clamp((now-this.tickAt)/TICK_MS);
    const targetY=piece.y + (landing.y > piece.y ? clamp((game.gravity+fraction)/interval) : 0);
    if(this.renderedPiece!==game.pieces || !this.pose){
      this.pose={x:piece.x,y:piece.y-.35,angle:piece.rotation*Math.PI/2};
      this.renderedPiece=game.pieces;this.spawnAt=now;
    }
    let angle=piece.rotation*Math.PI/2;
    while(angle-this.pose.angle>Math.PI) angle-=Math.PI*2;
    while(angle-this.pose.angle< -Math.PI) angle+=Math.PI*2;
    const blend=this.reducedMotion?1:1-Math.exp(-dt*24);
    this.pose.x+=(piece.x-this.pose.x)*blend;
    this.pose.y+=(targetY-this.pose.y)*blend;
    this.pose.angle+=(angle-this.pose.angle)*blend;
    const spawn=clamp((now-this.spawnAt)/150);
    const stretch=this.reducedMotion?0:Math.min(.085,Math.abs(targetY-this.pose.y)*.13);
    const style={sx:1-stretch,sy:1+stretch,alpha:this.reducedMotion?1:.45+.55*spawn};
    this.blob(ctx,this.pose.x,this.pose.y,piece.colors[0],style);
    this.blob(ctx,this.pose.x+Math.sin(this.pose.angle),this.pose.y-Math.cos(this.pose.angle),piece.colors[1],style);
  }
  private drawStep(ctx:CanvasRenderingContext2D,step:MotionStep,p:number) {
    const skip=new Set(step.kind==='drop'?[]:step.blobs.map(b=>`${b.x},${step.kind==='fall'?b.fromY:b.toY}`));
    this.drawBoard(ctx,step.board,skip);
    for(const b of step.blobs) {
      if(step.kind==='drop' || step.kind==='fall') {
        const travel=this.reducedMotion?p:easeIn(p);
        const y=b.fromY+(b.toY-b.fromY)*travel;
        const stretch=this.reducedMotion?0:(step.kind==='drop'?.26:.17)*Math.sin(p*Math.PI);
        if(step.kind==='drop' && !this.reducedMotion){
          const gradient=ctx.createLinearGradient(0,b.fromY*S,0,(y+1)*S);
          gradient.addColorStop(0,`${PALETTE[b.color]}00`);gradient.addColorStop(1,`${PALETTE[b.color]}66`);
          ctx.fillStyle=gradient;ctx.fillRect(b.x*S+11,Math.max(0,b.fromY*S+24),26,Math.max(0,(y-b.fromY)*S));
          for(let i=1;i<=2;i++) this.blob(ctx,b.x,y-i*.42,b.color,{alpha:.12/i,sx:.78,sy:1.18});
        }
        this.blob(ctx,b.x,y,b.color,{sx:1-stretch*.65,sy:1+stretch});
      } else if(step.kind==='land') {
        const squash=this.reducedMotion?0:Math.sin(p*Math.PI*2)*Math.exp(-p*2)*.3;
        this.blob(ctx,b.x,b.toY,b.color,{sx:1+squash,sy:1-squash,closed:p<.35&&!this.reducedMotion});
        if(!this.reducedMotion){ctx.save();ctx.strokeStyle=PALETTE[b.color];ctx.globalAlpha=(1-p)*.45;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(b.x*S+24,b.toY*S+44,20+p*12,3+p*3,0,0,Math.PI*2);ctx.stroke();ctx.restore();}
      } else {
        const burst=.36;
        if(p < burst) {
          const inflate=this.reducedMotion?1:1+Math.sin(p/burst*Math.PI/2)*.24;
          this.blob(ctx,b.x,b.toY,b.color,{sx:inflate,sy:inflate,glow:this.reducedMotion?0:p*35,flash:p*.8,closed:true});
        } else if(p<.53) {
          const out=(p-burst)/(.53-burst);
          this.blob(ctx,b.x,b.toY,b.color,{sx:1.24*(1-out),sy:1.24*(1-out),alpha:1-out,flash:.7});
        }
      }
    }
  }
  private drawBursts(ctx:CanvasRenderingContext2D,motion:Resolution,elapsed:number) {
    let start=0;
    for(const step of motion.steps) {
      const age=elapsed-start-step.ticks*TICK_MS*.36;
      start+=step.ticks*TICK_MS;
      if(step.kind!=='clear' || age<0 || age>850) continue;
      const t=age/850;
      if(!this.reducedMotion) for(const [index,b] of step.blobs.entries()) {
        const x=b.x*S+24,y=b.toY*S+24;
        ctx.save();ctx.globalAlpha=(1-t)**2;ctx.strokeStyle=PALETTE[b.color];ctx.lineWidth=2.5*(1-t);
        ctx.beginPath();ctx.arc(x,y,12+easeOut(t)*42,0,Math.PI*2);ctx.stroke();
        for(let i=0;i<8;i++) {
          const angle=i*Math.PI/4+index*.73;
          const speed=28+((index*13+i*17)%27);
          const px=x+Math.cos(angle)*speed*easeOut(t),py=y+Math.sin(angle)*speed*easeOut(t)+50*t*t;
          ctx.fillStyle=i%3===0?'#fff8df':PALETTE[b.color];
          ctx.beginPath();ctx.ellipse(px,py,(i%3===0?2.5:4)*(1-t),(i%3===0?2.5:5)*(1-t),angle+t*2,0,Math.PI*2);ctx.fill();
        }
        ctx.restore();
      }
      const center=step.blobs.reduce((sum,b)=>sum+b.toY*S,0)/step.blobs.length;
      const y=clamp(center-20,90,HEIGHT*S-65)-(this.reducedMotion?0:easeOut(t)*32);
      const pop=this.reducedMotion?1:1+Math.sin(clamp(age/180)*Math.PI)*.16;
      ctx.save();ctx.translate(WIDTH*S/2,y);ctx.scale(pop,pop);ctx.globalAlpha=clamp((850-age)/250);
      ctx.textAlign='center';ctx.lineJoin='round';ctx.lineWidth=5;ctx.strokeStyle='#25233f';
      ctx.font='900 26px sans-serif';ctx.strokeText(`${step.chain} CHAIN!`,0,0);ctx.fillStyle=(step.chain??1)>1?'#ffe58f':'#fff';ctx.fillText(`${step.chain} CHAIN!`,0,0);
      ctx.font='bold 17px sans-serif';ctx.strokeText(`+${step.score}`,0,26);ctx.fillStyle='#d9c9ff';ctx.fillText(`+${step.score}`,0,26);ctx.restore();
    }
  }
}
