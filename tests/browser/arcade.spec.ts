import { test, expect } from '@playwright/test';
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
test('board gestures and held buttons drive the piece',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage(); await page.goto('/');
  await page.getByRole('button',{name:'게임 시작'}).click();
  await expect(page.locator('canvas')).toHaveAttribute('data-motion','falling');
  const canvas=page.locator('canvas'); const rect=(await canvas.boundingBox())!;
  const cell=rect.width/6, x=rect.x+rect.width/2, y=rect.y+rect.height/3;
  const swipe=async(points:[number,number][],gap=16)=>{
    await canvas.dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:points[0][0],clientY:points[0][1],button:0});
    for(const [px,py] of points.slice(1)){ await page.waitForTimeout(gap); await canvas.dispatchEvent('pointermove',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:px,clientY:py}); }
    const [ex,ey]=points.at(-1)!; await canvas.dispatchEvent('pointerup',{pointerId:1,pointerType:'touch',isPrimary:true,clientX:ex,clientY:ey,button:0});
  };
  // Bright pixels in a bottom cell mean a landed Puyo; the ghost is dim.
  const filled=(column:number)=>canvas.evaluate((el:HTMLCanvasElement,c)=>{const [r,g,b]=el.getContext('2d')!.getImageData(c*48+24,552,1,1).data;return r+g+b>330;},column);
  // Drag two cells left, then flick down to hard drop into column 0.
  await swipe([[x,y],[x-cell*0.7,y],[x-cell*1.7,y],[x-cell*2.2,y]]);
  await page.waitForTimeout(250);
  await swipe([[x,y],[x,y+cell*1.5],[x,y+cell*3]],10);
  await expect(canvas).not.toHaveAttribute('data-motion','falling');
  await expect(canvas).toHaveAttribute('data-motion','falling');
  // Holding a direction repeats it all the way to the wall.
  const right=page.getByRole('button',{name:'오른쪽 이동'}); const b=(await right.boundingBox())!;
  await right.dispatchEvent('pointerdown',{pointerId:2,pointerType:'touch',isPrimary:true,button:0,clientX:b.x+5,clientY:b.y+5});
  await page.waitForTimeout(600);
  await right.dispatchEvent('pointerup',{pointerId:2,pointerType:'touch',isPrimary:true,button:0});
  await page.getByRole('button',{name:'바로 놓기'}).dispatchEvent('pointerdown',{pointerId:3,pointerType:'touch',isPrimary:true,button:0});
  await expect(canvas).not.toHaveAttribute('data-motion','falling');
  await expect(canvas).toHaveAttribute('data-motion','falling');
  await page.waitForTimeout(300);
  expect([await filled(0),await filled(2),await filled(5)]).toEqual([true,false,true]);
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
