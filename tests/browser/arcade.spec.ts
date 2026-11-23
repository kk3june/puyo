import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
test('guest can play, finish, and recover a pending result without a backend', async ({page}) => {
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button',{name:'카카오로 로그인',exact:true})).toBeDisabled();
  await expect(page.getByText('곧, 기록으로 만나요')).toBeVisible();
  await page.getByRole('button',{name:'게임 시작'}).click();
  await expect(page.getByRole('button',{name:'게임 시작'})).not.toBeVisible();
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(70);
  for(let i=0;i<24 && !(await page.getByRole('heading',{name:'이번 기록'}).isVisible());i++){
    await page.keyboard.press('Space');
    await page.waitForTimeout(80);
    await page.waitForFunction(()=>['falling','done'].includes(document.querySelector('canvas')?.dataset.motion ?? ''));
  }
  await expect(page.getByRole('heading',{name:'이번 기록'})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'이번 기록'})).toBeVisible();
  await page.getByRole('button',{name:'한 번 더 플레이'}).click();
  await expect(page.getByRole('heading',{name:'이번 기록'})).not.toBeVisible();
  expect(errors).toEqual([]);
});
test('mobile fits viewport and touch controls play',async({page})=>{
  await page.setViewportSize({width:390,height:844}); await page.goto('/');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button',{name:'게임 시작'}).click();
  await page.getByRole('button',{name:'회전',exact:true}).click();
  await page.getByRole('button',{name:'왼쪽 이동'}).click();
  await page.getByRole('button',{name:'바로 놓기'}).click();
  await expect(page.getByRole('button',{name:'오른쪽 이동'})).toBeEnabled();
});
test('short phones keep the board and controls on one screen',async({page})=>{
  await page.setViewportSize({width:375,height:667}); await page.goto('/');
  await page.getByRole('button',{name:'게임 시작'}).click();
  await page.waitForTimeout(800);
  const box=await page.locator('.touch-controls').boundingBox();
  expect(box && box.y+box.height).toBeLessThanOrEqual(667);
});
// Touch helpers: a phone-sized touch context with a chosen control mode.
const phone=async(browser:Browser,mode:'buttons'|'gesture')=>{
  const context=await browser.newContext({viewport:{width:390,height:664},hasTouch:true,isMobile:true});
  await context.addInitScript(m=>localStorage.setItem('puyo-controls',m),mode);
  const page=await context.newPage(); await page.goto('/');
  return {context,page,canvas:page.locator('canvas')};
};
const swipeOn=(page:Page,target:Locator)=>async(points:[number,number][],gap=16)=>{
  await target.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:points[0][0],clientY:points[0][1],button:0});
  for(const [px,py] of points.slice(1)){ await page.waitForTimeout(gap); await target.dispatchEvent('pointermove',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:px,clientY:py}); }
  const [ex,ey]=points.at(-1)!; await target.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:ex,clientY:ey,button:0});
};
// Bright pixels in a bottom cell mean a landed Puyo; the ghost is dim.
const filled=(canvas:Locator,column:number)=>canvas.evaluate((el:HTMLCanvasElement,c)=>{const [r,g,b]=el.getContext('2d')!.getImageData(c*48+24,552,1,1).data;return r+g+b>330;},column);
const layoutOf=(page:Page)=>page.evaluate(()=>{
  const box=(selector:string)=>{const el=document.querySelector(selector) as HTMLElement|null;if(!el||!el.offsetParent)return null;const r=el.getBoundingClientRect();return [r.left,r.top,r.right,r.bottom].map(v=>Math.round(v)+0);};
  return {card:box('.game-card'),board:box('.playfield'),pad:box('.touch-controls'),vw:innerWidth,vh:innerHeight};
});

test('touch layout is the same before and during play, one screen tall and edge to edge',async({browser})=>{
  for(const mode of ['buttons','gesture'] as const){
    const {context,page,canvas}=await phone(browser,mode);
    await page.locator('.game-card').evaluate(el=>scrollTo({top:el.getBoundingClientRect().top+scrollY,behavior:'instant'}));
    const before=await layoutOf(page);
    await page.getByRole('button',{name:'게임 시작'}).click();
    await expect(canvas).toHaveAttribute('data-motion','falling');
    const during=await layoutOf(page);
    expect(during,mode).toEqual(before);
    expect(during.card).toEqual([0,0,during.vw,during.vh]);
    if(mode==='buttons'){
      const [left,,right,bottom]=during.pad!;
      expect([left,right,bottom]).toEqual([0,during.vw,during.vh]);
      const gaps=await page.evaluate(()=>{const b=[...document.querySelectorAll('.touch-controls button')].map(el=>el.getBoundingClientRect());return b.slice(1).map((r,i)=>Math.round(r.left-b[i].right));});
      expect(gaps.every(gap=>gap===0)).toBe(true);
    } else expect(during.pad).toBeNull();
    await expect(page.getByRole('group',{name:'조작 방식'}).getByRole('button').first()).toBeDisabled();
    expect(await page.evaluate(()=>{const before=scrollY;scrollBy(0,400);return scrollY-before;})).toBe(0);
    await context.close();
  }
});

