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
  check('离线结算封顶 240 天并含府中事件', s.day === 251 && /(\d+) 桩/.test(s.eventLog[0]?.detail ?? '') && Number((s.eventLog[0]?.detail ?? '').match(/(\d+) 桩/)[1]) >= 40, `day=${s.day} ${s.eventLog[0]?.detail ?? ''}`);
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
  await a.getByRole('button', { name: /^处理政务/ }).click();
  await a.waitForTimeout(1500);
  const goldA = (await read(a)).gold;
  await b.getByRole('button', { name: /^处理政务/ }).click();
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
  const n0 = income(await plain.getByRole('button', { name: /^处理政务/ }).innerText());
  await plain.context().close();
  const smart = await open(save({ selectedLordId: 'guanyu', ownedPartnerIds: ['huangyueying', 'zhenji', 'caiwenji'] }));
  const n1 = income(await smart.getByRole('button', { name: /^处理政务/ }).innerText());
  const before = (await read(smart)).gold;
  await smart.getByRole('button', { name: /^处理政务/ }).click();
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

await scenario('选择对手', async () => {
  // 诸葛亮开局战力约 81：推荐山贼头目；可自选更强的叛军校尉，胜率更低、缴获更高；弱档几乎必胜
  const page = await open(save({ selectedLordId: 'zhugeliang', ownedPartnerIds: [], homeLevel: 1 }));
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByText('九州征途').first().waitFor();
  await page.getByRole('button', { name: /官道/ }).click();
  const cards = page.locator('.tier-card');
  const texts = await cards.allInnerTexts();
  const odds = texts.map((t) => Number(t.match(/胜率约 (\d+)%/)?.[1] ?? -1));
  check('对手列表显示六档与胜率', texts.length === 6 && odds.every((o) => o >= 0), odds.join('/'));
  const recommended = texts.findIndex((t) => t.includes('推荐'));
  check('推荐档是不高于战力的最强档且胜率 60%+', recommended === 1 && odds[1] >= 60, `推荐=${texts[recommended]?.split('\n')[0]} 胜率 ${odds[1]}%`);
  check('更弱档胜率更高、更强档胜率更低且有梯度', odds[0] >= odds[1] && odds[2] < odds[1] && odds[2] >= 20 && odds[3] < odds[2], odds.join('/'));
  await cards.nth(2).click();
  const summary = await page.locator('.venue-summary').innerText();
  check('自选对手后摘要更新', summary.includes('叛军校尉') && summary.includes('600 金'), summary);
  // 力不能及的档位不可选
  const hopeless = await page.locator('.tier-card.is-hopeless').count();
  check('远超实力的档位标为力不能及并禁用', hopeless >= 1 && hopeless <= 3 && (await page.locator('.tier-card.is-hopeless').first().isDisabled()), `hopeless=${hopeless}`);
  await page.context().close();
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
  const reward = Number((await page.locator('[aria-label="水战说明"] .venue-summary').innerText()).match(/缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
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
  const reward = Number((await page.locator('[aria-label="朝堂说明"] .venue-summary').innerText()).match(/缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
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
  check('主城显示分战场战绩', /讨伐 \d+ · 水战 \d+ · 朝议 \d+ · 靖边 \d+ · 负 \d+/.test(await page.locator('main').innerText()));
  await page.context().close();
});

await scenario('西蜀屯田', async () => {
  const locked = await open(save({ homeLevel: 2 }));
  await locked.getByRole('button', { name: '出征讨伐' }).click();
  await locked.getByText('九州征途').first().waitFor();
  const node = locked.getByRole('button', { name: /西蜀/ });
  check('宅邸 2 级时西蜀未开放', await node.isDisabled() && (await node.innerText()).includes('砖瓦宅后开放'));
  await locked.context().close();

  const page = await open(save({ homeLevel: 3, gold: 7000, ownedPartnerIds: [], claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third'] }));
  const n0 = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByText('九州征途').first().waitFor();
  await page.getByRole('button', { name: /西蜀/ }).click();
  await page.getByRole('button', { name: /投入 6,000 金/ }).click();
  await page.waitForTimeout(500);
  let s = await read(page);
  check('开荒扣 6000 金并升到 1 级', s.gold === 1000 && s.farmLevel === 1);
  check('金不足时显示差额', await page.getByRole('button', { name: /差 15,000 金/ }).isVisible());
  await page.getByRole('button', { name: /差 15,000 金/ }).click();
  await page.waitForTimeout(300);
  s = await read(page);
  check('金不足不能升级', s.farmLevel === 1 && (await page.locator('.partner-market__notice').innerText()).includes('金不足'));
  await page.getByRole('button', { name: '回府' }).click();
  await page.getByText('主城经营').first().waitFor();
  const n1 = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  check('屯田后每日收入提高', n1 - n0 >= 15, `${n0} → ${n1}`);
  check('任务「西蜀屯田」可领赏', await page.locator('.quest-item').filter({ hasText: '西蜀屯田' }).getByRole('button', { name: '领赏' }).isEnabled().catch(() => false));
  await page.context().close();
});

await scenario('北疆边患', async () => {
  // 宅邸 3 级：北疆未开放
  const locked = await open(save({ homeLevel: 3 }));
  await locked.getByRole('button', { name: '出征讨伐' }).click();
  await locked.getByText('九州征途').first().waitFor();
  check('宅邸 3 级时北疆未开放', await locked.getByRole('button', { name: /北疆/ }).isDisabled());
  await locked.context().close();

  // 第 9 日 → 第 10 日起边患：主城提醒、地图标红
  const start = await open(save({ homeLevel: 4, day: 9, nextRaidDay: 10, frontierRaid: null }));
  await start.getByRole('button', { name: /^处理政务/ }).click();
  await start.waitForTimeout(500);
  let s = await read(start);
  const win24 = s.frontierRaid ? s.frontierRaid.dueAt - s.frontierRaid.startedAt : 0;
  check('第 10 日起边患并给 24 小时窗口', s.frontierRaid?.startDay === 10 && win24 === 24 * 3600 * 1000, JSON.stringify(s.frontierRaid));
  check('主城显示边患提醒', await start.locator('.frontier-alert').isVisible());
  await start.getByRole('button', { name: '出征讨伐' }).click();
  await start.getByText('九州征途').first().waitFor();
  check('地图北疆显示边患', (await start.getByRole('button', { name: /北疆/ }).innerText()).includes('边患'));
  await start.context().close();

  // 逾期不管：下一次处理政务扣 5%（封顶 5000）
  const ignore = await open(save({ homeLevel: 4, day: 13, gold: 40000, frontierRaid: { startDay: 10, startedAt: Date.now() - 25 * 3600 * 1000, dueAt: Date.now() - 3600 * 1000 }, nextRaidDay: 10 }));
  await ignore.waitForTimeout(500);
  s = await read(ignore);
  check('读档时逾期边患直接失守扣 5%', s.frontierRaid === null && s.gold === 38000 && s.nextRaidDay === 23 && s.eventLog[0]?.title === '边患失守', `gold=${s.gold} next=${s.nextRaidDay}`);

  // 连点政务烧不掉窗口；离线 20 分钟也不会起新边患
  const burn = await open(save({ homeLevel: 4, day: 9, nextRaidDay: 10, frontierRaid: null, gold: 40000 }));
  for (let i = 0; i < 6; i++) { await burn.getByRole('button', { name: /^处理政务/ }).click(); await burn.waitForTimeout(120); }
  s = await read(burn);
  check('连续处理政务不会让边患逾期', s.frontierRaid !== null && s.gold > 40000, `day=${s.day} raid=${Boolean(s.frontierRaid)}`);
  await burn.context().close();
  const offline = await open(save({ homeLevel: 4, day: 9, nextRaidDay: 10, frontierRaid: null, lastSavedAt: Date.now() - 20 * 60 * 1000 }));
  await offline.waitForTimeout(500);
  s = await read(offline);
  check('离线期间不起新边患也不扣金', s.frontierRaid === null && s.day === 249 && !s.eventLog.some((e) => e.title === '边患失守'));
  await offline.context().close();
  await ignore.context().close();

  // 无边患时不能出关
  const calm = await open(save({ homeLevel: 4, frontierRaid: null, nextRaidDay: 30 }));
  await calm.getByRole('button', { name: '出征讨伐' }).click();
  await calm.getByText('九州征途').first().waitFor();
  await calm.getByRole('button', { name: /北疆/ }).click();
  check('边境安宁时出关按钮禁用', await calm.getByRole('button', { name: '出关迎战' }).isDisabled());
  await calm.context().close();

  // 退守关内：不扣金、边患保留
  const retreat = await open(save({ homeLevel: 4, day: 11, gold: 20000, frontierRaid: { startDay: 10, startedAt: Date.now(), dueAt: Date.now() + 3600 * 1000 }, nextRaidDay: 10 }));
  await retreat.getByRole('button', { name: '出征讨伐' }).click();
  await retreat.getByText('九州征途').first().waitFor();
  await retreat.getByRole('button', { name: /北疆/ }).click();
  await retreat.getByRole('button', { name: '出关迎战' }).click();
  await retreat.getByRole('button', { name: '退守关内' }).waitFor();
  await retreat.waitForTimeout(4500);
  await retreat.getByRole('button', { name: '退守关内' }).click();
  await retreat.waitForTimeout(500);
  s = await read(retreat);
  check('退守关内不扣金且边患保留', s.gold === 20000 && s.frontierRaid !== null && s.battleLosses === 1, `gold=${s.gold} raid=${Boolean(s.frontierRaid)}`);
  await retreat.context().close();

  // 迎战：胜则缴获 + 靖边 +1 + 解除；败则扣 5% + 解除
  const fight = await open(save({ homeLevel: 4, day: 11, gold: 20000, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'], frontierRaid: { startDay: 10, startedAt: Date.now(), dueAt: Date.now() + 3600 * 1000 }, nextRaidDay: 10,
    claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third', 'first-win'] }));
  await fight.getByRole('button', { name: '出征讨伐' }).click();
  await fight.getByText('九州征途').first().waitFor();
  await fight.getByRole('button', { name: /北疆/ }).click();
  const panel = await fight.locator('[aria-label="边患说明"]').innerText();
  const reward = Number(panel.match(/缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
  const before = await read(fight);
  await fight.getByRole('button', { name: '出关迎战' }).click();
  await fight.getByText(/靖边得胜|边郡失守/).first().waitFor({ timeout: 90000 });
  const win = (await fight.locator('h2').first().innerText()).includes('靖边得胜');
  await fight.waitForTimeout(500);
  const after = await read(fight);
  check('边患迎战结算一致', after.frontierRaid === null && after.nextRaidDay === 21 && (win
    ? after.gold - before.gold === reward && after.frontierWins === 1
    : before.gold - after.gold === 1000 && after.frontierWins === 0), `${win ? '胜' : '负'} Δgold=${after.gold - before.gold}`);
  await fight.context().close();
});

await scenario('传位', async () => {
  // 未到王城：按钮禁用并说明条件
  const early = await open(save({ homeLevel: 5, gold: 500000 }));
  await early.getByRole('button', { name: '设置与存档' }).click();
  await early.getByText('当前存档').first().waitFor();
  check('未到王城不能传位', (await early.getByRole('button', { name: '传位给下一代' }).isDisabled()) && (await early.locator('.succession-panel').innerText()).includes('王城'));
  await early.context().close();

  // 王城 + 250,000 金：传位得 2 点，回到选主公，世代 2；重选主公后保留家业点且收入 +10%
  const page = await open(save({ homeLevel: 6, gold: 250000, ownedPartnerIds: ['diaochan'], equippedWeaponId: 'fangtian', farmLevel: 2 }));
  const plain = await open(save({ homeLevel: 1, gold: 1000, ownedPartnerIds: ['zhenji'], generation: 1, legacyPoints: 0 }));
  const baseIncome = income(await plain.getByRole('button', { name: /^处理政务/ }).innerText());
  await plain.context().close();
  await page.getByRole('button', { name: '设置与存档' }).click();
  await page.getByText('当前存档').first().waitFor();
  check('传位面板预告可得点数', (await page.locator('.succession-panel').innerText()).includes('可得 2 点'));
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '传位给下一代' }).click();
  await page.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  let s = await read(page);
  check('传位后进入选主公且重置', s.generation === 2 && s.legacyPoints === 2 && s.gold === 1000 && s.homeLevel === 1 && s.farmLevel === 0 && s.ownedPartnerIds.length === 0 && s.equippedWeaponId === 'xuanjian', JSON.stringify({ g: s.generation, lp: s.legacyPoints, gold: s.gold }));
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: '携美人，共创家业' }).click();
  await page.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  s = await read(page);
  const nextIncome = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  check('新一代保留家业点且收入提高', s.generation === 2 && s.legacyPoints === 2 && nextIncome > baseIncome, `${baseIncome} → ${nextIncome}`);
  check('主城显示第 2 代', (await page.locator('.home-hud').innerText()).includes('第 2 代'));
  check('任务「传承家业」可领', await page.locator('.quest-item').filter({ hasText: '传承家业' }).getByRole('button', { name: '领赏' }).isEnabled().catch(() => false));
  await page.context().close();
});

await scenario('府中事件二选一', async () => {
  // 第 9 → 10 日：商旅归附挂起，不自动给钱
  const page = await open(save({ day: 9, gold: 5000, homeLevel: 2, ownedPartnerIds: [] }));
  const inc = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  await page.getByRole('button', { name: /^处理政务/ }).click();
  await page.waitForTimeout(400);
  let s = await read(page);
  check('第 10 日挂起二选一且不自动入账', s.pendingChoice?.eventId === 'merchants' && s.gold === 5000 + inc && (await page.locator('.choice-card').isVisible()), `gold=${s.gold}`);
  // 选减税招商：无现钱，后 10 日政务 +20%
  await page.locator('.choice-card__options button').nth(1).click();
  await page.waitForTimeout(300);
  s = await read(page);
  const buffedLabel = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  const g0 = s.gold;
  await page.getByRole('button', { name: /^处理政务/ }).click();
  await page.waitForTimeout(300);
  s = await read(page);
  check('减税招商：收入 +20% 且按钮金额一致', s.pendingChoice === null && s.incomeBuff?.untilDay === 20 && buffedLabel === Math.round(inc * 1.2) && s.gold - g0 === buffedLabel, `${inc} → ${buffedLabel} 实得 ${s.gold - g0}`);
  await page.context().close();

  // 第 14 → 15 日：门客献策，选练兵之策，下一场胜利缴获翻倍
  const adv = await open(save({ day: 14, gold: 5000, homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await adv.getByRole('button', { name: /^处理政务/ }).click();
  await adv.waitForTimeout(400);
  await adv.locator('.choice-card__options button').nth(1).click();
  await adv.waitForTimeout(300);
  s = await read(adv);
  check('练兵之策：挂上翻倍', s.nextBattleBonus === 2 && s.pendingChoice === null);
  await adv.getByRole('button', { name: '出征讨伐' }).click();
  await adv.getByText('九州征途').first().waitFor();
  await adv.getByRole('button', { name: /官道/ }).click();
  await adv.locator('.tier-card').first().click();   // 最弱档，几乎必胜
  const reward = Number((await adv.locator('.venue-summary').innerText()).match(/缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
  const before = await read(adv);
  await adv.getByRole('button', { name: '出征讨伐', exact: true }).click();
  await adv.getByText(/讨伐得胜|败退整军/).first().waitFor({ timeout: 90000 });
  await adv.waitForTimeout(400);
  const after = await read(adv);
  const won = (await adv.locator('h2').first().innerText()).includes('讨伐得胜');
  check('胜利缴获翻倍并清除加成', won ? after.gold - before.gold === reward * 2 && after.nextBattleBonus === null : after.nextBattleBonus === 2, `${won ? '胜' : '负'} Δ=${after.gold - before.gold} reward=${reward}`);
  await adv.context().close();

  // 选现钱
  const cash = await open(save({ day: 9, gold: 5000, homeLevel: 2, ownedPartnerIds: [] }));
  const inc2 = income(await cash.getByRole('button', { name: /^处理政务/ }).innerText());
  await cash.getByRole('button', { name: /^处理政务/ }).click();
  await cash.waitForTimeout(300);
  await cash.locator('.choice-card__options button').nth(0).click();
  await cash.waitForTimeout(300);
  s = await read(cash);
  check('收取市税：立得 3 倍收入', s.gold === 5000 + inc2 + inc2 * 3 && s.pendingChoice === null, `gold=${s.gold}`);
  await cash.context().close();
});

await scenario('称号', async () => {
  const fresh = await open(save({ homeLevel: 1, battleWins: 0, ownedPartnerIds: [] }));
  const hud = await fresh.locator('.home-hud').innerText();
  check('开局称号为白身并提示下一称号', hud.includes('「白身」') && (await fresh.locator('.honor-hint').innerText()).includes('乡绅'));
  await fresh.context().close();
  const vet = await open(save({ homeLevel: 6, battleWins: 31, navalWins: 5, courtWins: 1, frontierWins: 0, farmLevel: 2, generation: 1 }));
  const hud2 = await vet.locator('.home-hud').innerText();
  check('按最后达成的称号显示并提示最近未达成的', hud2.includes('「一代枭雄」') && (await vet.locator('.honor-hint').innerText()).includes('朝堂新贵'));
  await vet.context().close();
});

await scenario('伴侣心事', async () => {
  // 第 4 → 5 日：甄姬心事弹出；选「留鉴内政」智谋 +6，收入因智谋提高
  const page = await open(save({ day: 4, gold: 5000, homeLevel: 2, ownedPartnerIds: ['zhenji', 'daqiao'] }));
  const inc0 = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  await page.getByRole('button', { name: /^处理政务/ }).click();
  await page.waitForTimeout(400);
  let s = await read(page);
  const card = page.locator('[aria-label="伴侣心事"]');
  check('第 5 日弹出第一位伴侣的心事', s.pendingChoice?.eventId === 'partner:zhenji' && (await card.isVisible()) && (await card.innerText()).includes('洛水之思'));
  await card.locator('.choice-card__options button').nth(1).click();
  await page.waitForTimeout(300);
  s = await read(page);
  const inc1 = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  check('选项落为永久加成并记录', s.resolvedPartnerEvents.zhenji === 'b' && s.partnerBoosts.zhenji?.intelligence === 6 && inc1 >= inc0, `${inc0} → ${inc1}`);
  check('任务「良缘佳话」可领', await page.locator('.quest-item').filter({ hasText: '良缘佳话' }).getByRole('button', { name: '领赏' }).isEnabled().catch(() => false));
  await page.context().close();
  // 第 24 → 25 日：轮到下一位（大乔），已解决的不重复
  const next = await open(save({ day: 24, gold: 5000, homeLevel: 2, ownedPartnerIds: ['zhenji', 'daqiao'], resolvedPartnerEvents: { zhenji: 'a' }, partnerBoosts: { zhenji: { charisma: 6 } } }));
  await next.getByRole('button', { name: /^处理政务/ }).click();
  await next.waitForTimeout(400);
  s = await read(next);
  check('已了却的不重复，轮到下一位', s.pendingChoice?.eventId === 'partner:daqiao');
  await next.context().close();
});

await scenario('新主公', async () => {
  const page = await open(null);
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '开始游戏' }).click();
  await page.getByText('乱世择主').first().waitFor();
  const names = await page.locator('main').innerText();
  check('选主公页出现三位新主公', ['马超', '孙策', '陆逊'].every((n) => names.includes(n)));
  await page.getByRole('button', { name: /陆逊/ }).first().click();
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: '携美人，共创家业' }).click();
  await page.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  const s = await read(page);
  check('可用陆逊开局', s.selectedLordId === 'luxun' && (await page.locator('.home-hud').innerText()).includes('陆逊'));
  await page.context().close();
});

await scenario('斗地主', async () => {
  // 认输回府记一负
  const page = await open(save({ homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }), { viewport: { width: 844, height: 390 } });
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  await page.getByRole('button', { name: '进入斗地主' }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  // 对手座位显示性格标签，且两局对手不同
  const names1 = await page.locator('.table-seat--opponent-left .table-seat__copy strong, .table-seat--opponent-right .table-seat__copy strong').allInnerTexts();
  await page.getByRole('button', { name: '认输回府' }).click();
  await page.getByText('主城经营').first().waitFor();
  check('认输回府记一负', (await read(page)).battleLosses === 1);

  // 用提示打完整局：不能卡死，胜负与金币一致
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  const before = await read(page);
  await page.getByRole('button', { name: '进入斗地主' }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  const badges = await page.locator('.table-seat--opponent-left .seat-turn-badge, .table-seat--opponent-right .seat-turn-badge').allInnerTexts();
  check('对手座位标注性格', badges.some((b) => /激进|稳健|均衡/.test(b)), badges.join('/'));
  const names2 = await page.locator('.table-seat--opponent-left .table-seat__copy strong, .table-seat--opponent-right .table-seat__copy strong').allInnerTexts();
  check('下一局换对手', names1.join() !== names2.join(), `${names1.join('+')} → ${names2.join('+')}`);
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
  check('斗地主整局可打完且结算一致', ended && (win ? delta === 1500 && after.battleWins === before.battleWins + 1 : delta === 0 && after.battleLosses === before.battleLosses + 1),
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
