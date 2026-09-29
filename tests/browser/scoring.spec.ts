import {test,expect} from '@playwright/test';
test('soft-drop points are visible immediately and natural falling adds no points',async({page})=>{
  await page.clock.install({time:new Date('2026-09-28T00:00:00Z')});
  await page.addInitScript(()=>localStorage.setItem('puyo-analytics','denied'));
  await page.route('**/api/game/start',route=>route.fulfill({json:{seed:42,token:null,ranked:false}}));
  await page.goto('/');
  await expect(page.getByRole('button',{name:'게임 시작'})).toBeVisible();
  await page.clock.pauseAt(new Date('2026-09-28T01:00:00Z'));
  await page.getByRole('button',{name:'게임 시작'}).click();
  await expect(page.locator('canvas')).toHaveAttribute('data-motion','falling');
  await page.keyboard.press('ArrowDown');await page.clock.runFor(100);
  await expect(page.getByLabel('현재 점수')).toHaveText('1');
  await page.clock.runFor(1000);
  await expect(page.getByLabel('현재 점수')).toHaveText('1');
  await page.keyboard.press('Space');await page.clock.runFor(600);
  await expect(page.getByLabel('현재 점수')).toHaveText('1');
});
