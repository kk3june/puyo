import { test, expect, type Page } from '@playwright/test';

// Two isolated browser contexts are two different anonymous players. The dev
// server has no Supabase, so matchmaking uses the in-memory store and the
// game itself runs over a real WebRTC data channel between the pages.
test('two players are matched, connect peer-to-peer, and agree on the winner', async ({ browser }) => {
  test.setTimeout(90_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [first, second] = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  for (const page of [first, second]) page.on('pageerror', error => errors.push(error.message));
  await Promise.all([first.goto('/versus'), second.goto('/versus')]);

  await first.getByRole('button', { name: '상대 찾기' }).click();
  await expect(first.getByRole('heading', { name: '상대를 찾는 중…' })).toBeVisible();
  await second.getByRole('button', { name: '상대 찾기' }).click();
  for (const page of [first, second]) await expect(page.locator('canvas[data-phase="playing"]')).toBeVisible({ timeout: 20_000 });

  // The first player stacks hard drops in the spawn column until topping out.
  const stack = async (page: Page) => {
    for (let i = 0; i < 40 && await page.locator('canvas[data-phase="playing"]').isVisible(); i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(450);
    }
  };
  await stack(first);
  await expect(first.getByRole('heading', { name: '패배' })).toBeVisible({ timeout: 10_000 });
  await expect(second.getByRole('heading', { name: '승리!' })).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
  await Promise.all(contexts.map(context => context.close()));
});

test('searching can be cancelled and leaves the queue', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [first, second] = await Promise.all(contexts.map(context => context.newPage()));
  await Promise.all([first.goto('/versus'), second.goto('/versus')]);
  await first.getByRole('button', { name: '상대 찾기' }).click();
  await expect(first.getByRole('heading', { name: '상대를 찾는 중…' })).toBeVisible();
  await first.getByRole('button', { name: '취소' }).click();
  await expect(first.getByRole('button', { name: '상대 찾기' })).toBeVisible();
  await second.getByRole('button', { name: '상대 찾기' }).click();
  await second.waitForTimeout(2500);
  await expect(second.getByRole('heading', { name: '상대를 찾는 중…' })).toBeVisible();
  await second.getByRole('button', { name: '취소' }).click();
  await Promise.all(contexts.map(context => context.close()));
});

test('versus fits a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/versus');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await expect(page.getByRole('button', { name: '상대 찾기' })).toBeVisible();
});
