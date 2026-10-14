import { chromium } from 'playwright';

const baseUrl = process.env.JIAYE_URL ?? 'http://127.0.0.1:5173/';
const storageKey = 'jiaye-tianxia-save-v1';

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: 'dark'
});
// 冒烟按「玩家当地主」写，跳过叫地主；叫地主流程在 scenarios 里单独测
await context.addInitScript(() => { try { localStorage.setItem('jiaye-ddz-skip-bid', '1'); localStorage.setItem('jiaye-ddz-turn-seconds', '0'); } catch { /* ignore */ } });
const page = await context.newPage();
// 本地模拟 CI 慢机器：JIAYE_CPU_THROTTLE=4 表示 CPU 降到 1/4
const cpuThrottle = Number(process.env.JIAYE_CPU_THROTTLE || 0);
if (cpuThrottle > 1) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
}
page.on('dialog', (dialog) => dialog.accept());
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
  await page.getByRole('button', { name: '伴侣', exact: true }).click();
  await expectText(page, '伴侣招募');
  await expectEnabled(page.getByRole('button', { name: /召集/ }).first());
  await page.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: /升级宅邸/ }).click();
  await expectText(page, '木屋', 4000);
  await expectText(page, '家业目标');
  await page.locator('.home-tiles button').first().click();
  await page.getByRole('button', { name: '领赏', exact: true }).first().click();
  await expectText(page, '目标达成');
  await page.getByRole('dialog', { name: '家业目标' }).getByRole('button', { name: '关闭' }).click();

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
    lastSavedAt: Date.now() - 2 * 3600 * 1000
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectText(page, '离线经营');
  // 离线期间挂起的府中事件会直接弹窗，先收起再去设置
  const later = page.getByRole('button', { name: '稍后再说' });
  if (await later.isVisible().catch(() => false)) await later.click();
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
  await expectText(page, '已导入第 12 日存档。');
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '伴侣', exact: true }).click();
  await expectText(page, '伴侣招募');
  await page.getByRole('button', { name: /召集/ }).first().click();
  await expectText(page, '已招募');
  await page.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('button', { name: '兵器', exact: true }).click();
  await expectText(page, '兵器库');
  await page.getByRole('button', { name: /^装备$/ }).first().click();
  await expectText(page, '已装备', 4000);
  await page.getByRole('button', { name: '关闭' }).click();

  await setSave(page, {
    screen: 'home',
    selectedLordId: 'lvbu',
    gold: 12000,
    homeLevel: 4,
    // 战力 183：够中级场（140），不够高级场（190），用来验证场次门槛
    equippedWeaponId: 'qinglong',
    ownedPartnerIds: ['diaochan'],
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
  await page.getByRole('button', { name: '出征', exact: true }).click();
  // 出征直达斗地主选场，地图收在「其他战场」
  await page.getByRole('button', { name: /^进入斗地主/ }).waitFor({ state: 'visible', timeout: 7000 });
  await page.getByRole('button', { name: '其他战场 ›' }).click();
  await expectText(page, '九州征途');
  await assertExpeditionModes(page);
  await assertVenueGate(page);
  await page.getByRole('button', { name: /中级场/ }).click();
  await expectText(page, '本场胜缴获 8,000 金');
  await page.getByRole('button', { name: '进入斗地主' }).click();
  await expectText(page, '斗地主牌局', 9000);
  await expectText(page, '底牌');
  await page.locator('.ddz-seat--left .ddz-seat__name').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.ddz-seat--right .ddz-seat__name').waitFor({ state: 'visible', timeout: 5000 });
  await assertPortraitDoudizhuFits(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await assertLandscapeTable(page);
  await assertPlayerHandFits(page);
  await assertThreeSeatActions(page);
  await assertVisibleCardCornerSelection(page);
  await clickHand(page, { x: 32, y: 72 });
  await assertPlayerHandFits(page);
  await page.getByRole('button', { name: '出牌' }).click();
  await expectText(page, '19 张');
  await page.getByRole('button', { name: /^认输/ }).click();
  await expectText(page, '处理政务');
  assertOptimizedImages(imageRequests);

  console.log('smoke_ok');
} catch (error) {
  // CI 里输出成 GitHub 注解，失败原因不登录也能在检查结果里看到；顺手留一张失败截图
  if (process.env.GITHUB_ACTIONS) {
    console.log(`::error title=smoke::${String(error?.message ?? error).split('\n').slice(0, 3).join(' | ').slice(0, 900)}`);
    await page.screenshot({ path: 'smoke-failure.png' }).catch(() => {});
  }
  throw error;
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

async function assertPlayerHandFits(page) {
  const fit = await page.locator('.player-hand').evaluate((hand) => {
    const cards = [...hand.querySelectorAll('.poker-card')];
    const handBox = hand.getBoundingClientRect();
    const cardBoxes = cards.map((card) => card.getBoundingClientRect());
    const first = cardBoxes[0];
    const last = cardBoxes.at(-1);
    const offscreenCards = cardBoxes.filter((box) => box.left < handBox.left - 1 || box.right > handBox.right + 1);

    return {
      cardCount: cards.length,
      firstLeft: first?.left ?? 0,
      lastRight: last?.right ?? 0,
      handLeft: handBox.left,
      handRight: handBox.right,
      offscreenCount: offscreenCards.length
    };
  });

  if (fit.cardCount < 17 || fit.offscreenCount > 0) {
    throw new Error(`smoke_player_hand_overflows ${JSON.stringify(fit)}`);
  }
}

/**
 * CI 上三次偶发「点手牌超时」，本地降速 4~8 倍都复现不了：
 * 先等手牌里真有牌再点；仍超时就把当时的牌桌文字与手牌状态写进报错，方便从 CI 注解里看现场。
 */
async function clickHand(page, position) {
  await page.locator('.player-hand .poker-card').first().waitFor({ state: 'visible', timeout: 15000 });
  try {
    await page.locator('.player-hand').click({ position, timeout: 15000 });
    return;
  } catch (error) {
    // CI 上偶发「点手牌超时」而本地复现不了：记下点击点上实际是哪个元素、手牌是否在动，再强制点一次
    const box = await page.locator('.player-hand').boundingBox();
    const scene = await page.evaluate(({ x, y }) => {
      const top = document.elementFromPoint(x, y);
      const hand = document.querySelector('.player-hand');
      return {
        topAtPoint: top ? `${top.tagName.toLowerCase()}.${String(top.className).trim().replace(/\s+/g, '.')}` : 'none',
        insideHand: Boolean(hand && top && hand.contains(top)),
        animations: document.getAnimations().filter((a) => a.playState === 'running').map((a) => `${a.animationName ?? a.constructor.name}@${a.effect?.target?.className ?? ''}`).slice(0, 6),
        cards: document.querySelectorAll('.player-hand .poker-card').length
      };
    }, { x: (box?.x ?? 0) + position.x, y: (box?.y ?? 0) + position.y }).catch(() => null);
    const log = String(error?.message ?? error).split('\n').filter((line) => /intercepts|not stable|not visible|outside|waiting/.test(line)).slice(0, 4).join(' | ');
    console.log(`::warning title=smoke_click_hand_retry::${JSON.stringify(scene)} ${log}`.slice(0, 900));
    try {
      await page.locator('.player-hand').click({ position, timeout: 5000, force: true });
    } catch (forced) {
      throw new Error(`smoke_click_hand_failed ${JSON.stringify(scene)} ${log}`);
    }
  }
}

async function assertThreeSeatActions(page) {
  const seats = await page.$$eval('.ddz-seat', (items) => items.map((seat) => ({
    name: seat.querySelector('.ddz-seat__name')?.textContent?.trim(),
    action: seat.querySelector('.ddz-seat__action')?.textContent?.trim(),
    badge: seat.querySelector('.ddz-seat__badge')?.textContent?.trim()
  })));

  if (seats.length !== 3 || seats.some((seat) => !seat.name || !seat.action || !seat.badge)) {
    throw new Error(`smoke_three_seat_actions_missing ${JSON.stringify(seats)}`);
  }
}

async function assertVisibleCardCornerSelection(page) {
  const cards = await page.$$('.player-hand .poker-card');
  if (cards.length < 5) {
    throw new Error(`smoke_not_enough_hand_cards ${cards.length}`);
  }

  const targetIndex = Math.floor(cards.length / 2);
  await clickCardCorner(page, targetIndex - 1);
  await clickCardCorner(page, targetIndex + 1);
  const targetId = await clickCardCorner(page, targetIndex);

  const selected = await page.$$eval('.player-hand .poker-card', (elements) => elements
    .filter((element) => element.classList.contains('is-selected'))
    .map((element) => ({
      id: element.getAttribute('data-card-id'),
      rank: element.getAttribute('data-rank'),
      suit: element.getAttribute('data-suit')
    })));

  if (selected.length !== 3 || !selected.some((card) => card.id === targetId)) {
    throw new Error(`smoke_visible_card_corner_selection_failed ${JSON.stringify({ targetId, selected })}`);
  }

  await page.getByRole('button', { name: '重选' }).click();
}

async function clickCardCorner(page, index) {
  const data = await page.locator('.player-hand .poker-card').nth(index).evaluate((card) => {
    const hand = card.closest('.player-hand');
    if (!hand) {
      throw new Error('smoke_missing_player_hand');
    }
    const cardBox = card.getBoundingClientRect();
    const handBox = hand.getBoundingClientRect();
    return {
      id: card.getAttribute('data-card-id'),
      x: cardBox.left - handBox.left + 12,
      y: cardBox.top - handBox.top + 22
    };
  });
  await clickHand(page, { x: data.x, y: data.y });
  return data.id;
}

async function assertLandscapeTable(page) {
  const layout = await page.evaluate(() => {
    const shell = document.querySelector('.phone-shell')?.getBoundingClientRect();
    const tip = document.querySelector('.orientation-tip');
    return {
      shellWidth: shell?.width ?? 0,
      shellHeight: shell?.height ?? 0,
      tipDisplay: tip ? getComputedStyle(tip).display : ''
    };
  });

  if (layout.shellWidth <= layout.shellHeight || (layout.tipDisplay !== 'none' && layout.tipDisplay !== '')) {
    throw new Error(`smoke_doudizhu_landscape_layout_failed ${JSON.stringify(layout)}`);
  }
}

async function assertPortraitDoudizhuFits(page) {
  const layout = await page.evaluate(() => {
    const shell = document.querySelector('.phone-shell')?.getBoundingClientRect();
    const hand = document.querySelector('.player-hand')?.getBoundingClientRect();
    const actions = document.querySelector('.ddz-actions')?.getBoundingClientRect();
    const seats = [...document.querySelectorAll('.ddz-seat')].map((seat) => {
      const box = seat.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        action: seat.querySelector('.ddz-seat__action')?.textContent?.trim() ?? ''
      };
    });

    return {
      shellTop: shell?.top ?? 0,
      shellBottom: shell?.bottom ?? 0,
      handTop: hand?.top ?? 0,
      handBottom: hand?.bottom ?? 0,
      actionsTop: actions?.top ?? 0,
      actionsBottom: actions?.bottom ?? 0,
      seatCount: seats.length,
      seats
    };
  });

  const visibleBottom = layout.shellBottom + 1;
  const visibleTop = layout.shellTop - 1;
  const handVisible = layout.handTop >= visibleTop && layout.handBottom <= visibleBottom;
  const actionsVisible = layout.actionsTop >= visibleTop && layout.actionsBottom <= visibleBottom;
  const seatsVisible = layout.seatCount === 3 && layout.seats.every((seat) => seat.action && seat.top >= visibleTop && seat.bottom <= visibleBottom);

  if (!handVisible || !actionsVisible || !seatsVisible) {
    throw new Error(`smoke_portrait_doudizhu_not_playable ${JSON.stringify(layout)}`);
  }
}

async function assertExpeditionModes(page) {
  const doudizhu = page.getByRole('button', { name: /荆州/ });
  const autoBattle = page.getByRole('button', { name: /官道/ });
  await doudizhu.waitFor({ state: 'visible', timeout: 5000 });
  await autoBattle.waitFor({ state: 'visible', timeout: 5000 });

  if (!(await doudizhu.isEnabled())) {
    throw new Error('smoke_doudizhu_region_should_be_available');
  }

  if (!(await autoBattle.isEnabled())) {
    throw new Error('smoke_auto_battle_region_should_be_available');
  }
}

async function assertVenueGate(page) {
  const middle = page.getByRole('button', { name: /中级场/ });
  const high = page.getByRole('button', { name: /高级场/ });
  await middle.waitFor({ state: 'visible', timeout: 5000 });
  await high.waitFor({ state: 'visible', timeout: 5000 });

  if (!(await middle.isEnabled())) {
    throw new Error('smoke_middle_venue_should_be_available');
  }

  if (!(await high.isDisabled())) {
    throw new Error('smoke_high_venue_should_be_power_locked');
  }
}

async function setSave(page, save) {
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: save }
  );
}
