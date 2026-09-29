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
  await page.getByRole('button',{name:'바로 놓기 ↓'}).click();
  await expect(page.getByRole('button',{name:'오른쪽 이동'})).toBeEnabled();
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
