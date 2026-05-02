import { chromium } from 'playwright';

const baseUrl = process.env.JIAYE_URL ?? 'http://127.0.0.1:5173/';
const storageKey = 'jiaye-tianxia-save-v1';

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: 'dark'
});
const page = await context.newPage();
const imageRequests = [];
page.on('request', (request) => {
  if (request.resourceType() === 'image') {
    imageRequests.push(request.url());
  }
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate((key) => localStorage.removeItem(key), storageKey);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectText(page, '家业天下');

  await page.getByRole('button', { name: '开始游戏' }).click();
  await expectText(page, '乱世择主');
  await page.getByRole('button', { name: '确认选择' }).click();
  await expectText(page, '良缘入府', 7000);
  await page.getByRole('button', { name: '携美人，共创家业' }).click();
  await expectText(page, '升级宅邸', 7000);
  await page.getByRole('button', { name: '招募伴侣' }).click();
  await expectText(page, '伴侣招募');
  await expectEnabled(page.getByRole('button', { name: /召集/ }).first());
  await page.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: /升级宅邸/ }).click();
  await expectText(page, '木屋', 4000);
  await expectText(page, '家业目标');
  await page.getByRole('button', { name: '领赏' }).first().click();
  await expectText(page, '目标达成');

  await setSave(page, {
    screen: 'home',
    selectedLordId: 'caocao',
    gold: 8000,
    homeLevel: 2,
    equippedWeaponId: 'xuanjian',
    ownedPartnerIds: [],
    day: 8,
    battleWins: 0,
    battleLosses: 0,
    soundEnabled: false,
    lastScreen: 'home',
    lastSavedAt: Date.now() - 120000
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectText(page, '离线经营');
  await page.getByRole('button', { name: '设置与存档' }).click();
  await expectText(page, '当前存档');
  await page.getByLabel('粘贴存档 JSON').fill(
    JSON.stringify({
      screen: 'home',
      selectedLordId: 'sunquan',
      gold: 6600,
      homeLevel: 3,
      equippedWeaponId: 'qinggang',
      ownedPartnerIds: ['daqiao'],
      claimedQuestIds: ['upgrade-wood'],
      day: 12,
      battleWins: 1,
      battleLosses: 0,
      soundEnabled: false,
      tutorialDone: true,
      lastScreen: 'home',
      eventLog: [],
      lastSavedAt: Date.now()
    })
  );
  await page.getByRole('button', { name: '导入存档' }).click();
  await expectText(page, '已导入第 12 天存档。');
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '招募伴侣' }).click();
  await expectText(page, '伴侣招募');
  await page.getByRole('button', { name: /召集/ }).first().click();
  await expectText(page, '已招募');
  await page.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: '兵器库' }).click();
  await expectText(page, '兵器库');
  await page.getByRole('button', { name: /^装备$/ }).first().click();
  await expectText(page, '已装备', 4000);
  await page.getByRole('button', { name: '关闭' }).click();

  await setSave(page, {
    screen: 'home',
    selectedLordId: 'lvbu',
    gold: 12000,
    homeLevel: 4,
    equippedWeaponId: 'fangtian',
    ownedPartnerIds: ['diaochan', 'zhurong'],
    day: 18,
    battleWins: 1,
    battleLosses: 0,
    soundEnabled: false,
    lastScreen: 'home',
    claimedQuestIds: ['first-win'],
    eventLog: [],
    lastSavedAt: Date.now()
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await expectText(page, '九州征途');
  await page.getByRole('button', { name: '携伴侣出征' }).click();
  await expectText(page, '匹配敌军', 9000);
  await expectText(page, /返回家业|鸣金收兵/, 30000);
  const returnButton = page.getByRole('button', { name: '返回家业' });
  if (await returnButton.isVisible().catch(() => false)) {
    await returnButton.click();
  } else {
    await page.getByRole('button', { name: '鸣金收兵' }).click();
    await page.getByRole('button', { name: '返回家业' }).click();
  }
  await expectText(page, '主城经营');
  assertOptimizedImages(imageRequests);

  console.log('smoke_ok');
} finally {
  await browser.close();
}

async function expectText(page, text, timeout = 5000) {
  await page.getByText(text).first().waitFor({ state: 'visible', timeout });
}

async function expectEnabled(locator, timeout = 5000) {
  await locator.waitFor({ state: 'visible', timeout });
  const enabled = await locator.isEnabled();
  if (!enabled) {
    throw new Error('smoke_expected_enabled_partner_button');
  }
}

async function launchBrowser() {
  const launchTargets = [{ label: 'Playwright Chromium', options: { headless: true } }];
  if (process.env.JIAYE_USE_SYSTEM_CHROME === '1') {
    launchTargets.push({ label: 'system Chrome', options: { channel: 'chrome', headless: true } });
  }
  const errors = [];

  for (const target of launchTargets) {
    try {
      return await chromium.launch(target.options);
    } catch (error) {
      errors.push({ label: target.label, error });
    }
  }

  console.error('smoke_browser_launch_failed');
  console.error('Unable to start a Playwright browser. The published game may still be healthy.');
  console.error('Install the bundled browser with `npx playwright install chromium`.');
  console.error('System Chrome is disabled by default to avoid macOS crash reports under Codex; opt in with `JIAYE_USE_SYSTEM_CHROME=1` only outside the sandbox.');
  for (const item of errors) {
    console.error(`- ${item.label}: ${firstErrorLine(item.error)}`);
  }
  process.exit(1);
}

function firstErrorLine(error) {
  return error instanceof Error ? error.message.split('\n')[0] : String(error);
}

function assertOptimizedImages(imageRequests) {
  const slowProxyRequests = imageRequests.filter((url) => url.includes('wsrv.nl'));
  if (slowProxyRequests.length > 0) {
    throw new Error(`smoke_slow_image_proxy_requests ${slowProxyRequests.slice(0, 3).join(', ')}`);
  }

  const optimizedRequests = imageRequests.filter((url) => url.includes('/optimized/'));
  if (optimizedRequests.length === 0) {
    throw new Error('smoke_missing_optimized_image_requests');
  }
}

async function setSave(page, save) {
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: save }
  );
}
