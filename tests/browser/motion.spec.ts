import { test, expect } from '@playwright/test';

for (const reducedMotion of ['no-preference','reduce'] as const) {
  test(`drop, squash and burst are sequenced with correct scores (${reducedMotion})`, async ({page},testInfo)=>{
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.emulateMedia({reducedMotion});
    await page.clock.install({time:new Date('2026-09-28T00:00:00Z')});
    await page.addInitScript(()=>localStorage.setItem('puyo-analytics','denied'));
    // Seed 2 starts with four green blobs; two vertical drops make one clear.
    await page.route('**/api/game/start',route=>route.fulfill({json:{seed:2,token:null,ranked:false}}));
    await page.goto('/');
    await expect(page.getByRole('button',{name:'게임 시작'})).toBeVisible();
    await page.clock.pauseAt(new Date('2026-09-28T01:00:00Z'));
    await page.getByRole('button',{name:'게임 시작'}).click();
    const canvas=page.locator('canvas');
    await expect(canvas).toHaveAttribute('data-motion','falling');
    await page.clock.runFor(100);
    const first=await canvas.evaluate(el=>(el as HTMLCanvasElement).toDataURL());
    await page.clock.runFor(32);
    expect(await canvas.evaluate(el=>(el as HTMLCanvasElement).toDataURL())).not.toBe(first);
    await page.keyboard.press('Space');await page.clock.runFor(100);
    await expect(canvas).toHaveAttribute('data-motion','drop');
    if(reducedMotion==='no-preference') await canvas.screenshot({path:testInfo.outputPath('01-drop.png')});
    await page.clock.runFor(150);
    await expect(canvas).toHaveAttribute('data-motion','land');
    if(reducedMotion==='no-preference') await canvas.screenshot({path:testInfo.outputPath('02-land.png')});
    await page.clock.runFor(200);
    await expect(canvas).toHaveAttribute('data-motion','falling');
    await page.keyboard.press('Space');await page.clock.runFor(380);
    await expect(canvas).toHaveAttribute('data-motion','clear');
    await expect(page.getByLabel('현재 점수')).toHaveText('0');
    await page.clock.runFor(140);
    await expect(page.getByLabel('현재 점수')).toHaveText('40');
    if(reducedMotion==='no-preference') await canvas.screenshot({path:testInfo.outputPath('03-burst.png')});
    await page.clock.runFor(500);
    await expect(canvas).toHaveAttribute('data-motion','falling');
    await expect(page.getByLabel('현재 점수')).toHaveText('40');
    expect(errors).toEqual([]);
  });
}

test('background-tab elapsed time catches up without leaving animation stuck',async({page})=>{
  await page.clock.install();
  await page.addInitScript(()=>localStorage.setItem('puyo-analytics','denied'));
  await page.goto('/');await page.getByRole('button',{name:'게임 시작'}).click();
  await expect(page.locator('canvas')).toHaveAttribute('data-motion','falling');
  await page.keyboard.press('Space');
  await page.clock.runFor(100);
  await page.clock.fastForward(181_000);
  await page.clock.runFor(1500);
  await expect(page.getByRole('heading',{name:'이번 기록'})).toBeVisible();
});
