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
  // Both players consented to analytics; the gtag script is stubbed so events
  // stay in window.dataLayer and never leave the browser.
  for (const context of contexts) {
    await context.addInitScript(() => localStorage.setItem('puyo-analytics', 'granted'));
    await context.route('https://www.googletagmanager.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  }
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

  const events = (page: Page) => page.evaluate(() => (window.dataLayer as ArrayLike<unknown>[]).filter(entry => entry[0] === 'event').map(entry => ({ name: entry[1], ...(entry[2] as object) })));
  const [mine, theirs] = await Promise.all([events(first), events(second)]);
  for (const log of [mine, theirs]) expect(log.map(event => event.name)).toEqual(expect.arrayContaining(['versus_search', 'versus_start', 'versus_end']));
  expect(mine.find(event => event.name === 'versus_end')).toMatchObject({ outcome: 'loss' });
  expect(theirs.find(event => event.name === 'versus_end')).toMatchObject({ outcome: 'win' });
  expect(new Set([...mine, ...theirs].filter(event => event.name === 'versus_start').map(event => (event as { role?: string }).role))).toEqual(new Set(['host', 'guest']));
  // Two local browsers always find a direct route; the dev server has no TURN key.
  expect([...mine, ...theirs].filter(event => event.name === 'versus_start').map(event => (event as { route?: string }).route)).toEqual(['direct', 'direct']);
  expect(JSON.stringify([mine, theirs])).not.toMatch(/matchId|puyo_guest|seed/);
  await Promise.all(contexts.map(context => context.close()));
});

test('a friend joins by invite link, and both can play again on the same connection', async ({ browser }) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, friend] = await Promise.all(contexts.map(context => context.newPage()));
  const errors: string[] = [];
  for (const page of [host, friend]) page.on('pageerror', error => errors.push(error.message));
  await host.goto('/versus');
  await host.getByRole('button', { name: '친구 초대' }).click();
  const code = (await host.locator('.invite-code').textContent())!.trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  await host.getByRole('button', { name: '링크 복사' }).isVisible();

  // A stranger searching at the same time is never paired with the invite.
  const strangerContext = await browser.newContext(); const stranger = await strangerContext.newPage();
  await stranger.goto('/versus'); await stranger.getByRole('button', { name: '상대 찾기' }).click();

  await friend.goto(`/versus?invite=${code}`);
  await expect(friend.getByRole('heading', { name: '친구의 초대' })).toBeVisible();
  await friend.getByRole('button', { name: '참가하기' }).click();
  for (const page of [host, friend]) await expect(page.locator('canvas[data-phase="playing"]')).toBeVisible({ timeout: 20_000 });
  expect(new URL(friend.url()).search, 'the used invite leaves the address bar').toBe('');
  await expect(stranger.getByRole('heading', { name: '상대를 찾는 중…' })).toBeVisible();
  await strangerContext.close();

  const stack = async (page: Page) => {
    for (let i = 0; i < 40 && await page.locator('canvas[data-phase="playing"]').isVisible(); i++) {
      await page.keyboard.press('Space'); await page.waitForTimeout(450);
    }
  };
  await stack(friend);
  await expect(friend.getByRole('heading', { name: '패배' })).toBeVisible({ timeout: 10_000 });
  await expect(host.getByRole('heading', { name: '승리!' })).toBeVisible({ timeout: 10_000 });

  // Rematch: the friend asks first, the host sees it and accepts.
  await friend.getByRole('button', { name: '한 판 더' }).click();
  await expect(friend.getByRole('button', { name: '친구 기다리는 중…' })).toBeDisabled();
  await expect(host.getByText('친구가 한 판 더 하고 싶어 해요!')).toBeVisible();
  await host.getByRole('button', { name: '한 판 더' }).click();
  for (const page of [host, friend]) await expect(page.locator('canvas[data-phase="playing"]')).toBeVisible({ timeout: 10_000 });

  // Leaving after the game tells the other side; it cannot ask for another.
  await stack(host);
  await expect(host.getByRole('heading', { name: '패배' })).toBeVisible({ timeout: 10_000 });
  await expect(friend.getByRole('heading', { name: '승리!' })).toBeVisible({ timeout: 10_000 });
  await host.getByRole('button', { name: '나가기' }).click();
  await expect(friend.getByText('친구가 나갔어요.')).toBeVisible();
  expect(errors).toEqual([]);
  await Promise.all(contexts.map(context => context.close()));
});

test('an expired or used invite explains itself, and your own link cannot be joined', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, friend] = await Promise.all(contexts.map(context => context.newPage()));
  await friend.goto('/versus?invite=ZZZZ22');
  await friend.getByRole('button', { name: '참가하기' }).click();
  await expect(friend.getByText('초대가 만료됐거나 이미 다른 사람이 들어갔어요.', { exact: false })).toBeVisible();
  await host.goto('/versus');
  await host.getByRole('button', { name: '친구 초대' }).click();
  const code = (await host.locator('.invite-code').textContent())!.trim();
  const self = await contexts[0].newPage();
  await self.goto(`/versus?invite=${code}`);
  await self.getByRole('button', { name: '참가하기' }).click();
  await expect(self.getByText('내가 만든 초대 링크예요.', { exact: false })).toBeVisible();
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

test('relay credentials are only issued to match players', async ({ request }) => {
  const outsider = await request.get('/api/versus/ice?matchId=00000000-0000-4000-8000-000000000000');
  expect(outsider.status()).toBe(403);
  expect((await request.get('/api/versus/ice?matchId=nope')).status()).toBe(400);
});
