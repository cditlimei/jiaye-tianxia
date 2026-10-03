/**
 * 场景回归：直接写入 localStorage 存档，再断言页面与存档。
 * 覆盖 smoke 之外的分支：存档/离线/多标签、任务与门槛、兵器购买、智谋声望、斗地主整局与认输。
 * 用法: JIAYE_URL=http://127.0.0.1:4173/ node scripts/scenarios.mjs   （需先 npm run build && npm run preview）
 */
import { chromium } from 'playwright';

const URL = process.env.JIAYE_URL ?? 'http://127.0.0.1:5173/';
const KEY = 'jiaye-tianxia-save-v1';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${detail}` : ''}`);
};
const save = (extra = {}) => ({
  screen: 'home', selectedLordId: 'lvbu', gold: 5000, homeLevel: 2, equippedWeaponId: 'xuanjian', ownedPartnerIds: ['diaochan'],
  claimedQuestIds: [], day: 11, battleWins: 0, battleLosses: 0, soundEnabled: false, tutorialDone: true, lastScreen: 'home',
  eventLog: [], lastSavedAt: Date.now(), ...extra
});

const browser = await chromium.launch({ headless: true });

async function open(state, contextOptions = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...contextOptions });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  if (state) {
    await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, state]);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  return page;
}
const read = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const income = (text) => Number(text.match(/\+([\d,]+)金/)[1].replace(/,/g, ''));

async function scenario(name, fn) {
  try {
    await fn();
  } catch (error) {
    check(`${name}（脚本异常）`, false, error.message.split('\n')[0]);
  }
}

await scenario('存档安全', async () => {
  // 心跳刷新：页面开着 16s 后 lastSavedAt 前进，刷新不按离线结算
  const page = await open(save());
  const t0 = (await read(page)).lastSavedAt;
  await page.waitForTimeout(16500);
  check('挂机时存档时间持续刷新', (await read(page)).lastSavedAt - t0 >= 15000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  check('刷新后不按离线结算', !(await page.locator('body').innerText()).includes('离线经营'));
  await page.context().close();

  // 离线 20 分钟：封顶 240 天，且补上府中事件（48 桩）
  const offline = await open(save({ lastSavedAt: Date.now() - 20 * 60 * 1000 }));
  await offline.waitForTimeout(600);
  const s = await read(offline);
  check('离线结算封顶 240 天并含府中事件', s.day === 251 && /48 桩/.test(s.eventLog[0]?.detail ?? ''), `day=${s.day} ${s.eventLog[0]?.detail ?? ''}`);
  await offline.context().close();

  // 存储被禁用仍可进入游戏
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    for (const m of ['getItem', 'setItem', 'removeItem']) Storage.prototype[m] = () => { throw new DOMException('denied', 'SecurityError'); };
  });
  const blocked = await ctx.newPage();
  const errors = [];
  blocked.on('pageerror', (e) => errors.push(e.message));
  await blocked.goto(URL, { waitUntil: 'domcontentloaded' });
  await blocked.getByRole('button', { name: '开始游戏' }).click();
  check('存储被禁用仍可进入选主公', (await blocked.getByText('乱世择主').first().isVisible({ timeout: 5000 }).catch(() => false)) && errors.length === 0, errors.join(';'));
  await ctx.close();

  // 导入无伴侣存档 → 进入选伴侣页
  const importer = await open(save());
  await importer.getByRole('button', { name: '设置与存档' }).click();
  await importer.getByLabel('粘贴存档 JSON').fill(JSON.stringify(save({ ownedPartnerIds: [] })));
  await importer.getByRole('button', { name: '导入存档' }).click();
  check('导入无伴侣存档进入选伴侣页', await importer.getByText('良缘入府').first().isVisible({ timeout: 5000 }).catch(() => false));
  await importer.context().close();
});

