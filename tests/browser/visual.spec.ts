import { test, expect } from '@playwright/test';
test('capture desktop and mobile layout',async({page},testInfo)=>{
  await page.addInitScript(()=>localStorage.setItem('puyo-analytics','denied'));
  await page.setViewportSize({width:1440,height:1150});
  await page.goto('/');
  await expect(page.getByText('곧, 기록으로 만나요')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:testInfo.outputPath('mobile.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
