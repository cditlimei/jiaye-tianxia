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
  if (!ok && process.env.GITHUB_ACTIONS) console.log(`::error title=scenario::${name} ${String(detail ?? '').slice(0, 300)}`);
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
  const offline = await open(save({ lastSavedAt: Date.now() - 241 * 3600 * 1000 }));
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
  const firstCard = market.locator('.partner-card').filter({ has: market.getByRole('button', { name: /召集/ }) }).first();
  const shown = Number((await firstCard.getByRole('button', { name: /召集/ }).innerText()).replace(/[^\d]/g, ''));
  const g0 = (await read(market)).gold;
  await firstCard.getByRole('button', { name: /召集/ }).click();
  await market.waitForTimeout(500);
  const bases = [600, 900, 1200].map((b) => Math.round(b * (1 - disc / 100)));
  check('声望折扣显示并实扣一致', disc > 0 && bases.includes(shown) && g0 - (await read(market)).gold === shown, `-${disc}% → ${shown}`);
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
  // 头像是懒加载，先滚进视口再等它们加载完
  await page.locator('.tier-card').last().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.tier-card__avatar')].every((e) => e.tagName !== 'IMG' || e.complete), null, { timeout: 8000 }).catch(() => {});
  const avatars = await page.locator('.tier-card__avatar').evaluateAll((els) => els.map((e) => e.tagName === 'IMG' && e.naturalWidth > 0));
  check('对手卡片带立绘头像', avatars.length === 6 && avatars.every(Boolean), JSON.stringify(avatars));
  const recommended = texts.findIndex((t) => t.includes('推荐 ·'));
  // 推荐 = 每道军令期望得失最高的一档（胜率按显示的 5% 档位取，允许并列）
  const ev = texts.map((t, i) => {
    const m = t.match(/胜\s\+([\d,]+) · 败\s−([\d,]+)/);
    if (!m) return -Infinity;
    const win = Number(m[1].replace(/,/g, '')), lose = Number(m[2].replace(/,/g, ''));
    return (odds[i] / 100) * win - (1 - odds[i] / 100) * lose;
  });
  const bestEv = Math.max(...ev);
  check('推荐档是期望得失最高的一档', recommended >= 0 && ev[recommended] >= bestEv * 0.95, `推荐=${texts[recommended]?.split('\n')[0]} 期望 ${ev.map((x) => Math.round(x)).join('/')}`);
  check('越往上败损占缴获越重', ev.length === 6 && texts.every((t) => /胜\s\+[\d,]+ · 败\s−[\d,]+|力不能及/.test(t)), texts.map((t) => t.split('\n').pop()).join(' | '));
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
  const navalSummary = await page.locator('[aria-label="水战说明"] .venue-summary').innerText();
  const reward = Number(navalSummary.match(/缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
  const loss = Number(navalSummary.match(/败折损 ([\d,]+) 金/)[1].replace(/,/g, ''));
  check('水战面板显示智谋与缴获', /智谋实力 \d+/.test(panel) && reward > 0, `缴获 ${reward}`);
  const before = await read(page);
  await page.getByRole('button', { name: /^扬帆出战/ }).click();
  await page.getByText(/水战告捷|折戟江上/).first().waitFor({ timeout: 90000 });
  const win = (await page.locator('h2').first().innerText()).includes('水战告捷');
  await page.waitForTimeout(500);
  const after = await read(page);
  check('水战结算与存档一致', win
    ? after.gold - before.gold === reward && after.navalWins === before.navalWins + 1 && after.battleWins === before.battleWins + 1
    : before.gold - after.gold === loss && after.navalWins === before.navalWins && after.battleLosses === before.battleLosses + 1, `${win ? '胜' : '负'} Δgold=${after.gold - before.gold}`);
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
  const courtSummary = await page.locator('[aria-label="朝堂说明"] .venue-summary').innerText();
  const reward = Number(courtSummary.match(/缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
  const loss = Number(courtSummary.match(/败折损 ([\d,]+) 金/)[1].replace(/,/g, ''));
  check('朝堂面板显示声望与缴获', /声望实力 \d+/.test(panel) && reward > 0, `缴获 ${reward}`);
  const before = await read(page);
  await page.getByRole('button', { name: /^入朝议事/ }).click();
  await page.getByText(/朝议得胜|失势出京/).first().waitFor({ timeout: 90000 });
  const win = (await page.locator('h2').first().innerText()).includes('朝议得胜');
  await page.waitForTimeout(500);
  const after = await read(page);
  check('朝议结算与存档一致', win
    ? after.gold - before.gold === reward && after.courtWins === before.courtWins + 1 && after.navalWins === before.navalWins
    : before.gold - after.gold === loss && after.courtWins === before.courtWins && after.battleLosses === before.battleLosses + 1, `${win ? '胜' : '负'} Δgold=${after.gold - before.gold}`);
  await page.getByRole('button', { name: '返回家业' }).click();
  await page.getByText('主城经营').first().waitFor();
  check('主城显示分战场战绩', /官道与牌局 \d+ · 水战 \d+ · 朝议 \d+ · 靖边 \d+ · 负 \d+/.test(await page.locator('main').innerText()));
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
  check('屯田后政务收入按比例提高', n1 > n0, `${n0} → ${n1}`);
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
  const burn = await open(save({ homeLevel: 4, day: 31, nextRaidDay: 32, frontierRaid: null, gold: 40000, ownedPartnerIds: [] }));
  for (let i = 0; i < 6; i++) { await burn.getByRole('button', { name: /^处理政务/ }).click(); await burn.waitForTimeout(120); }
  s = await read(burn);
  check('连续处理政务不会让边患逾期', s.frontierRaid !== null && s.gold > 40000 && s.day === 37, `day=${s.day} raid=${Boolean(s.frontierRaid)}`);
  await burn.context().close();
  const offline = await open(save({ homeLevel: 4, day: 9, nextRaidDay: 10, frontierRaid: null, lastSavedAt: Date.now() - 241 * 3600 * 1000 }));
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
  check('边境安宁时出关按钮禁用', await calm.getByRole('button', { name: /^出关迎战/ }).isDisabled());
  await calm.context().close();

  // 退守关内：不扣金、边患保留
  const retreat = await open(save({ homeLevel: 4, day: 11, gold: 20000, frontierRaid: { startDay: 10, startedAt: Date.now(), dueAt: Date.now() + 3600 * 1000 }, nextRaidDay: 10 }));
  await retreat.getByRole('button', { name: '出征讨伐' }).click();
  await retreat.getByText('九州征途').first().waitFor();
  await retreat.getByRole('button', { name: /北疆/ }).click();
  await retreat.getByRole('button', { name: /^出关迎战/ }).click();
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
  await fight.getByRole('button', { name: /^出关迎战/ }).click();
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
  check('传位后进入选主公且重置（屯田随家业传下）', s.generation === 2 && s.legacyPoints === 2 && s.gold === 1000 && s.homeLevel === 1 && s.farmLevel === 2 && s.ownedPartnerIds.length === 0 && s.equippedWeaponId === 'xuanjian', JSON.stringify({ g: s.generation, lp: s.legacyPoints, gold: s.gold }));
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
  check('待决断时处理政务暂停', await page.getByRole('button', { name: '先决断上方事件' }).isDisabled());
  const box = await page.locator('.choice-card').boundingBox();
  check('事件卡片滚入视口', box !== null && box.y >= 0 && box.y < 844, `y=${box?.y}`);
  // 选减税招商：无现钱，后 10 日政务 +40%
  await page.locator('.choice-card__options button').nth(1).click();
  await page.waitForTimeout(300);
  s = await read(page);
  const buffedLabel = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  const g0 = s.gold;
  await page.getByRole('button', { name: /^处理政务/ }).click();
  await page.waitForTimeout(300);
  s = await read(page);
  check('减税招商：收入 +40% 且按钮金额一致', s.pendingChoice === null && s.incomeBuff?.untilDay === 20 && buffedLabel === Math.round(inc * 1.4) && s.gold - g0 === buffedLabel, `${inc} → ${buffedLabel} 实得 ${s.gold - g0}`);
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
  // 面板上显示的已是翻倍后的实得数
  const summaryText = await adv.locator('.venue-summary').innerText();
  const reward = Number(summaryText.match(/缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
  const bonusLoss = Number(summaryText.match(/败折损 ([\d,]+) 金/)[1].replace(/,/g, ''));
  check('出征面板标明练兵翻倍', summaryText.includes('练兵之策翻倍'), summaryText.slice(0, 80));
  const before = await read(adv);
  await adv.getByRole('button', { name: /^出征讨伐 ·/ }).click();
  await adv.getByText(/讨伐得胜|败退整军/).first().waitFor({ timeout: 90000 });
  await adv.waitForTimeout(400);
  const after = await read(adv);
  const won = (await adv.locator('h2').first().innerText()).includes('讨伐得胜');
  check('胜利缴获翻倍并清除加成', won ? after.gold - before.gold === reward && after.nextBattleBonus === null : after.nextBattleBonus === 2 && before.gold - after.gold === bonusLoss, `${won ? '胜' : '负'} Δ=${after.gold - before.gold} reward=${reward}`);
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
  const hint2 = await vet.locator('.honor-hint').innerText();
  check('显示档位最高的称号，并提示还有几个未集齐', hud2.includes('「一代枭雄」') && hint2.includes('另有 4 个称号待集齐'), hint2);
  await vet.context().close();
  // 第二代：开国元勋是家声，不盖住本代称号；提示指向更高的本代称号
  const heir = await open(save({ homeLevel: 3, battleWins: 2, generation: 2, legacyPoints: 2 }));
  const hud3 = await heir.locator('.home-hud').innerText();
  const hint3 = await heir.locator('.honor-hint').innerText();
  check('第二代显示本代称号而非开国元勋', hud3.includes('「乡绅」') && !hud3.includes('「开国元勋」') && hint3.includes('一方豪强'), `${hud3.replace(/\n/g, ' ').slice(0, 60)} | ${hint3}`);
  await heir.context().close();
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
  // 第 14 → 15 日是门客献策，心事顺延到第 16 日，两张卡不互相挤掉
  const clash = await open(save({ day: 14, gold: 5000, homeLevel: 2, ownedPartnerIds: ['zhenji'] }));
  await clash.getByRole('button', { name: /^处理政务/ }).click();
  await clash.waitForTimeout(400);
  s = await read(clash);
  check('第 15 日先出门客献策', s.pendingChoice?.eventId === 'advisor', s.pendingChoice?.eventId);
  await clash.locator('.choice-card__options button').first().click();
  await clash.waitForTimeout(300);
  await clash.getByRole('button', { name: /^处理政务/ }).click();
  await clash.waitForTimeout(400);
  s = await read(clash);
  check('心事顺延到第 16 日', s.day === 16 && s.pendingChoice?.eventId === 'partner:zhenji', `day=${s.day} ${s.pendingChoice?.eventId}`);
  await clash.context().close();
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

await scenario('开局引导', async () => {
  const page = await open(null);
  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '开始游戏' }).click();
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: '携美人，共创家业' }).click();
  await page.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  const panel = page.locator('[aria-label="开局引导"]');
  check('开局引导在首屏顶部且指向升级宅邸', (await panel.innerText()).includes('第 1 步') && (await page.getByRole('button', { name: /升级宅邸/ }).getAttribute('class')).includes('is-guided'));
  await page.getByRole('button', { name: /升级宅邸/ }).click();
  await page.waitForTimeout(2500);
  const partnerBtn = page.getByRole('button', { name: '招募伴侣' });
  const incomeBtn = page.getByRole('button', { name: /^处理政务/ });
  check('第 2 步：钱不够时高亮处理政务', (await panel.innerText()).includes('第 2 步') && (await incomeBtn.getAttribute('class')).includes('is-guided') && !(await partnerBtn.getAttribute('class')).includes('is-guided'));
  await page.evaluate(([k]) => { const s = JSON.parse(localStorage.getItem(k)); s.gold = 5000; localStorage.setItem(k, JSON.stringify(s)); }, [KEY]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await incomeBtn.waitFor();
  check('钱够了高亮招募伴侣', (await partnerBtn.getAttribute('class')).includes('is-guided'));
  await page.getByRole('button', { name: '跳过引导' }).click();
  await page.waitForTimeout(300);
  check('跳过后引导消失', !(await panel.isVisible().catch(() => false)) && (await read(page)).tutorialDone === true);
  await page.context().close();
});

await scenario('主公与称号页', async () => {
  const page = await open(save({ homeLevel: 4, battleWins: 12 }));
  await page.getByRole('button', { name: '主公' }).click();
  await page.getByText('主公与称号').first().waitFor();
  const rows = await page.locator('.title-row').count();
  const earned = await page.locator('.title-row.is-earned').count();
  check('主公页列出全部称号并标出已获得', rows >= 11 && earned >= 4 && (await page.locator('.lord-sheet').innerText()).includes('吕布'), `rows=${rows} earned=${earned}`);
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '伴侣', exact: true }).click();
  check('伴侣互动注明纯剧情', (await page.locator('.modal-note').innerText()).includes('不改数值'));
  await page.context().close();
});

await scenario('竖屏两行手牌', async () => {
  const page = await open(save({ homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  const cards = page.locator('.player-hand .poker-card');
  const n = await cards.count();
  const tops = new Set((await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))).map((t) => Math.round(t / 10)));
  const widths = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  check('20 张手牌在竖屏分两行', n === 20 && tops.size === 2 && Math.min(...widths) >= 56, `rows=${tops.size} width=${Math.min(...widths)}`);
  const target = cards.nth(3);
  const id = await target.getAttribute('data-card-id');
  await target.click();
  await page.waitForTimeout(200);
  const selected = await page.locator('.player-hand .poker-card.is-selected').getAttribute('data-card-id');
  check('点上排的牌能选中正确的那张', selected === id, `${id} → ${selected}`);
  await page.context().close();
});

await scenario('战斗加速与押注上限', async () => {
  // 金 500：败损按余额封顶，付不起全额也照样能打
  const poor = await open(save({ gold: 500, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'], homeLevel: 4 }));
  await poor.getByRole('button', { name: '出征讨伐' }).click();
  await poor.getByText('九州征途').first().waitFor();
  await poor.getByRole('button', { name: /官道/ }).click();
  const cap = poor.locator('.tier-card').filter({ hasText: /败\s−500(?!\d)/ });
  check('身家不够全额败损时按余额封顶且仍可选', (await cap.count()) >= 1 && (await cap.first().isEnabled()), `count=${await cap.count()}`);
  await poor.context().close();
  // 直接结算：几秒内出结果
  const page = await open(save({ gold: 5000, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'], homeLevel: 4 }));
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByText('九州征途').first().waitFor();
  await page.getByRole('button', { name: /官道/ }).click();
  await page.getByRole('button', { name: /^出征讨伐 ·/ }).click();
  await page.getByRole('button', { name: '直接结算' }).waitFor({ timeout: 15000 });
  const t0 = Date.now();
  await page.getByRole('button', { name: '直接结算' }).click();
  await page.getByText(/讨伐得胜|败退整军/).first().waitFor({ timeout: 5000 });
  check('直接结算立刻出结果', Date.now() - t0 < 3000 && (await page.locator('.battle-info').innerText()).includes('本战金币'));
  await page.context().close();
});

await scenario('离线保留事件与升阶画面', async () => {
  // 离线 12 天经过第 10 日：商旅归附保留待决断
  const page = await open(save({ day: 3, gold: 5000, ownedPartnerIds: [], lastSavedAt: Date.now() - 12.5 * 3600 * 1000 }));
  await page.waitForTimeout(500);
  const s = await read(page);
  check('离线期间最近一桩二选一留给玩家', s.day === 15 && s.pendingChoice?.day === 15 && (await page.locator('.choice-card').isVisible()), `day=${s.day} pending=${JSON.stringify(s.pendingChoice)}`);
  await page.context().close();
  // 升级宅邸的特效是宅邸图片，不是视频
  const up = await open(save({ gold: 5000, homeLevel: 1 }));
  await up.getByRole('button', { name: /升级宅邸/ }).click();
  await up.waitForTimeout(400);
  check('升阶特效展示新宅邸图', (await up.locator('.effect-overlay__image').count()) === 1 && (await up.locator('.effect-overlay video').count()) === 0);
  await up.context().close();
});

await scenario('品级定价与中途离阵', async () => {
  const page = await open(save({ gold: 99999, ownedPartnerIds: [] }));
  await page.getByRole('button', { name: '招募伴侣' }).click();
  await page.getByText('伴侣招募').first().waitFor();
  const priceOf = async (name) => Number((await page.locator('.partner-card').filter({ hasText: name }).getByRole('button').innerText()).replace(/[^\d]/g, ''));
  const d = await priceOf('貂蝉'), c = await priceOf('蔡文姬'), z = await priceOf('甄姬');
  const tags = (await page.locator('.partner-card').filter({ hasText: '貂蝉' }).innerText()) + (await page.locator('.partner-card').filter({ hasText: '蔡文姬' }).innerText());
  check('伴侣按品级定价（传说 > 名姬 > 贤助）', d > z && z > c && tags.includes('传说') && tags.includes('贤助'), `${d}/${z}/${c}`);
  await page.context().close();
  // 出征后刷新：将士按显示的胜率替玩家打完，胜得缴获、败扣折损
  const fight = await open(save({ gold: 5000, homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await fight.getByRole('button', { name: '出征讨伐' }).click();
  await fight.getByText('九州征途').first().waitFor();
  await fight.getByRole('button', { name: /官道/ }).click();
  const fightSummary = await fight.locator('.venue-summary').innerText();
  const loss = Number(fightSummary.match(/败折损 ([\d,]+) 金/)[1].replace(/,/g, ''));
  const gain = Number(fightSummary.match(/缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
  await fight.getByRole('button', { name: /^出征讨伐 ·/ }).click();
  await fight.waitForTimeout(800);
  await fight.reload({ waitUntil: 'domcontentloaded' });
  await fight.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  const s2 = await read(fight);
  const wonAway = s2.battleWins === 1;
  check('战斗中刷新按胜率替玩家打完', s2.activeBattle === null && s2.eventLog[0]?.title === '战事已毕' && (wonAway ? s2.gold === 5000 + gain : s2.gold === 5000 - loss && s2.battleLosses === 1), `${wonAway ? '胜' : '负'} gold=${s2.gold} gain=${gain} loss=${loss}`);
  await fight.context().close();
});

await scenario('军令', async () => {
  // 0 道军令：出征按钮禁用并写明几日后回复；北疆边患不受限
  const page = await open(save({ day: 10, orders: 0, homeLevel: 4, frontierRaid: { startDay: 10, startedAt: Date.now(), dueAt: Date.now() + 3600 * 1000 }, nextRaidDay: 10 }));
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByText('九州征途').first().waitFor();
  check('地图标题显示军令', (await page.locator('.screen-header').first().innerText()).includes('军令 0/6'));
  await page.getByRole('button', { name: /官道/ }).click();
  const go = page.getByRole('button', { name: /军令不足/ });
  check('军令为 0 时不能出征', (await go.isDisabled()) && (await go.innerText()).includes('2 日后'));
  await page.getByRole('button', { name: /北疆/ }).click();
  check('北疆边患不耗军令', await page.getByRole('button', { name: /出关迎战/ }).isEnabled());
  await page.context().close();
  // 出征扣 1 道；处理政务到 3 的倍数日回 1 道
  const p2 = await open(save({ day: 11, orders: 2, gold: 5000, homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await p2.getByRole('button', { name: '出征讨伐' }).click();
  await p2.getByText('九州征途').first().waitFor();
  await p2.getByRole('button', { name: /官道/ }).click();
  await p2.getByRole('button', { name: /出征讨伐 · 耗 1 军令/ }).click();
  await p2.getByRole('button', { name: '直接结算' }).click();
  await p2.getByText(/讨伐得胜|败退整军/).first().waitFor({ timeout: 5000 });
  check('出征扣 1 道军令', (await read(p2)).orders === 1);
  await p2.getByRole('button', { name: '返回家业' }).click();
  await p2.getByRole('button', { name: /^处理政务/ }).click();
  await p2.waitForTimeout(300);
  check('第 12 日回 1 道军令', (await read(p2)).orders === 2 && (await read(p2)).day === 12);
  await p2.context().close();
});

await scenario('流民归附', async () => {
  // 第 19 → 20 日：流民归附；选「募为乡勇」军令 +1，不给钱
  const page = await open(save({ day: 19, gold: 5000, homeLevel: 2, ownedPartnerIds: [], orders: 2 }));
  await page.getByRole('button', { name: /^处理政务/ }).click();
  await page.waitForTimeout(400);
  let s = await read(page);
  const g0 = s.gold, o0 = s.orders;
  check('第 20 日出流民归附', s.pendingChoice?.eventId === 'refugees' && (await page.locator('.choice-card').innerText()).includes('流民归附'), s.pendingChoice?.eventId);
  await page.locator('.choice-card__options button').nth(1).click();
  await page.waitForTimeout(300);
  s = await read(page);
  check('募为乡勇：军令 +1 且不给钱', s.orders === o0 + 1 && s.gold === g0 && s.pendingChoice === null, `orders ${o0} → ${s.orders} gold ${g0} → ${s.gold}`);
  await page.context().close();
});

await scenario('第五轮修复', async () => {
  // 传位点数封顶：已有 18 点、手上 234 万金，只能再换 2 点
  const rich = await open(save({ homeLevel: 6, gold: 2345678, legacyPoints: 18, generation: 3 }));
  const hintText = await rich.locator('.succession-hint').innerText();
  check('主城传位提示按上限封顶', hintText.includes('可换 2 点'), hintText.replace(/\n/g, ' ').slice(0, 80));
  const gold = await rich.locator('.home-hud__chips strong').first().innerText();
  check('百万以上金币用「万」显示', gold === '234.6万', gold);
  const chipsFit = await rich.locator('.home-hud__chips strong').evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1));
  check('顶栏数字不溢出', chipsFit);
  await rich.getByRole('button', { name: '设置与存档' }).click();
  await rich.getByText('当前存档').first().waitFor();
  const panel = await rich.locator('.succession-panel').innerText();
  check('传位面板说明超出上限的点数', panel.includes('可得 2 点') && panel.includes('多出的 21 点换不到'), panel.replace(/\n/g, ' ').slice(0, 120));
  await rich.context().close();

  // 传位后回标题页：显示待择新主与家业点，重开确认点明家业点会作废
  const heir = await open(save({ homeLevel: 6, gold: 250000, ownedPartnerIds: ['diaochan'] }));
  const messages = [];
  heir.on('dialog', (d) => { messages.push(d.message()); d.accept(); });
  await heir.getByRole('button', { name: '设置与存档' }).click();
  await heir.getByRole('button', { name: '传位给下一代' }).click();
  await heir.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  await heir.reload();
  await heir.getByText('家业天下').first().waitFor();
  const saveText = await heir.locator('.title-screen__save').innerText().catch(() => '');
  check('标题页显示待择新主与起手金', saveText.includes('第 2 代 · 待择新主') && saveText.includes('起手 7,000 金'), saveText.replace(/\n/g, ' '));
  const newGame = heir.getByRole('button', { name: '重开基业' });
  if (await newGame.isVisible().catch(() => false)) {
    heir.removeAllListeners('dialog');
    heir.on('dialog', (d) => { messages.push(d.message()); d.dismiss(); });
    await newGame.click();
    await heir.waitForTimeout(300);
    check('重开确认点明家业点作废', messages.some((m) => m.includes('2 点家业点')), messages.join(' | '));
  } else {
    check('重开确认点明家业点作废', false, '标题页没有重开按钮');
  }
  await heir.context().close();
});

await scenario('第五轮修复（离线与兵器）', async () => {
  // 离线期间减税招商照样生效：第 12 日起离线 3 天，加成到第 20 日
  const buff = await open(save({ day: 12, gold: 5000, ownedPartnerIds: [], incomeBuff: { percent: 40, untilDay: 20 }, lastSavedAt: Date.now() - 3.2 * 3600 * 1000 }));
  await buff.waitForTimeout(500);
  const b = await read(buff);
  await buff.context().close();
  const plain = await open(save({ day: 12, gold: 5000, ownedPartnerIds: [], lastSavedAt: Date.now() - 3.2 * 3600 * 1000 }));
  await plain.waitForTimeout(500);
  const p0 = await read(plain);
  await plain.context().close();
  // 两边府中事件相同，差额只来自 3 天政务的 40% 加成
  const daily = p0.pendingChoice?.dailyIncome ?? 0;
  check('离线收入也吃减税加成', b.day === 15 && daily > 0 && b.gold - p0.gold === (Math.round(daily * 1.4) - daily) * 3 && b.incomeBuff?.untilDay === 20, `有加成 +${b.gold - 5000} / 无加成 +${p0.gold - 5000} 日收 ${daily}`);

  // 离线跨过伴侣心事日：心事留给玩家决断
  const heart = await open(save({ day: 3, gold: 5000, ownedPartnerIds: ['diaochan'], lastSavedAt: Date.now() - 3.2 * 3600 * 1000 }));
  await heart.waitForTimeout(500);
  const h = await read(heart);
  check('离线错过的伴侣心事留待决断', h.pendingChoice?.eventId === 'partner:diaochan' && (await heart.locator('[aria-label="伴侣心事"]').isVisible()), JSON.stringify(h.pendingChoice));
  await heart.context().close();

  // 买比手上弱的兵器：收进兵器库，不换装
  const armory = await open(save({ gold: 5000, selectedLordId: 'zhaoyun', equippedWeaponId: 'qinggang', ownedWeaponIds: ['xuanjian', 'qinggang'] }));
  await armory.getByRole('button', { name: '兵器库' }).click();
  await armory.getByText('兵器库').nth(1).waitFor();
  await armory.locator('.weapon-card').filter({ hasText: '双股剑' }).getByRole('button', { name: /购入/ }).click();
  await armory.waitForTimeout(300);
  const w = await read(armory);
  check('买弱兵器不自动换装', w.ownedWeaponIds.includes('shuanggu') && w.equippedWeaponId === 'qinggang' && (await armory.locator('.partner-market__notice').innerText()).includes('收进兵器库'), `eq=${w.equippedWeaponId}`);
  await armory.context().close();
});

await scenario('传位后刷新不丢世代', async () => {
  const page = await open(save({ homeLevel: 6, gold: 250000, ownedPartnerIds: ['diaochan'] }));
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '设置与存档' }).click();
  await page.getByRole('button', { name: '传位给下一代' }).click();
  await page.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const title = await page.locator('main').innerText();
  await page.getByRole('button', { name: /继续家业|开始游戏/ }).first().click();
  await page.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: '携美人，共创家业' }).click();
  await page.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  const s = await read(page);
  check('传位后刷新再选主公仍是第 2 代且保留家业点', s.generation === 2 && s.legacyPoints === 2 && s.gold === 1000 + 2 * 3000 && s.tutorialDone === true, `title=${title.includes('继续家业')} g=${s.generation} lp=${s.legacyPoints} gold=${s.gold}`);
  check('第 2 代不再出现开局引导', !(await page.locator('[aria-label="开局引导"]').isVisible().catch(() => false)));
  await page.context().close();
});

await scenario('斗地主', async () => {
  // 认输回府记一负
  const page = await open(save({ homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }), { viewport: { width: 844, height: 390 } });
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  // 对手座位显示性格标签，且两局对手不同
  const names1 = await page.locator('.table-seat--opponent-left .table-seat__copy strong, .table-seat--opponent-right .table-seat__copy strong').allInnerTexts();
  const g0 = (await read(page)).gold;
  let accept = false;
  page.on('dialog', (d) => (accept ? d.accept() : d.dismiss()));
  await page.getByRole('button', { name: /^认输/ }).click();
  await page.waitForTimeout(300);
  check('认输先弹确认，取消则留在牌局', (await page.getByText('斗地主牌局').first().isVisible()) && (await read(page)).gold === g0);
  accept = true;
  await page.getByRole('button', { name: /^认输/ }).click();
  await page.getByText('主城经营').first().waitFor();
  check('认输记一负并折损 20% 缴获', (await read(page)).battleLosses === 1 && g0 - (await read(page)).gold === 1600, `Δ=${g0 - (await read(page)).gold}`);

  // 用提示打完整局：不能卡死，胜负与金币一致
  await page.getByRole('button', { name: '出征讨伐' }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  const before = await read(page);
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
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
  const win = (await page.locator('main').innerText()).includes('胜 +');
  await page.waitForTimeout(400);
  const after = await read(page);
  const delta = after.gold - before.gold;
  check('斗地主整局可打完且结算一致', ended && (win ? delta === 8000 && after.battleWins === before.battleWins + 1 : delta === -1600 && after.battleLosses === before.battleLosses + 1),
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