await scenario('多标签页', async () => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await a.goto(URL, { waitUntil: 'domcontentloaded' });
  await a.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, save({ ownedPartnerIds: [] })]);
  await a.reload({ waitUntil: 'domcontentloaded' });
  const b = await ctx.newPage();
  await b.goto(URL, { waitUntil: 'domcontentloaded' });
  await a.getByRole('button', { name: /处理政务/ }).click();
  await a.waitForTimeout(1500);
  const goldA = (await read(a)).gold;
  await b.getByRole('button', { name: /处理政务/ }).click();
  await b.waitForTimeout(1500);
  const final = await read(a);
  check('两个标签页交替操作不丢收益', final.gold > goldA && goldA > 5000, `5000 → ${goldA} → ${final.gold}`);
  // 已有伴侣时另一标签停在选伴侣页，不能再白拿一位
  const c = await ctx.newPage();
  await c.goto(URL, { waitUntil: 'domcontentloaded' });
  await c.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, save({ screen: 'partnerSelect', lastScreen: 'partnerSelect', ownedPartnerIds: ['zhenji'] })]);
  await c.reload({ waitUntil: 'domcontentloaded' });
  const go = c.getByRole('button', { name: '携美人，共创家业' });
  if (await go.isVisible({ timeout: 4000 }).catch(() => false)) { await go.click(); await c.waitForTimeout(1200); }
  check('开局伴侣只能选一位', (await read(c)).ownedPartnerIds.length === 1);
  await ctx.close();
});

await scenario('任务与门槛', async () => {
  // 吕布满配 238：威震一郡(180) 可领、高级场(190) 可进
  const page = await open(save({ equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'], homeLevel: 4,
    claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'first-win', 'estate-third'] }));
  const text = await page.locator('main').innerText();
  check('威震一郡门槛 180 且可领赏', text.includes('总战力达到 180') && (await page.getByRole('button', { name: '领赏' }).first().isEnabled()));
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByText('九州征途').first().waitFor();
  check('高级场在战力 238 时开放', await page.getByRole('button', { name: /高级场/ }).isEnabled());
  await page.context().close();

  // 有进度时重选主公要确认，取消后进度保留
  const reselect = await open(save({ screen: 'lordSelect', lastScreen: 'lordSelect', ownedPartnerIds: [], gold: 7777, homeLevel: 3, day: 20 }));
  let dialog = null;
  reselect.on('dialog', async (d) => { dialog = d.message(); await d.dismiss(); });
  await reselect.getByRole('button', { name: '确认选择' }).click({ timeout: 5000 });
  await reselect.waitForTimeout(600);
  const s = await read(reselect);
  check('重选主公弹确认且取消后保留进度', Boolean(dialog) && s.gold === 7777 && s.homeLevel === 3);
  await reselect.context().close();
});

await scenario('兵器与经济', async () => {
  const migrated = await open(save({ equippedWeaponId: 'qinggang' }));
  await migrated.waitForTimeout(500);
  const m = await read(migrated);
  check('旧存档迁移：装备中的兵器视为已拥有', [...m.ownedWeaponIds].sort().join() === 'qinggang,xuanjian', JSON.stringify(m.ownedWeaponIds));
  await migrated.context().close();

  const page = await open(save({ selectedLordId: 'guanyu', ownedPartnerIds: [] }));
  await page.getByRole('button', { name: '兵器库' }).click();
  await page.getByText('兵器库').nth(1).waitFor();
  await page.getByRole('button', { name: /购入 · 5,000 金/ }).first().click();
  await page.waitForTimeout(600);
  let s = await read(page);
  check('5000 金购入传说兵器并装备', s.gold === 0 && s.equippedWeaponId === 'qinglong');
  await page.getByRole('button', { name: /差 5,000 金/ }).first().click();
  await page.waitForTimeout(400);
  s = await read(page);
  check('金不足不能购入', !s.ownedWeaponIds.includes('fangtian') && (await page.locator('.partner-market__notice').innerText()).includes('金不足'));
  await page.getByRole('button', { name: /^装备$/ }).first().click();
  await page.waitForTimeout(400);
  check('已拥有兵器免费换装', (await read(page)).equippedWeaponId === 'xuanjian');
  check('主页兵器加成含专属', /武力 \+(\d+)/.test(await page.locator('.home-support-grid').innerText()));
  await page.context().close();

  // 智谋提高收入（第 11 天推进到 12 天，不触发府中事件）
  const plain = await open(save({ selectedLordId: 'guanyu', ownedPartnerIds: [] }));
  const n0 = income(await plain.getByRole('button', { name: /处理政务/ }).innerText());
  await plain.context().close();
  const smart = await open(save({ selectedLordId: 'guanyu', ownedPartnerIds: ['huangyueying', 'zhenji', 'caiwenji'] }));
  const n1 = income(await smart.getByRole('button', { name: /处理政务/ }).innerText());
  const before = (await read(smart)).gold;
  await smart.getByRole('button', { name: /处理政务/ }).click();
  await smart.waitForTimeout(500);
  check('智谋提高处理政务收入且实扣一致', n1 > n0 && (await read(smart)).gold - before === n1, `${n0} → ${n1}`);
  await smart.context().close();

  // 声望折扣：显示与实扣一致
  const market = await open(save({ selectedLordId: 'guanyu', ownedPartnerIds: ['mifuren', 'daqiao'], gold: 99999 }));
  await market.getByRole('button', { name: '招募伴侣' }).click();
  await market.getByText('伴侣招募').first().waitFor();
  const disc = Number((await market.locator('.partner-market__summary').innerText()).match(/-(\d+)%/)?.[1] ?? -1);
  const expected = Math.round(800 * (1 - disc / 100));
  const g0 = (await read(market)).gold;
  await market.getByRole('button', { name: /召集/ }).first().click();
  await market.waitForTimeout(500);
  check('声望折扣显示并实扣一致', disc > 0 && g0 - (await read(market)).gold === expected, `-${disc}% → ${expected}`);
  await market.context().close();
});