test('gesture mode: swipes anywhere above the board area drive the piece',async({browser})=>{
  const {context,page,canvas}=await phone(browser,'gesture');
  await page.getByRole('button',{name:'게임 시작'}).click();
  await expect(canvas).toHaveAttribute('data-motion','falling');
  // Start beside the board, on the stats column: two cells left, then flick down.
  const stats=page.locator('.game-stats'); const s=(await stats.boundingBox())!, cell=(await canvas.boundingBox())!.width/6;
  const swipe=swipeOn(page,stats), x=s.x+s.width/2+cell*2.5, y=s.y+s.height/2;
  await swipe([[x,y],[x-cell*0.7,y],[x-cell*1.7,y],[x-cell*2.2,y]]);
  await page.waitForTimeout(250);
  await swipe([[x,y],[x,y+cell*1.5],[x,y+cell*3]],10);
  await expect(canvas).not.toHaveAttribute('data-motion','falling');
  await expect(canvas).toHaveAttribute('data-motion','falling');
  await page.waitForTimeout(300);
  expect([await filled(canvas,0),await filled(canvas,2)]).toEqual([true,false]);
  await context.close();
});

test('button mode: held buttons repeat and board swipes are ignored',async({browser})=>{
  const {context,page,canvas}=await phone(browser,'buttons');
  await page.getByRole('button',{name:'게임 시작'}).click();
  await expect(canvas).toHaveAttribute('data-motion','falling');
  // A flick that would hard drop in gesture mode does nothing here.
  const r=(await canvas.boundingBox())!, cell=r.width/6, x=r.x+r.width/2, y=r.y+r.height/3;
  await swipeOn(page,canvas)([[x,y],[x,y+cell*1.5],[x,y+cell*3]],10);
  await page.waitForTimeout(300);
  await expect(canvas).toHaveAttribute('data-motion','falling');
  // Holding a direction repeats it all the way to the wall, then drop.
  const right=page.getByRole('button',{name:'오른쪽 이동'}); const b=(await right.boundingBox())!;
  await right.dispatchEvent('pointerdown',{pointerId:2,pointerType:'touch',isPrimary:true,button:0,clientX:b.x+5,clientY:b.y+5});
  await page.waitForTimeout(600);
  await right.dispatchEvent('pointerup',{pointerId:2,pointerType:'touch',isPrimary:true,button:0});
  await page.getByRole('button',{name:'바로 놓기'}).dispatchEvent('pointerdown',{pointerId:3,pointerType:'touch',isPrimary:true,button:0});
  await expect(canvas).not.toHaveAttribute('data-motion','falling');
  await expect(canvas).toHaveAttribute('data-motion','falling');
  await page.waitForTimeout(300);
  expect([await filled(canvas,2),await filled(canvas,5)]).toEqual([false,true]);
  await context.close();
});

test('the control mode choice is remembered on this device',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:664},hasTouch:true,isMobile:true});
  const page=await context.newPage(); await page.goto('/');
  const group=page.getByRole('group',{name:'조작 방식'});
  await expect(group.getByRole('button',{name:'버튼'})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.touch-controls')).toBeVisible();
  await group.getByRole('button',{name:'제스처'}).click();
  await expect(page.locator('.touch-controls')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('group',{name:'조작 방식'}).getByRole('button',{name:'제스처'})).toHaveAttribute('aria-pressed','true');
  await context.close();
});

test('score writes are unavailable without backend; start rejects foreign origins',async({request})=>{
  const rejected=await request.post('/api/game/start',{headers:{Origin:'https://foreign.example'}}); expect(rejected.status()).toBe(403);
  const score=await request.post('/api/scores',{headers:{Origin:'http://localhost:3217'},data:{score:999999}}); expect(score.status()).toBe(503);
  const start=await request.post('/api/game/start',{headers:{Origin:'http://localhost:3217'}}); expect(start.ok()).toBe(true); expect((await start.json()).ranked).toBe(false);
});
test('analytics only loads after consent and records gameplay without identity',async({page})=>{
  let loads=0;
  await page.route('https://www.googletagmanager.com/**', async route=>{loads++;await route.fulfill({contentType:'application/javascript',body:'/* test stub: no events leave this browser */'});});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'분석 허용'})).toBeVisible();
  expect(loads).toBe(0);
  await page.getByRole('button',{name:'분석 허용'}).click();
  await expect.poll(()=>loads).toBe(1);
  await page.getByRole('button',{name:'게임 시작'}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.stringify(window.dataLayer))).toContain('game_start');
  const events=await page.evaluate(()=>JSON.stringify(window.dataLayer));
  expect(events).not.toContain('user_id'); expect(events).not.toContain('email');
  await page.getByRole('button',{name:'분석 설정'}).click();
  await page.getByRole('button',{name:'거절',exact:true}).click();
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('puyo-analytics'))).toBe('denied');
  expect(loads).toBe(1);
});