await scenario('江东水战', async () => {
  // 宅邸 2 级：江东不可进，提示解锁条件
  const locked = await open(save({ homeLevel: 2 }));
  await locked.getByRole('button', { name: '出征讨伐' }).click();
  await locked.getByText('九州征途').first().waitFor();
  const node = locked.getByRole('button', { name: /江东/ });
  check('宅邸 2 级时江东未开放', await node.isDisabled() && (await node.innerText()).includes('砖瓦宅后开放'));
  await locked.context().close();

  // 宅邸 3 级：诸葛亮（智谋 100）出战，打完一场，胜负与金币、水战胜场、任务一致
  const page = await open(save({ selectedLordId: 'zhugeliang', homeLevel: 3, ownedPartnerIds: ['huangyueying'], claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third'] }));
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByText('九州征途').first().waitFor();
  await page.getByRole('button', { name: /江东/ }).click();
  const panel = await page.locator('[aria-label="水战说明"]').innerText();
  const reward = Number(panel.match(/缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
  check('水战面板显示智谋与缴获', /当前智谋 \d+/.test(panel) && reward > 0, `缴获 ${reward}`);
  const before = await read(page);
  await page.getByRole('button', { name: '扬帆出战' }).click();
  await page.getByText(/水战告捷|折戟江上/).first().waitFor({ timeout: 90000 });
  const win = (await page.locator('h2').first().innerText()).includes('水战告捷');
  await page.waitForTimeout(500);
  const after = await read(page);
  check('水战结算与存档一致', win
    ? after.gold - before.gold === reward && after.navalWins === before.navalWins + 1 && after.battleWins === before.battleWins + 1
    : after.gold === before.gold && after.navalWins === before.navalWins && after.battleLosses === before.battleLosses + 1, `${win ? '胜' : '负'} Δgold=${after.gold - before.gold}`);
  await page.getByRole('button', { name: '返回家业' }).click();
  await page.getByText('主城经营').first().waitFor();
  if (win) {
    const quest = page.locator('.quest-item').filter({ hasText: '江东扬帆' }).first();
    check('胜后任务「江东扬帆」可领赏', await quest.isVisible().catch(() => false) && (await quest.getByRole('button', { name: '领赏' }).isEnabled().catch(() => false)));
  }
  await page.context().close();
});

await scenario('许都朝堂', async () => {
  const locked = await open(save({ homeLevel: 3 }));
  await locked.getByRole('button', { name: '出征讨伐' }).click();
  await locked.getByText('九州征途').first().waitFor();
  const node = locked.getByRole('button', { name: /许都/ });
  check('宅邸 3 级时许都未开放', await node.isDisabled() && (await node.innerText()).includes('府邸后开放'));
  await locked.context().close();

  // 刘备（声望 96）+ 糜夫人（良缘 · 声望 16×1.3）+ 4 级府邸
  const page = await open(save({ selectedLordId: 'liubei', homeLevel: 4, ownedPartnerIds: ['mifuren'], claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third'] }));
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByText('九州征途').first().waitFor();
  await page.getByRole('button', { name: /许都/ }).click();
  const panel = await page.locator('[aria-label="朝堂说明"]').innerText();
  const reward = Number(panel.match(/缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
  check('朝堂面板显示声望与缴获', /当前声望 \d+/.test(panel) && reward > 0, `缴获 ${reward}`);
  const before = await read(page);
  await page.getByRole('button', { name: '入朝议事' }).click();
  await page.getByText(/朝议得胜|失势出京/).first().waitFor({ timeout: 90000 });
  const win = (await page.locator('h2').first().innerText()).includes('朝议得胜');
  await page.waitForTimeout(500);
  const after = await read(page);
  check('朝议结算与存档一致', win
    ? after.gold - before.gold === reward && after.courtWins === before.courtWins + 1 && after.navalWins === before.navalWins
    : after.gold === before.gold && after.courtWins === before.courtWins && after.battleLosses === before.battleLosses + 1, `${win ? '胜' : '负'} Δgold=${after.gold - before.gold}`);
  await page.getByRole('button', { name: '返回家业' }).click();
  await page.getByText('主城经营').first().waitFor();
  check('主城显示分战场战绩', /讨伐 \d+ · 水战 \d+ · 朝议 \d+ · 负 \d+/.test(await page.locator('main').innerText()));
  await page.context().close();
});

await scenario('西蜀屯田', async () => {
  const locked = await open(save({ homeLevel: 2 }));
  await locked.getByRole('button', { name: '出征讨伐' }).click();
  await locked.getByText('九州征途').first().waitFor();
  const node = locked.getByRole('button', { name: /西蜀/ });
  check('宅邸 2 级时西蜀未开放', await node.isDisabled() && (await node.innerText()).includes('砖瓦宅后开放'));
  await locked.context().close();

  const page = await open(save({ homeLevel: 3, gold: 5000, ownedPartnerIds: [], claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third'] }));
  const n0 = income(await page.getByRole('button', { name: /处理政务/ }).innerText());
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByText('九州征途').first().waitFor();
  await page.getByRole('button', { name: /西蜀/ }).click();
  await page.getByRole('button', { name: /投入 3,000 金/ }).click();
  await page.waitForTimeout(500);
  let s = await read(page);
  check('开荒扣 3000 金并升到 1 级', s.gold === 2000 && s.farmLevel === 1);
  check('金不足时显示差额', await page.getByRole('button', { name: /差 6,000 金/ }).isVisible());
  await page.getByRole('button', { name: /差 6,000 金/ }).click();
  await page.waitForTimeout(300);
  s = await read(page);
  check('金不足不能升级', s.farmLevel === 1 && (await page.locator('.partner-market__notice').innerText()).includes('金不足'));
  await page.getByRole('button', { name: '回府' }).click();
  await page.getByText('主城经营').first().waitFor();
  const n1 = income(await page.getByRole('button', { name: /处理政务/ }).innerText());
  check('屯田后每日收入提高', n1 - n0 >= 15, `${n0} → ${n1}`);
  check('任务「西蜀屯田」可领赏', await page.locator('.quest-item').filter({ hasText: '西蜀屯田' }).getByRole('button', { name: '领赏' }).isEnabled().catch(() => false));
  await page.context().close();
});

await scenario('斗地主', async () => {
  // 认输回府记一负
  const page = await open(save({ homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }), { viewport: { width: 844, height: 390 } });
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  await page.getByRole('button', { name: '进入斗地主' }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  await page.getByRole('button', { name: '认输回府' }).click();
  await page.getByText('主城经营').first().waitFor();
  check('认输回府记一负', (await read(page)).battleLosses === 1);

  // 用提示打完整局：不能卡死，胜负与金币一致
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  const before = await read(page);
  await page.getByRole('button', { name: '进入斗地主' }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  const t0 = Date.now();
  let stuck = 0;
  while (Date.now() - t0 < 180000) {
    if (await page.getByRole('button', { name: '返回家业' }).isVisible().catch(() => false)) break;
    const hint = page.getByRole('button', { name: '提示', exact: true });
    const pass = page.getByRole('button', { name: '不要', exact: true });
    if (await hint.isEnabled().catch(() => false)) {
      await hint.click();
      await page.getByRole('button', { name: '出牌', exact: true }).click();
      stuck = 0;
    } else if (await pass.isEnabled().catch(() => false)) {
      await pass.click();
      stuck = 0;
    } else if (++stuck > 120) {
      break;
    }
    await page.waitForTimeout(250);
  }
  const ended = await page.getByRole('button', { name: '返回家业' }).isVisible().catch(() => false);
  const win = (await page.locator('main').innerText()).includes('牌局胜利');
  await page.waitForTimeout(400);
  const after = await read(page);
  const delta = after.gold - before.gold;
  check('斗地主整局可打完且结算一致', ended && (win ? delta === 3000 && after.battleWins === before.battleWins + 1 : delta === 0 && after.battleLosses === before.battleLosses + 1),
    `${win ? '胜' : '负'} Δgold=${delta}`);
  await page.context().close();
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) {
  console.error('scenarios_failed');
  process.exit(1);
}
console.log('scenarios_ok');
