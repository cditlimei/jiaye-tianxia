/**
 * 场景回归：直接写入 localStorage 存档，再断言页面与存档。
 * 覆盖 smoke 之外的分支：存档/离线/多标签、任务与门槛、兵器购买、智谋声望、斗地主整局与认输。
 * 用法: JIAYE_URL=http://127.0.0.1:4173/ node scripts/scenarios.mjs   （需先 npm run build && npm run preview）
 */
import { chromium } from 'playwright';

const URL = process.env.JIAYE_URL ?? 'http://127.0.0.1:5173/';
const KEY = 'jiaye-tianxia-save-v3';
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
  const { bidding = false, turnSeconds = 0, affairs = false, ls = null, realtime = false, dayMs = 2000, ...rest } = contextOptions;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...rest });
  // 额外的 localStorage 开关（如 jiaye-ddz-seed 复现牌局、jiaye-escort 指定随行伴侣）
  if (ls) await ctx.addInitScript((pairs) => { try { for (const [k, v] of Object.entries(pairs)) localStorage.setItem(k, v); } catch { /* 存储被禁用的用例 */ } }, ls);
  // 旧用例按「玩家当地主」写，默认跳过叫地主；叫地主流程单独测（bidding: true）
  if (!bidding) await ctx.addInitScript(() => { try { localStorage.setItem('jiaye-ddz-skip-bid', '1'); } catch { /* 存储被禁用的用例 */ } });
  // 出牌倒计时默认关掉，免得慢机上用例被自动「不要」；倒计时单独测
  await ctx.addInitScript((sec) => { try { localStorage.setItem('jiaye-ddz-turn-seconds', String(sec)); } catch { /* 存储被禁用的用例 */ } }, turnSeconds);
  // 「处理政务」默认一键办钱粮（旧用例按点一次拿足额政务收入写）；府中三件事弹层单独测（affairs: true）
  if (!affairs) await ctx.addInitScript(() => { try { localStorage.setItem('jiaye-affair-quick', '1'); } catch { /* 存储被禁用的用例 */ } });
  // v2.3 真实时间：旧用例按「点处理政务推进一日」写，默认开 jiaye-clock-manual；真实时间用例传 realtime: true，日长缩到 dayMs（默认 2 秒）
  if (!realtime) await ctx.addInitScript(() => { try { localStorage.setItem('jiaye-clock-manual', '1'); } catch { /* 存储被禁用的用例 */ } });
  else if (dayMs) await ctx.addInitScript((ms) => { try { localStorage.setItem('jiaye-day-ms', String(ms)); } catch { /* 存储被禁用的用例 */ } }, dayMs);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  if (state) {
    await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, state]);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  return page;
}
// 首页 v2：家业目标、称号提示、志向进度收在「家业目标」弹层里
async function openGoals(page) {
  const sheet = page.getByRole('dialog', { name: '家业目标' });
  if ((await sheet.count()) === 0) await page.locator('.home-tiles button').first().click();
  await sheet.waitFor();
}
async function closeGoals(page) {
  const sheet = page.getByRole('dialog', { name: '家业目标' });
  if ((await sheet.count()) > 0) await sheet.getByRole('button', { name: '关闭' }).click();
}
const read = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const income = (text) => Number(text.match(/\+([\d,]+)金/)[1].replace(/,/g, ''));

async function scenario(name, fn) {
  // ONLY=关键字 只跑名字含该关键字的场景（本地排查用）；多个用 | 分隔
  if (process.env.ONLY && !process.env.ONLY.split('|').some((key) => name === key || name.includes(key))) return;
  try {
    await fn();
  } catch (error) {
    const lines = error.message.split('\n');
    check(`${name}（脚本异常）`, false, [lines[0], ...lines.filter((line) => /waiting for|intercepts|not stable|not visible/.test(line)).slice(0, 3)].join(' | '));
  }
}
// 府中事件现在直接弹窗；要先去别处的用例点「稍后再说」收起
async function dismissChoice(page) {
  const later = page.getByRole('button', { name: '稍后再说' });
  if (await later.isVisible().catch(() => false)) await later.click();
}
// 「出征」现在直达斗地主选场；要去官道/江东等地区先点「其他战场」展开地图
// 选场后读本场实际缴获（随战力上涨，不再是写死的场次底价）
async function venueGold(page) {
  const text = await page.locator('.venue-summary').first().innerText();
  return Number(text.match(/本场胜缴获 ([\d,]+) 金/)?.[1].replace(/,/g, '') ?? NaN);
}

async function openMap(page) {
  const more = page.getByRole('button', { name: '其他战场 ›' });
  await page.locator('.expedition-screen').waitFor({ timeout: 10000 });
  if (await more.isVisible().catch(() => false)) await more.click();
  await page.locator('.expedition-map').waitFor();
}
// 首页「下一步」之外的可做事项收在「还有 N 件」里，点之前先展开
async function chance(page, name) {
  const target = page.locator('.chance-bar').getByRole('button', { name });
  if (!(await target.first().isVisible().catch(() => false))) await page.locator('.next-step__more').click();
  await target.first().click();
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
  await ctx.addInitScript(() => { try { localStorage.setItem('jiaye-affair-quick', '1'); localStorage.setItem('jiaye-clock-manual', '1'); } catch { /* ignore */ } });
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
  await openGoals(page);
  const text = await page.locator('main').innerText();
  check('威震一郡门槛 180 且可领赏', text.includes('武力达到 180') && (await page.getByRole('button', { name: '领赏' }).first().isEnabled()));
  await closeGoals(page);
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await openMap(page);
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
  await page.getByRole('button', { name: '兵器', exact: true }).click();
  await page.getByRole('dialog', { name: '兵器库' }).waitFor();
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
  check('兵器库标出兵器加成', /武力 \+(\d+)/.test(await page.getByRole('dialog', { name: '兵器库' }).innerText()));
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
  await market.getByRole('button', { name: '伴侣', exact: true }).click();
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

await scenario('自动战收起', async () => {
  // 官道/江东/许都 10-15 收起，北疆 v2.2 收起：其他战场只剩荆州、西蜀屯田；旧的「引导去官道」入口落到荆州
  const page = await open(save({ homeLevel: 4 }));
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await openMap(page);
  const nodes = await page.locator('.map-node').allInnerTexts();
  check('其他战场只剩荆州、西蜀', nodes.length === 2 && !nodes.some((t) => /官道|江东|许都|北疆/.test(t)), nodes.join(' / '));
  check('不再有今日军功说明', (await page.locator('.map-term-note').count()) === 0);
  await page.context().close();
  const rec = await open(save({ homeLevel: 4, battleWins: 7, frontierWins: 2, battleLosses: 3 }));
  await openGoals(rec);
  check('战绩改为牌局与攻郡、守城', (await rec.locator('.home-record').innerText()).includes('胜 7（牌局与攻郡 5 · 守城 2）· 负 3'), await rec.locator('.home-record').innerText());
  await rec.context().close();
});

await scenario('西蜀屯田', async () => {
  const locked = await open(save({ homeLevel: 2 }));
  await locked.getByRole('button', { name: '出征', exact: true }).click();
  await openMap(locked);
  const node = locked.getByRole('button', { name: /西蜀/ });
  check('宅邸 2 级时西蜀未开放', await node.isDisabled() && (await node.innerText()).includes('砖瓦宅后开放'));
  await locked.context().close();

  const page = await open(save({ homeLevel: 3, gold: 10000, ownedPartnerIds: [], claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third'] }));
  const n0 = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await openMap(page);
  await page.getByRole('button', { name: /西蜀/ }).click();
  await page.getByRole('button', { name: /投入 9,000 金/ }).click();
  await page.waitForTimeout(500);
  let s = await read(page);
  check('开荒扣 9000 金并升到 1 级', s.gold === 1000 && s.farmLevel === 1);
  check('金不足时显示差额', await page.getByRole('button', { name: /差 23,000 金/ }).isVisible());
  await page.getByRole('button', { name: /差 23,000 金/ }).click();
  await page.waitForTimeout(300);
  s = await read(page);
  check('金不足不能升级', s.farmLevel === 1 && (await page.locator('.partner-market__notice').innerText()).includes('金不足'));
  await page.getByRole('button', { name: '回府' }).click();
  await page.locator('.home-v2').waitFor();
  const n1 = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  check('屯田后政务收入按比例提高', n1 > n0, `${n0} → ${n1}`);
  await openGoals(page);
  check('任务「西蜀屯田」可领赏', await page.locator('.quest-item').filter({ hasText: '西蜀屯田' }).getByRole('button', { name: '领赏' }).isEnabled().catch(() => false));
  await page.context().close();
});

// 「北疆边患」10 项 v2.2 作废：北疆收起，改为疆域图上的邻郡反攻守城（见文末「守城·」各项）

await scenario('传位', async () => {
  // 未到王城：按钮禁用并说明条件
  const early = await open(save({ homeLevel: 5, gold: 500000 }));
  await early.getByRole('button', { name: '设置与存档' }).click();
  await early.getByText('当前存档').first().waitFor();
  check('未到王城不能传位', (await early.getByRole('button', { name: '传位给下一代' }).isDisabled()) && (await early.locator('.succession-panel').innerText()).includes('王城'));
  await early.context().close();

  // v3.1 改写：王城 + 250,000 金传位得 2 点（前两点 5 万 + 10 万），只换主公——宅邸、屯田、伴侣、兵器都留下，余 10 万金留给新主
  const page = await open(save({ homeLevel: 6, gold: 250000, ownedPartnerIds: ['diaochan'], equippedWeaponId: 'fangtian', ownedWeaponIds: ['xuanjian', 'fangtian'], farmLevel: 2 }));
  const before = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  await page.getByRole('button', { name: '设置与存档' }).click();
  await page.getByText('当前存档').first().waitFor();
  check('传位面板预告可得点数', (await page.locator('.succession-panel').innerText()).includes('可得 2 点'));
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '传位给下一代' }).click();
  await page.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  let s = await read(page);
  check('传位后进入选主公、只换主公（宅邸伴侣兵器屯田都在）', s.generation === 2 && s.legacyPoints === 2 && s.gold === 100000 && s.homeLevel === 6 && s.farmLevel === 2 && s.ownedPartnerIds.includes('diaochan') && s.equippedWeaponId === 'fangtian' && s.selectedLordId === null, JSON.stringify({ g: s.generation, lp: s.legacyPoints, gold: s.gold, h: s.homeLevel }));
  await page.getByRole('button', { name: '确认选择' }).click();
  // 伴侣还在，不再走选伴侣页，直接回主城
  await page.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  s = await read(page);
  const nextIncome = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  check('新一代保留家业点且收入提高', s.generation === 2 && s.legacyPoints === 2 && nextIncome > before * 1.05, `${before} → ${nextIncome}`);
  check('主城显示第 2 代', (await page.locator('.home-hud').innerText()).includes('第 2 代'));
  await openGoals(page);
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
  check('事件直接弹窗', (await page.getByRole('dialog', { name: '府中事件' }).count()) === 1);
  await page.getByRole('button', { name: '稍后再说' }).click();
  check('稍后再说后主按钮改为去定夺且不过日', (await page.locator('.home-actions__main').innerText()).includes('府中来报') && (await page.locator('.choice-card').count()) === 0);
  await page.locator('.home-actions__main').click();
  check('待决断时点主按钮重新弹出事件、不推进日子', (await page.locator('.choice-card').isVisible()) && (await read(page)).day === s.day);
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
  // 练兵之策在斗地主上生效：选场写明翻倍，胜则清除、负则保留
  await adv.getByRole('button', { name: '出征', exact: true }).click();
  await adv.getByRole('button', { name: /初级场/ }).click();
  const summaryText = await adv.locator('.venue-summary').first().innerText();
  check('出征面板标明练兵翻倍', summaryText.includes('练兵之策 ×2'), summaryText.slice(0, 80));
  await adv.getByRole('button', { name: /^进入斗地主/ }).click();
  await adv.getByText('斗地主牌局').first().waitFor();
  await playOut(adv);
  await adv.waitForTimeout(400);
  const after = await read(adv);
  const won = (await adv.locator('.doudizhu-result-banner').innerText()).includes('牌局得胜');
  check('胜利后清除练兵加成、失手则保留', won ? after.nextBattleBonus === null : after.nextBattleBonus === 2, `${won ? '胜' : '负'} bonus=${after.nextBattleBonus}`);
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
  // v3.1 改写：本朝称号 6 个（白身/乡绅/侯门显贵/百战之将/金汤之将/一代枭雄）
  const fresh = await open(save({ homeLevel: 1, battleWins: 0, ownedPartnerIds: [] }));
  const hud = await fresh.locator('.home-hud').innerText();
  await openGoals(fresh);
  check('开局称号为白身并提示下一称号', hud.includes('「白身」') && (await fresh.locator('.honor-hint').innerText()).includes('乡绅'));
  await fresh.context().close();
  const vet = await open(save({ homeLevel: 6, battleWins: 31, navalWins: 5, courtWins: 1, frontierWins: 0, farmLevel: 2, generation: 1, fiefs: { nanyang: 'farming', runan: 'farming', yingchuan: 'military' } }));
  const hud2 = await vet.locator('.home-hud').innerText();
  await openGoals(vet);
  const hint2 = await vet.locator('.honor-hint').innerText();
  // 6 个本朝称号里只差金汤之将（守城 0）
  check('显示档位最高的称号，并提示还有几个未集齐', hud2.includes('「一代枭雄」') && hint2.includes('另有 1 个称号待集齐'), hint2);
  await vet.context().close();
  // 第二代：家声不盖住本朝称号；提示指向更高的本朝称号（乡绅之后是侯门显贵）
  const heir = await open(save({ homeLevel: 3, battleWins: 2, generation: 2, legacyPoints: 2, earnedTitles: ['founder'] }));
  const hud3 = await heir.locator('.home-hud').innerText();
  await openGoals(heir);
  const hint3 = await heir.locator('.honor-hint').innerText();
  check('第二代显示本朝称号而非旧誉', hud3.includes('「乡绅」') && !hud3.includes('「开国元勋」') && hint3.includes('侯门显贵'), `${hud3.replace(/\n/g, ' ').slice(0, 60)} | ${hint3}`);
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
  await openGoals(page);
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
  const partnerBtn = page.getByRole('button', { name: '伴侣', exact: true });
  const incomeBtn = page.getByRole('button', { name: /^处理政务/ });
  check('第 2 步：钱不够时高亮处理政务', (await panel.innerText()).includes('第 2 步') && (await incomeBtn.getAttribute('class')).includes('is-guided') && !(await partnerBtn.getAttribute('class')).includes('is-guided'));
  await page.evaluate(([k]) => { const s = JSON.parse(localStorage.getItem(k)); s.gold = 5000; localStorage.setItem(k, JSON.stringify(s)); }, [KEY]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await incomeBtn.waitFor();
  check('钱够了高亮招募伴侣', (await partnerBtn.getAttribute('class')).includes('is-guided'));
  // 引导卡里有怎么玩说明，按钮能直接执行这一步
  check('引导卡写明怎么玩', (await panel.innerText()).includes('赚钱') && (await panel.innerText()).includes('出征'));
  await page.locator('.starter-do').click();
  await page.waitForTimeout(300);
  check('引导卡按钮直接打开招募', await page.getByRole('dialog').isVisible().catch(() => false));
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '跳过引导' }).click();
  await page.waitForTimeout(300);
  check('跳过后引导消失', !(await panel.isVisible().catch(() => false)) && (await read(page)).tutorialDone === true);
  await page.context().close();
});

await scenario('主公与称号页', async () => {
  const page = await open(save({ homeLevel: 4, battleWins: 12 }));
  await page.getByRole('button', { name: '主公' }).click();
  await page.getByRole('dialog', { name: '主公' }).waitFor();
  const rows = await page.locator('.title-row').count();
  const earned = await page.locator('.title-row.is-earned').count();
  // v3.1：11 个称号（本朝 6 + 家声 5）；府邸 + 12 胜只得白身、乡绅两个，每行写明效果
  const rowText = await page.locator('.title-list').first().innerText();
  check('主公页列出全部称号并标出已获得', rows === 11 && earned === 2 && rowText.includes('每朝开局军令满') && (await page.locator('.lord-sheet').innerText()).includes('吕布'), `rows=${rows} earned=${earned}`);
  await page.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '伴侣', exact: true }).click();
  await page.getByRole('button', { name: /闲话家常/ }).click();
  check('伴侣互动注明纯剧情', (await page.locator('.modal-note').innerText()).includes('不改数值'));
  await page.context().close();
});

await scenario('竖屏两行手牌', async () => {
  const page = await open(save({ homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await page.getByRole('button', { name: '出征', exact: true }).click();
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
  // 手牌紧密叠放：每张只露左侧一条角标，点露出的那条（点牌中心会点到压在上面的下一张）
  await target.click({ position: { x: 10, y: 20 } });
  await page.waitForTimeout(200);
  const selected = await page.locator('.player-hand .poker-card.is-selected').getAttribute('data-card-id');
  check('点上排的牌能选中正确的那张', selected === id, `${id} → ${selected}`);
  await page.context().close();
});

// 「战斗加速与押注上限」v2.2 作废：自动战只剩北疆一处入口，北疆收起后 HP 自动战已无入口（引擎代码保留到下个版本整体删除）

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
  await page.getByRole('button', { name: '伴侣', exact: true }).click();
  await page.getByText('伴侣招募').first().waitFor();
  const priceOf = async (name) => Number((await page.locator('.partner-card').filter({ hasText: name }).getByRole('button').innerText()).replace(/[^\d]/g, ''));
  const d = await priceOf('貂蝉'), c = await priceOf('蔡文姬'), z = await priceOf('甄姬');
  const tags = (await page.locator('.partner-card').filter({ hasText: '貂蝉' }).innerText()) + (await page.locator('.partner-card').filter({ hasText: '蔡文姬' }).innerText());
  check('伴侣按品级定价（传说 > 名姬 > 贤助）', d > z && z > c && tags.includes('传说') && tags.includes('贤助'), `${d}/${z}/${c}`);
  await page.context().close();
  // 「北疆中途刷新」v2.2 迁到「守城·刷新保留可重打」
});

await scenario('军令', async () => {
  // 0 道军令：出征按钮禁用并写明几日后回复；守城不受限（v2.2 由北疆边患迁来）
  const now = Date.now();
  const page = await open(save({ day: 10, orders: 0, homeLevel: 5, fiefs: { nanyang: 'farming' }, fiefTakenAt: { nanyang: now - 100 * 3600e3 }, nextSiegeAt: now + 3600e3, siege: { fiefId: 'nanyang', attacker: '张绣', skill: 'novice', startedAt: now, dueAt: now + 3600e3 } }));
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await openMap(page);
  // v2.3 军令上限 6 → 8
  check('出征页标题显示军令', (await page.locator('.screen-header').first().innerText()).includes('军令 0/8'));
  await page.locator('.map-node').filter({ hasText: '荆州' }).click();
  const go = page.getByRole('button', { name: /军令不足/ });
  // v2.3 军令按真实时间回：按钮写「下一道约 N 分 / 约 N 小时」
  check('军令为 0 时不能进斗地主', (await go.isDisabled()) && /下一道约 [\d.]+ (分|小时)/.test(await go.innerText()), await go.innerText());
  await page.getByRole('button', { name: '斗地主', exact: true }).click();
  await page.locator('.conquest-map g.conquest-node').filter({ hasText: '南阳' }).click({ force: true });
  await page.getByRole('button', { name: /迎战守城/ }).click();
  await page.getByText('守卫南阳郡').first().waitFor();
  check('守城不耗军令（0 道也能迎战）', (await read(page)).orders === 0 && (await read(page)).activeBattle?.conquest?.kind === 'defend');
  await page.context().close();
  // 进斗地主扣 1 道；处理政务到双数日回 1 道（府邸起每 2 日）
  const p2 = await open(save({ day: 11, orders: 2, gold: 5000, homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await p2.getByRole('button', { name: '出征', exact: true }).click();
  await p2.getByRole('button', { name: /初级场/ }).click();
  await p2.getByRole('button', { name: /^进入斗地主 · 耗 1 军令/ }).click();
  await p2.getByText('斗地主牌局').first().waitFor();
  check('进斗地主扣 1 道军令', (await read(p2)).orders === 1);
  await p2.reload({ waitUntil: 'domcontentloaded' });
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
  // 军令已满时选「募为乡勇」：不增加，纪事写明已满而不是 +1
  // v2.3 军令上限 6 → 8：满额存档改成 8 道
  const full = await open(save({ day: 19, gold: 5000, homeLevel: 2, ownedPartnerIds: [], orders: 8 }));
  await full.getByRole('button', { name: /^处理政务/ }).click();
  await full.waitForTimeout(400);
  await full.locator('.choice-card__options button').nth(1).click();
  await full.waitForTimeout(300);
  s = await read(full);
  check('军令已满时募为乡勇纪事写明未增加', s.orders === 8 && s.eventLog[0]?.detail.includes('军令已满，未增加') && !s.eventLog[0]?.detail.includes('+1'), `orders=${s.orders} ${s.eventLog[0]?.detail}`);
  await full.context().close();
});

await scenario('第五轮修复', async () => {
  // 传位点数封顶：已有 18 点、手上 234 万金，只能再换 2 点
  const rich = await open(save({ homeLevel: 6, gold: 2345678, legacyPoints: 18, generation: 3 }));
  const hintText = await rich.locator('.chance-bar').textContent();
  check('主城传位提示按上限封顶', hintText.includes('换 2 点'), hintText.replace(/\n/g, ' ').slice(0, 80));
  const gold = await rich.locator('.home-hud__chips strong').first().innerText();
  check('百万以上金币用「万」显示', gold === '234.6万', gold);
  const chipsFit = await rich.locator('.home-hud__chips strong').evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1));
  check('顶栏数字不溢出', chipsFit);
  await rich.getByRole('button', { name: '设置与存档' }).click();
  await rich.getByText('当前存档').first().waitFor();
  const panel = await rich.locator('.succession-panel').innerText();
  // v3.1 改写：递增价下第 19、20 点共 195 万，余下的金留给新主（不再有「多出的点换不到」）
  check('传位面板说明封顶与余金', panel.includes('可得 2 点') && panel.includes('余 395,678 金') && panel.includes('累计 20 点'), panel.replace(/\n/g, ' ').slice(0, 200));
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
  // v3.1 改写：不再「起手 N 金」，新主承袭宅邸与余金（25 万折 2 点花 15 万，余 10 万）
  check('标题页显示待择新主与承袭家业', saveText.includes('第 2 代 · 待择新主') && saveText.includes('承袭王城') && saveText.includes('存金 100,000'), saveText.replace(/\n/g, ' '));
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
  await armory.getByRole('button', { name: '兵器', exact: true }).click();
  await armory.getByRole('dialog', { name: '兵器库' }).waitFor();
  await armory.locator('.weapon-card').filter({ hasText: '双股剑' }).getByRole('button', { name: /购入/ }).click();
  await armory.waitForTimeout(300);
  const w = await read(armory);
  check('买弱兵器不自动换装', w.ownedWeaponIds.includes('shuanggu') && w.equippedWeaponId === 'qinggang' && (await armory.locator('.partner-market__notice').innerText()).includes('收进兵器库'), `eq=${w.equippedWeaponId}`);
  await armory.context().close();
});

await scenario('传位并入府库未收的金子', async () => {
  // v2.3 复核修复：府库里没收的金子传位时先按钱粮全额并入再折家业点，界面写明（原先静默清零）
  const page = await open(save({ homeLevel: 6, gold: 150000, ownedPartnerIds: ['diaochan'], clockVersion: 1, clockAt: Date.now(), orderClockAt: Date.now(), treasury: { gold: 120000, days: 5 } }), { realtime: true, dayMs: 0 });
  await page.waitForTimeout(300);
  const chips = (await page.locator('.home-v2').textContent()) ?? '';
  check('首页传位提示按手上加府库算并写明含府库', /可传位换 2 点家业点/.test(chips) && chips.includes('含府库未收 120,000 金'), chips.replace(/\n/g, ' ').slice(0, 300));
  await page.getByRole('button', { name: '设置与存档' }).click();
  await page.getByText('当前存档').first().waitFor();
  const panel = await page.locator('.succession-panel').innerText();
  check('传位面板写明府库尚有多少未收、可得点数含府库', panel.includes('府库尚有 120,000 金未收取') && panel.includes('可得 2 点'), panel.replace(/\n/g, ' '));
  let dialogText = '';
  page.on('dialog', (d) => { dialogText = d.message(); d.accept(); });
  await page.getByRole('button', { name: '传位给下一代' }).click();
  await page.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  const s = await read(page);
  check('确认框提示府库先并入', dialogText.includes('府库尚有 120,000 金未收取'), dialogText);
  check('传位按手上加府库折点，家谱记 27 万金', s.legacyPoints === 2 && s.treasury.gold === 0 && s.chronicle.at(-1)?.gold === 270000, JSON.stringify({ lp: s.legacyPoints, t: s.treasury, c: s.chronicle.at(-1) }));
  await page.context().close();
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
  // v3.1：伴侣留着，择主后直接回主城；25 万折 2 点花 15 万，余 10 万留给新主
  check('传位后刷新标题页写待择新主与承袭宅邸', title.includes('待择新主') && title.includes('承袭王城'), title.replace(/\n/g, ' ').slice(0, 120));
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  const s = await read(page);
  check('传位后刷新再选主公仍是第 2 代且保留家业点', s.generation === 2 && s.legacyPoints === 2 && s.gold === 100000 && s.homeLevel === 6 && s.tutorialDone === true, `title=${title.includes('继续家业')} g=${s.generation} lp=${s.legacyPoints} gold=${s.gold}`);
  check('第 2 代不再出现开局引导', !(await page.locator('[aria-label="开局引导"]').isVisible().catch(() => false)));
  await page.context().close();
});

await scenario('封地经略', async () => {
  const power = async (page) => Number((await page.locator('.home-hud__chips div').nth(1).innerText()).match(/\d+/)[0]);
  // 侯府 + 16 万金：机会栏提示可攻南阳郡 → 点开就是疆域图；整军郡军令上限 7、任务可领（直接给存档验效果，攻郡胜负见「疆域图攻郡」）
  const page = await open(save({ homeLevel: 5, gold: 160000, orders: 3, claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third', 'first-win', 'power-200', 'naval-first-win', 'court-first-win', 'farm-first'] }));
  const base = await open(save({ homeLevel: 5, gold: 160000 }));
  const n0 = income(await base.getByRole('button', { name: /^处理政务/ }).innerText());
  const p0 = await power(base);
  await base.context().close();
  check('侯府且军资够时机会栏提示攻郡', (await page.locator('.chance-bar').textContent()).includes('可攻南阳郡'));
  await chance(page, /可攻南阳郡/);
  await page.locator('.conquest-map').waitFor();
  check('攻郡提示直达疆域图并选中南阳', (await page.locator('.conquest-panel').innerText()).includes('南阳郡 · 守将 张绣'));
  await page.context().close();
  const held = await open(save({ homeLevel: 5, gold: 160000, fiefs: { nanyang: 'military' }, claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third', 'first-win', 'power-200', 'naval-first-win', 'court-first-win', 'farm-first'] }));
  check('整军后军令上限 9（v2.3 基础 8）', (await held.locator('.home-hud__chips').innerText()).includes('/9'));
  await openGoals(held);
  check('任务「初封一郡」可领赏', await held.locator('.quest-item').filter({ hasText: '初封一郡' }).getByRole('button', { name: '领赏' }).isEnabled().catch(() => false));
  await held.context().close();
  let s;

  // 劝农：收入提高；教化：武力 +4
  const farming = await open(save({ homeLevel: 5, gold: 160000, fiefs: { nanyang: 'farming' } }));
  const n1 = income(await farming.getByRole('button', { name: /^处理政务/ }).innerText());
  check('劝农封地提高政务收入', n1 > n0, `${n0} → ${n1}`);
  await farming.context().close();
  const schooling = await open(save({ homeLevel: 5, gold: 160000, fiefs: { nanyang: 'schooling' } }));
  check('教化封地武力 +4', (await power(schooling)) === p0 + 4, `${p0} → ${await power(schooling)}`);
  await schooling.context().close();

  // 改方略：在疆域图上点已有的郡；整军 → 劝农收一成费，超出上限的军令收回
  // v2.3 军令上限 6 → 8：整军郡上限 9，存 9 道改劝农后收回到 8
  const change = await open(save({ homeLevel: 5, gold: 20000, orders: 9, fiefs: { nanyang: 'military' } }));
  await change.getByRole('button', { name: '出征', exact: true }).click();
  await change.locator('.conquest-map g.conquest-node').filter({ hasText: '南阳' }).click({ force: true });
  await change.getByRole('button', { name: /改行劝农 · 15,000 金/ }).click();
  await change.waitForTimeout(400);
  s = await read(change);
  check('改方略扣一成费并收回超额军令', s.gold === 5000 && s.fiefs.nanyang === 'farming' && s.orders === 8, JSON.stringify({ gold: s.gold, fiefs: s.fiefs, orders: s.orders }));
  await change.context().close();

  // 存档断档：没有南阳却有汝南（汝南只与南阳相邻）→ 作废
  const broken = await open(save({ homeLevel: 5, fiefs: { runan: 'farming' } }));
  await broken.waitForTimeout(300);
  check('断档封地存档被清理', Object.keys((await read(broken)).fiefs ?? {}).length === 0);
  await broken.context().close();

  // 传位保留封地
  const heir = await open(save({ homeLevel: 6, gold: 250000, fiefs: { nanyang: 'farming', runan: 'military' } }));
  await heir.getByRole('button', { name: '设置与存档' }).click();
  await heir.getByText('当前存档').first().waitFor();
  check('传位面板写明封地留给新主', /宅邸、屯田、封地、伴侣、兵器与任务都留给新主/.test(await heir.locator('.succession-panel').innerText()));
  heir.on('dialog', (d) => d.accept());
  await heir.getByRole('button', { name: '传位给下一代' }).click();
  await heir.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  s = await read(heir);
  check('传位后封地保留', s.generation === 2 && s.fiefs?.nanyang === 'farming' && s.fiefs?.runan === 'military', JSON.stringify(s.fiefs));
  await heir.context().close();
});

await scenario('本代志向与家谱', async () => {
  // 第一代不出现志向卡
  const gen1 = await open(save({ generation: 1 }));
  check('第一代没有志向卡', !(await gen1.locator('main').innerText()).includes('本代志向'));
  await gen1.context().close();

  // 第二代：三选一 → 选强兵（目标 30 胜）→ 任务面板显示进度
  const page = await open(save({ generation: 2, legacyPoints: 2, battleWins: 5 }));
  check('第二代主城出现志向三选一', (await page.locator('.ambition-card').innerText()).includes('富国') && (await page.locator('.ambition-card').innerText()).includes('开疆'));
  await page.locator('.ambition-options button').filter({ hasText: '强兵' }).click();
  await page.waitForTimeout(300);
  let s = await read(page);
  check('选强兵后存档记录目标 30 胜', s.ambition?.id === 'might' && s.ambition?.target === 30, JSON.stringify(s.ambition));
  await openGoals(page);
  check('志向卡消失且显示进度', !(await page.locator('.ambition-card').isVisible().catch(() => false)) && (await page.locator('.ambition-progress').innerText()).includes('现 5 胜'));
  await page.context().close();

  // v3.1 改写：六郡已满时开疆不再隐藏，改为「本代守住 2 次邻郡反攻」（侯府，未到王城所以还没天下归心）
  const full = await open(save({ generation: 2, homeLevel: 5, frontierWins: 4, fiefs: { nanyang: 'farming', runan: 'farming', yingchuan: 'farming', changsha: 'farming', bajun: 'farming', liaodong: 'farming' } }));
  const fullCard = await full.locator('.ambition-card').innerText();
  check('六郡已满开疆改为守城 2 次', fullCard.includes('开疆') && fullCard.includes('本代守住 2 次邻郡反攻'), fullCard.replace(/\n/g, ' '));
  await full.locator('.ambition-options button').filter({ hasText: '开疆' }).click();
  await full.waitForTimeout(300);
  const fs = await read(full);
  await openGoals(full);
  // 本代守城胜场按本代起点算（老存档起点 0，本代已守住 4 次即达成）
  check('开疆守城：目标 2、进度按本代守城胜场', fs.ambition?.id === 'expansion' && fs.ambition?.target === 2 && (await full.locator('.ambition-progress').first().innerText()).includes('现 4 次，已达成'), JSON.stringify(fs.ambition));
  await full.context().close();

  // 达成富国后传位：家谱记一笔达成，传位时得 1 点家业点（v3.1 改写，原为下一代开局多 10,000 金）；家谱在主公页可见
  const heir = await open(save({ generation: 2, legacyPoints: 2, homeLevel: 6, gold: 600000, ambition: { id: 'wealth', target: 500000, baseFiefs: 0 } }));
  await openGoals(heir);
  check('达成志向后进度行提示', (await heir.locator('.ambition-progress').innerText()).includes('已达成'));
  await closeGoals(heir);
  await heir.getByRole('button', { name: '设置与存档' }).click();
  await heir.getByText('当前存档').first().waitFor();
  heir.on('dialog', (d) => d.accept());
  await heir.getByRole('button', { name: '传位给下一代' }).click();
  await heir.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  s = await read(heir);
  check('传位后家谱记录志向达成', s.chronicle?.length === 1 && s.chronicle[0].generation === 2 && s.chronicle[0].ambitionDone === true && s.ambition === null, JSON.stringify(s.chronicle));
  await heir.getByRole('button', { name: '确认选择' }).click();
  await heir.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  s = await read(heir);
  // 60 万从第 3 点起折：15+20+25 万 = 3 点正好花完；志向再 +1 点 → 共 6 点
  check('志向达成传位得 1 点家业点', s.generation === 3 && s.legacyPoints === 6 && s.gold === 0, `gold=${s.gold} lp=${s.legacyPoints}`);
  check('第三代志向目标递增', (await heir.locator('.ambition-card').innerText()).includes('750,000'));
  await heir.getByRole('button', { name: '主公' }).click();
  check('主公页显示家谱', (await heir.locator('.chronicle').last().innerText()).includes('第 2 代') && (await heir.locator('.chronicle').last().innerText()).includes('达成'));
  await heir.context().close();
});

await scenario('伴侣心事第二段', async () => {
  // 貂蝉第一段已了却：第 25 日轮到第二段「故地重游」，加成累加
  const page = await open(save({ day: 24, ownedPartnerIds: ['diaochan'], resolvedPartnerEvents: { diaochan: 'a' }, partnerBoosts: { diaochan: { strength: 6 } } }));
  await page.getByRole('button', { name: /^处理政务/ }).click();
  await page.waitForTimeout(400);
  let s = await read(page);
  check('第 25 日起第二段心事', s.pendingChoice?.eventId === 'partner:diaochan#2' && (await page.locator('.choice-card').innerText()).includes('故地重游'), JSON.stringify(s.pendingChoice));
  await page.locator('.choice-card__options button').filter({ hasText: '亲自护送' }).click();
  await page.waitForTimeout(300);
  s = await read(page);
  check('第二段加成累加且分段记录', s.partnerBoosts?.diaochan?.strength === 12 && s.resolvedPartnerEvents?.['diaochan#2'] === 'a' && s.resolvedPartnerEvents?.diaochan === 'a', JSON.stringify({ b: s.partnerBoosts, r: s.resolvedPartnerEvents }));
  await page.context().close();
});

await scenario('志向审查修复', async () => {
  const page = await open(save({ generation: 2, legacyPoints: 2 }));
  await page.getByRole('button', { name: '稍后再定' }).click();
  check('稍后再定后折叠成一行', !(await page.locator('.ambition-card').isVisible().catch(() => false)) && (await page.locator('.chance-bar').textContent()).includes('志向未定'));
  await chance(page, /本代志向未定/);
  check('可重新展开选择', await page.locator('.ambition-card').isVisible());
  await page.context().close();

  const tampered = await open(save({ generation: 2, ambition: { id: 'wealth', target: 1, baseFiefs: 0 } }));
  await tampered.waitForTimeout(300);
  check('存档里的志向目标按世代重算', (await read(tampered)).ambition?.target === 500000, JSON.stringify((await read(tampered)).ambition));
  check('HUD 显示志向进度', (await tampered.locator('.home-hud__ambition').innerText()).includes('富国'));
  await tampered.context().close();

  const gen1 = await open(save({ generation: 1, ambition: { id: 'might', target: 30, baseFiefs: 0 } }));
  await gen1.waitForTimeout(300);
  check('第一代的志向字段被清空', (await read(gen1)).ambition === null);
  await gen1.context().close();

  const undone = await open(save({ generation: 2, homeLevel: 6, gold: 150000, battleWins: 9, ambition: { id: 'might', target: 30, baseFiefs: 0 } }));
  check('机会栏传位项提示志向未竟', (await undone.locator('.chance-bar').textContent()).includes('还差 21 胜'));
  await undone.getByRole('button', { name: '设置与存档' }).click();
  await undone.getByText('当前存档').first().waitFor();
  check('传位面板写明志向未竟', (await undone.locator('.succession-panel').innerText()).includes('未竟'));
  await undone.context().close();
});

await scenario('天下归心与新朝', async () => {
  const six = { nanyang: 'farming', runan: 'farming', yingchuan: 'military', changsha: 'farming', bajun: 'farming', liaodong: 'farming' };
  // v3.1 改写：统一 = 六郡 + 王城，不看家业点与世代。家业点 0 的第一代即出终局卡；五郡不出
  const zeroLp = await open(save({ homeLevel: 6, legacyPoints: 0, generation: 1, fiefs: six }));
  check('家业点 0 + 六郡 + 王城即出统一卡', (await zeroLp.locator('.ending-hint').innerText()).includes('六郡尽归、王城巍峨') && (await read(zeroLp)).earnedTitles.includes('unifier'));
  await zeroLp.context().close();
  const five = { ...six };
  delete five.liaodong;
  const almost = await open(save({ homeLevel: 6, legacyPoints: 20, generation: 3, fiefs: five }));
  check('五郡 + 王城不出终局卡、提示再得 1 郡', !(await almost.locator('main').innerText()).includes('展开卷轴') && (await almost.locator('.chance-bar').textContent()).includes('再得 1 郡即天下归心'));
  await almost.context().close();

  const page = await open(save({ homeLevel: 6, legacyPoints: 20, generation: 3, gold: 50000, battleWins: 12, day: 30, fiefs: six, chronicle: [{ generation: 1, lordId: 'lvbu', days: 40, gold: 250000, wins: 31, fiefs: 0, ambition: null, ambitionDone: false }, { generation: 2, lordId: 'caocao', days: 36, gold: 620000, wins: 28, fiefs: 1, ambition: 'wealth', ambitionDone: true }] }));
  check('条件齐全出终局卡且 HUD 带天下归心', (await page.locator('.ending-hint').innerText()).includes('天下归心') && !(await page.locator('.home-hud').innerText()).includes('天下归心'));
  await page.getByRole('button', { name: '展开卷轴 →' }).click();
  const scroll = await page.locator('.ending-sheet__scroll').innerText();
  check('卷轴汇总三代总账', scroll.includes('共 3 代') && scroll.includes('106 日') && scroll.includes('71 场胜利') && scroll.includes('1 代志向达成'), scroll);
  await page.getByRole('radio', { name: /蜀/ }).click();
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /开创新朝 · 国号蜀/ }).click();
  await page.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  let s = await read(page);
  check('开创新朝后全部重来只留国号', s.realms?.shu === 1 && s.generation === 1 && s.legacyPoints === 0 && Object.keys(s.fiefs ?? {}).length === 0 && s.chronicle?.length === 0 && s.pastDynasties?.length === 1 && s.pastDynasties[0].generations === 3, JSON.stringify({ realms: s.realms, past: s.pastDynasties }));
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: '携美人，共创家业' }).click();
  await page.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  s = await read(page);
  const shuIncome = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  check('新朝开局多得 20,000 金且显示第 2 朝', s.gold === 21000 && (await page.locator('.home-hud').innerText()).includes('第 2 朝'), `gold=${s.gold}`);
  await page.context().close();
  const plain = await open(save({ homeLevel: 1, gold: 1000, ownedPartnerIds: ['zhenji'] }));
  const plainIncome = income(await plain.getByRole('button', { name: /^处理政务/ }).innerText());
  check('国号蜀收入高于无国号', shuIncome > plainIncome, `${plainIncome} → ${shuIncome}`);
  await plain.context().close();

  // 国号魏：军令上限 +1
  const wei = await open(save({ realms: { wei: 1, shu: 0, wu: 0 } }));
  check('国号魏军令上限 9（v2.3 基础 8）', (await wei.locator('.home-hud__chips').innerText()).includes('/9'));
  await wei.context().close();
});

await scenario('新朝审查修复', async () => {
  const six = { nanyang: 'farming', runan: 'farming', yingchuan: 'military', changsha: 'farming', bajun: 'farming', liaodong: 'farming' };
  // 终局时不出志向卡；关闭卷轴后终局卡折叠
  const end = await open(save({ homeLevel: 6, legacyPoints: 20, generation: 3, fiefs: six }));
  check('终局时不再出志向卡', !(await end.locator('.ambition-card').isVisible().catch(() => false)));
  await end.getByRole('button', { name: '展开卷轴 →' }).click();
  await end.getByRole('button', { name: '再经营些时日' }).click();
  check('关闭卷轴后终局卡折叠进机会栏', (await end.locator('.chance-bar').textContent()).includes('天下归心') && !(await end.locator('.ending-hint').isVisible().catch(() => false)));
  await end.context().close();

  // 新朝后择主前刷新：标题页仍是「继续家业」且显示第 2 朝
  const page = await open(save({ screen: 'lordSelect', lastScreen: 'lordSelect', selectedLordId: null, generation: 1, legacyPoints: 0, realms: { wei: 1, shu: 0, wu: 0 }, pastDynasties: [{ dynasty: 1, realm: 'wei', generations: 3, days: 100, wins: 70, ambitions: 1 }] }));
  // 没有主公的存档读档直接落标题页
  await page.getByText('家业天下').first().waitFor();
  check('新朝待择主时标题页可继续', (await page.getByRole('button', { name: '继续家业' }).isVisible()) && (await page.locator('.title-screen__save').innerText()).includes('第 2 朝'));
  await page.getByRole('button', { name: '继续家业' }).click();
  check('择主页显示朝代横幅', (await page.locator('.dynasty-banner').innerText()).includes('国号加成 魏×1'));
  await page.context().close();

  // 重开基业保留国号与前朝
  const restart = await open(save({ screen: 'title', lastScreen: 'title', realms: { wei: 1, shu: 1, wu: 0 }, pastDynasties: [{ dynasty: 1, realm: 'wei', generations: 2, days: 70, wins: 50, ambitions: 1 }, { dynasty: 2, realm: 'shu', generations: 2, days: 60, wins: 40, ambitions: 0 }] }));
  restart.on('dialog', (d) => d.accept());
  await restart.getByRole('button', { name: '重开基业' }).click();
  await restart.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  const s = await read(restart);
  check('重开基业保留国号与前朝', s.realms?.wei === 1 && s.realms?.shu === 1 && s.pastDynasties?.length === 2 && s.generation === 1, JSON.stringify({ r: s.realms, p: s.pastDynasties?.length }));
  await restart.context().close();

  // 脏前朝记录：重编号并以前朝反推国号
  const dirty = await open(save({ realms: { wei: 0, shu: 0, wu: 0 }, pastDynasties: [{ dynasty: 7, realm: 'wu', generations: 1e9, days: 1e12, wins: 1, ambitions: 0 }, { dynasty: 7, realm: 'wu', generations: 2, days: 10, wins: 1, ambitions: 0 }] }));
  await dirty.waitForTimeout(300);
  const d = await read(dirty);
  check('前朝脏数据重编号且国号反推', d.pastDynasties?.[1]?.dynasty === 2 && d.pastDynasties?.[0]?.generations === 99 && d.realms?.wu === 2, JSON.stringify({ p: d.pastDynasties, r: d.realms }));
  await dirty.context().close();
});

await scenario('家声跨朝与家业点满', async () => {
  const six = { nanyang: 'farming', runan: 'farming', yingchuan: 'military', changsha: 'farming', bajun: 'farming', liaodong: 'farming' };
  const lineage = async (page) => {
    await page.getByRole('button', { name: '主公' }).click();
    const dialog = page.getByRole('dialog', { name: '主公' });
    const count = Number((await dialog.locator('.title-list').first().locator('.section-title strong').innerText()).split('/')[0]);
    const text = await dialog.innerText();
    await dialog.getByRole('button', { name: '关闭' }).click();
    return { count, text };
  };
  // 终局存档开新朝：家声数不减少，天下归心仍在；v3.1 起家声 5 个（天下归心之外，开新朝后再补再造山河）
  const page = await open(save({ homeLevel: 6, legacyPoints: 20, generation: 3, gold: 50000, fiefs: six, chronicle: [{ generation: 1, lordId: 'lvbu', days: 40, gold: 250000, wins: 31, fiefs: 0, ambition: null, ambitionDone: false }, { generation: 2, lordId: 'caocao', days: 36, gold: 620000, wins: 28, fiefs: 1, ambition: 'wealth', ambitionDone: true }] }));
  const before = await lineage(page);
  await page.getByRole('button', { name: '展开卷轴 →' }).click();
  check('终局卷轴写明新朝是第 2 朝、魏按新朝口径 8 → 9（v2.3 基础 8）', (await page.locator('.ending-sheet').innerText()).includes('第 2 朝') && (await page.getByRole('radio', { name: /魏/ }).innerText()).includes('8 → 9'));
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /开创新朝 · 国号魏/ }).click();
  await page.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: '携美人，共创家业' }).click();
  await page.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  const after = await lineage(page);
  const s = await read(page);
  check('开新朝后家声数不减少', after.count >= before.count + 1 && before.count >= 1 && s.earnedTitles?.includes('unifier') && s.earnedTitles?.includes('restorer'), `${before.count} → ${after.count} ${JSON.stringify(s.earnedTitles)}`);
  await page.context().close();

  // 老存档（无 earnedTitles、有前朝）：补记天下归心；补记的旧家声（开国元勋等）进旧誉，不丢
  const legacy = await open(save({ realms: { wei: 1, shu: 0, wu: 0 }, realm: 'wei', pastDynasties: [{ dynasty: 1, realm: null, generations: 3, days: 100, wins: 70, ambitions: 1 }] }));
  const old = await lineage(legacy);
  const ls = await read(legacy);
  check('老存档有前朝即补记天下归心，旧家声列入旧誉', /「天下归心」\s*已获得/.test(old.text) && old.text.includes('旧誉') && old.text.includes('「六郡之主」') && ['founder', 'eternal', 'marquis', 'six-commanderies', 'unifier'].every((id) => ls.earnedTitles.includes(id)), JSON.stringify(ls.earnedTitles));
  await legacy.context().close();

  // v3.1 改写：家业点满、只有 4 郡——志向卡照常出现（奖励改发 3 万金），首页与传位面板提示再得 2 郡（王城已立）
  const maxed = await open(save({ homeLevel: 6, legacyPoints: 20, generation: 3, gold: 50000, fiefs: { nanyang: 'farming', runan: 'farming', yingchuan: 'military', changsha: 'farming' } }));
  const card = await maxed.locator('.ambition-card').innerText().catch(() => '');
  check('家业点满志向卡仍在、奖励写 3 万金', card.includes('本代志向') && card.includes('30,000 金'), card.replace(/\n/g, ' ').slice(0, 160));
  check('首页提示再得 2 郡', (await maxed.locator('.chance-bar').textContent().catch(() => '')).includes('再得 2 郡即天下归心'));
  await maxed.getByRole('button', { name: '设置与存档' }).click();
  await maxed.getByText('当前存档').first().waitFor();
  const panel = await maxed.locator('.succession-panel').innerText();
  check('传位面板：家业点已满只换主公，提示再得 2 郡', panel.includes('再得 2 郡') && panel.includes('家业点已满') && (await maxed.getByRole('button', { name: '传位给下一代' }).isEnabled()), panel.replace(/\n/g, ' '));
  await maxed.context().close();
});

await scenario('家风', async () => {
  const two = (id) => [{ generation: 1, lordId: 'lvbu', days: 40, gold: 250000, wins: 31, fiefs: 0, ambition: id, ambitionDone: true }, { generation: 2, lordId: 'caocao', days: 36, gold: 620000, wins: 28, fiefs: 1, ambition: id, ambitionDone: true }];
  // 富国家风：传位 8 万 1 点
  const wealth = await open(save({ generation: 3, homeLevel: 6, gold: 160000, chronicle: two('wealth') }));
  check('HUD 显示家风', (await wealth.locator('.home-hud').innerText()).includes('富国家风'));
  await wealth.getByRole('button', { name: '设置与存档' }).click();
  await wealth.getByText('当前存档').first().waitFor();
  check('富国家风传位 8 万 1 点', (await wealth.locator('.succession-panel').innerText()).includes('可得 2 点'));
  await wealth.context().close();
  // 开疆家风：攻郡军资九折（75,000 → 67,500）；v3.1 侯府起「侯门显贵」押金再 −5%（→ 64,125）
  const exp = await open(save({ generation: 3, homeLevel: 5, gold: 70000, orders: 3, chronicle: two('expansion') }));
  check('开疆家风九折后机会栏报折后军资', (await exp.locator('.chance-bar').textContent()).includes('押 64,125 金'));
  await chance(exp, /可攻南阳郡/);
  await exp.locator('.conquest-map').getByRole('button', { name: /出兵攻取南阳郡/ }).click();
  await exp.getByText('攻取南阳郡').first().waitFor();
  check('九折军资扣 64,125', (await read(exp)).gold === 5875);
  await exp.context().close();
  // 强兵家风：传位后新主公开局军令满
  // 第二代达成强兵后传位：两代连达成立，第三代开局即享家风
  const might = await open(save({ generation: 2, homeLevel: 6, gold: 250000, battleWins: 31, ambition: { id: 'might', target: 30, baseFiefs: 0 }, chronicle: [two('might')[0]] }));
  await might.getByRole('button', { name: '设置与存档' }).click();
  await might.getByText('当前存档').first().waitFor();
  might.on('dialog', (d) => d.accept());
  await might.getByRole('button', { name: '传位给下一代' }).click();
  await might.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  await might.getByRole('button', { name: '确认选择' }).click();
  await might.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  // v3.1：传位时补满军令；王城 + 31 胜有「一代枭雄」军令上限 +1 → 9
  check('强兵家风传位军令补满（上限 9 含一代枭雄）', (await read(might)).orders === 9, `orders=${(await read(might)).orders}`);
  await might.context().close();
  // 带整军封地传位：第三代开局军令按含整军加成的上限满额（v2.3 基础 8，9/9）
  const mightFief = await open(save({ generation: 2, homeLevel: 6, gold: 250000, battleWins: 31, fiefs: { nanyang: 'military' }, ambition: { id: 'might', target: 30, baseFiefs: 0 }, chronicle: [two('might')[0]] }));
  await mightFief.getByRole('button', { name: '设置与存档' }).click();
  await mightFief.getByText('当前存档').first().waitFor();
  mightFief.on('dialog', (d) => d.accept());
  await mightFief.getByRole('button', { name: '传位给下一代' }).click();
  await mightFief.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  await mightFief.getByRole('button', { name: '确认选择' }).click();
  await mightFief.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  const mf = await read(mightFief);
  check('强兵家风带整军郡传位军令等于上限 10（基础 8 + 整军 + 一代枭雄）', mf.orders === 10 && (await mightFief.locator('.home-hud__chips').innerText()).includes('10/10'), `orders=${mf.orders}`);
  await mightFief.context().close();
  // 断档：两代志向不同不成家风；志向卡提示再成一次即家风
  const broken = await open(save({ generation: 3, chronicle: [two('wealth')[0], { ...two('might')[1] }] }));
  check('两代志向不同不成家风且提示候选', !(await broken.locator('.home-hud').innerText()).includes('家风') && (await broken.locator('.ambition-card').innerText()).includes('再成一次即立家风'));
  await broken.context().close();
});

await scenario('府中小事与领赏角标', async () => {
  // 第 7 → 8 日：轮到貂蝉的「寿宴」，选大办 → 声望 +2
  const page = await open(save({ day: 7, ownedPartnerIds: ['diaochan'], claimedQuestIds: ['upgrade-wood'] }));
  check('有可领任务时机会栏出现领赏角标', (await page.locator('.chance-bar').textContent()).includes('可领赏'));
  await page.getByRole('button', { name: /^处理政务/ }).click();
  await page.waitForTimeout(400);
  let s = await read(page);
  check('第 8 日起府中小事', s.pendingChoice?.eventId === 'minor:feast:diaochan' && (await page.locator('.choice-card').innerText()).includes('寿宴'), JSON.stringify(s.pendingChoice));
  await page.locator('.choice-card__options button').filter({ hasText: '大办' }).click();
  await page.waitForTimeout(300);
  s = await read(page);
  check('小事选项给伴侣加 2 点', s.partnerBoosts?.diaochan?.charisma === 2 && s.pendingChoice === null, JSON.stringify(s.partnerBoosts));
  await page.context().close();
  // 第 37 → 38 日：第二轮换模板「偶感风寒」，遣军医 → 军令 +1
  const p2 = await open(save({ day: 37, orders: 2, ownedPartnerIds: ['diaochan', 'zhenji'] }));
  await p2.getByRole('button', { name: /^处理政务/ }).click();
  await p2.waitForTimeout(400);
  s = await read(p2);
  check('第 38 日换伴侣换模板', s.pendingChoice?.eventId === 'minor:ill:zhenji', JSON.stringify(s.pendingChoice));
  await p2.locator('.choice-card__options button').filter({ hasText: '遣军医' }).click();
  await p2.waitForTimeout(300);
  // 第 38 日本身回 1 道（2→3），再加军医 +1
  check('遣军医军令 +1', (await read(p2)).orders === 4, `orders=${(await read(p2)).orders}`);
  await p2.context().close();
});

await scenario('国号专属与小事离线结算', async () => {
  // 吴：斗地主胜利缴获 ×1.2（无国号时同场对照）
  const venueOf = async (page) => { await page.getByRole('button', { name: '出征', exact: true }).click(); await page.getByRole('button', { name: /初级场/ }).click(); return page.locator('.venue-summary').first().innerText(); };
  const plain = await open(save({ homeLevel: 4 }));
  const baseText = await venueOf(plain);
  await plain.context().close();
  const wu = await open(save({ homeLevel: 4, realms: { wei: 0, shu: 0, wu: 1 }, realm: 'wu' }));
  const boostedText = await venueOf(wu);
  const gold = (t) => Number(t.match(/胜缴获 ([\d,]+) 金/)?.[1].replace(/,/g, '') ?? NaN);
  check('国号吴斗地主缴获 ×1.2 并写明', gold(boostedText) === Math.round(gold(baseText) * 1.2) && boostedText.includes('（国号吴 +20%）'), `${gold(baseText)} → ${gold(boostedText)}`);
  await wu.context().close();
  // 蜀：屯田九折
  const shu = await open(save({ homeLevel: 3, gold: 10000, realms: { wei: 0, shu: 1, wu: 0 }, realm: 'shu' }));
  await shu.getByRole('button', { name: '出征', exact: true }).click();
  await openMap(shu);
  await shu.getByRole('button', { name: /西蜀/ }).click();
  await shu.getByRole('button', { name: /投入 8,100 金/ }).click();
  await shu.waitForTimeout(300);
  check('国号蜀屯田九折扣款', (await read(shu)).gold === 1900 && (await read(shu)).farmLevel === 1, `gold=${(await read(shu)).gold}`);
  await shu.context().close();
  // 离线跨过第 8 日：小事按现钱入账，计入府中喜事
  const off = await open(save({ day: 7, ownedPartnerIds: ['diaochan'], lastSavedAt: Date.now() - 2 * 3600 * 1000 }));
  await off.waitForTimeout(500);
  const o = await read(off);
  check('离线小事按现钱结算', o.day === 9 && /1 桩/.test(o.eventLog[0]?.detail ?? '') && o.pendingChoice === null, o.eventLog[0]?.detail);
  await off.context().close();
});

await scenario('四十日试玩修复', async () => {
  // 新手期败损封顶三成原是官道档位的规则，自动战 10-15 收起后不再测
  // 军令 0：主城出征按钮写明几日后回复；威震一郡显示进度
  // 前置任务都领过，「威震一郡」才排进面板前四条
  // v2.3：军令按真实时间回，顶栏写「下一道约 N 分」；改用真实时间模式（木屋 20 分一道）
  const zero = await open(save({ orders: 0, day: 11, claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'first-win', 'estate-third'] }), { realtime: true, dayMs: 0 });
  check('军令为 0 时顶栏写明回复', /下一道约(20|19)分/.test(await zero.locator('.home-hud__chips').innerText()), await zero.locator('.home-hud__chips').innerText());
  await openGoals(zero);
  check('武力任务显示进度', /\d+\/180/.test(await zero.locator('.quest-item').filter({ hasText: '威震一郡' }).innerText()));
  // v2.3：日数随真实时间膨胀，顶栏改写「开府 M 天」+「第 N 日」
  check('顶栏日期写开府天数与第几日', /1 天\s*\n\s*第 11 日/.test(await zero.locator('.home-hud__chips').innerText()) && (await zero.locator('.home-hud__days').getAttribute('title')) === '开府 1 天（第 11 日）', await zero.locator('.home-hud__chips').innerText());
  await zero.context().close();
  // 升侯府：纪事写明新开放攻郡与反攻（v2.2 北疆收起，府邸不再新开放内容）
  const up = await open(save({ homeLevel: 4, gold: 200000, day: 18 }));
  await up.getByRole('button', { name: /升级宅邸/ }).click();
  await up.waitForTimeout(3000);
  const u = await read(up);
  check('升侯府纪事写明新开放攻郡且诸郡会遭反攻', u.homeLevel === 5 && (u.eventLog[0]?.detail ?? '').includes('新开放：攻郡开疆（诸郡会遭反攻）'), JSON.stringify({ d: u.eventLog[0]?.detail }));
  await up.context().close();
  // 钱够时机会栏提示兵器
  const rich = await open(save({ gold: 6000 }));
  check('钱够时机会栏提示更强兵器', (await rich.locator('.chance-bar').textContent()).includes('可购入'));
  await rich.context().close();
});

await scenario('朝代家声与侯府价', async () => {
  const page = await open(save({ homeLevel: 4, gold: 45000, realm: 'wu', realms: { wei: 1, shu: 1, wu: 1 }, pastDynasties: [{ dynasty: 1, realm: null, generations: 2, days: 80, wins: 40, ambitions: 1 }, { dynasty: 2, realm: 'wei', generations: 2, days: 70, wins: 30, ambitions: 0 }, { dynasty: 3, realm: 'shu', generations: 1, days: 50, wins: 20, ambitions: 0 }] }));
  check('侯府升级价 45,000', (await page.getByRole('button', { name: /升级宅邸/ }).innerText()).includes('45,000'));
  await page.getByRole('button', { name: '主公' }).click();
  const text = await page.getByRole('dialog', { name: '主公' }).innerText();
  check('朝代家声：再造山河、三朝元老、三分归一', ['再造山河', '三朝元老', '三分归一'].every((name) => text.includes(`「${name}」`)) && !/「三分归一」\s*魏、蜀、吴/.test(text), text.match(/「三分归一」[^\n]*\n?[^\n]*/)?.[0]);
  await page.context().close();
});

await scenario('整合复测修复', async () => {
  // 曹操持专属青釭剑：方天画戟只多 1 点，不该提示；屯田够钱时提示并直达西蜀
  const cao = await open(save({ selectedLordId: 'caocao', homeLevel: 3, gold: 9500, equippedWeaponId: 'qinggang', ownedWeaponIds: ['xuanjian', 'qinggang'] }));
  const bar = await cao.locator('.chance-bar').textContent();
  check('小幅提升的兵器不进机会栏', !bar.includes('可购入'), bar.replace(/\n/g, ' '));
  await chance(cao, /可升西蜀屯田/);
  await openMap(cao);
  check('屯田提示直达西蜀面板', await cao.getByRole('button', { name: /投入 9,000 金/ }).isVisible());
  await cao.context().close();
  // 侯府后机会栏显示下一目标与差额；称号「侯门显贵」
  const hou = await open(save({ homeLevel: 5, gold: 20000 }));
  const houBar = await hou.locator('.chance-bar').textContent();
  // 攻南阳郡押 75,000 军资（v3.1「侯门显贵」押金 −5% → 71,250），比王城 18 万近，侯府后下一目标先指向南阳郡
  check('侯府后显示下一目标差额', /下一目标 · 南阳郡[\s\S]*还差 51,250 金/.test(houBar), houBar.replace(/\n/g, ' '));
  check('侯府称号侯门显贵', (await hou.locator('.home-hud').innerText()).includes('侯门显贵'));
  await hou.context().close();
  // 新手首战：初级场人人可进（开局战力不够 80 的主公也能打牌）
  const fresh = await open(save({ selectedLordId: 'zhugeliang', ownedPartnerIds: [], tutorialDone: false, battleWins: 0, homeLevel: 1, gold: 1000 }));
  await fresh.getByRole('button', { name: '出征', exact: true }).click();
  const beginner = fresh.getByRole('button', { name: /初级场/ });
  check('新手首战初级场可进', (await beginner.isEnabled()) && (await beginner.innerText()).includes('人人可进'));
  await fresh.context().close();
});

await scenario('府邸前军令每日回复', async () => {
  // 木屋第 12 → 13 日（奇数日）也回 1 道；府邸同样操作不回
  const early = await open(save({ homeLevel: 2, day: 12, orders: 0 }));
  await early.getByRole('button', { name: /^处理政务/ }).click();
  await early.waitForTimeout(300);
  check('府邸前奇数日也回军令', (await read(early)).orders === 1 && (await read(early)).day === 13);
  await early.context().close();
  const late = await open(save({ homeLevel: 4, day: 12, orders: 0 }));
  await late.getByRole('button', { name: /^处理政务/ }).click();
  await late.waitForTimeout(300);
  check('府邸后奇数日不回军令', (await read(late)).orders === 0 && (await read(late)).day === 13);
  await late.context().close();
});

await scenario('后期试玩修复', async () => {
  // 传位 chip 写明收益（v3.1 改写：递增价下 25 万从第 3 点起只折 1 点，花 15 万余 10 万，收入 +15%），不再给「先封郡」建议
  const king = await open(save({ homeLevel: 6, gold: 250000, legacyPoints: 2, generation: 2, fiefs: {} }));
  const bar = await king.locator('.chance-bar').textContent();
  check('传位提示写明收益', bar.includes('可传位换 1 点家业点') && bar.includes('花 150,000 金、余 100,000 金，收入 +15%') && bar.includes('宅邸封地伴侣全留') && !bar.includes('先封郡'), bar.replace(/\n/g, ' '));
  await king.context().close();
  // 传位后择主：继承了任务与封地，但不弹「清空进度」
  const heir = await open(save({ screen: 'lordSelect', lastScreen: 'lordSelect', selectedLordId: null, generation: 2, legacyPoints: 2, farmLevel: 3, claimedQuestIds: ['farm-first'], fiefs: { nanyang: 'farming' } }));
  let dialogs = 0;
  heir.on('dialog', (d) => { dialogs += 1; d.accept(); });
  await heir.getByRole('button', { name: '继续家业' }).click();
  await heir.getByRole('button', { name: '确认选择' }).click();
  // v3.1：伴侣还在（传位只换主公），择主后直接回主城
  await heir.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  check('传位后择主不弹清空进度确认', dialogs === 0, `dialogs=${dialogs}`);
  await heir.context().close();
});

await scenario('手机横屏与大屏竖屏铺满', async () => {
  // 横屏手机：外层页面不滚动、开屏「开始游戏」与选主公「确认选择」都在一屏内
  for (const viewport of [{ width: 844, height: 390 }, { width: 932, height: 430 }]) {
    const page = await open(null, { viewport, isMobile: true, hasTouch: true });
    const fit = (name) => page.evaluate((label) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === label);
      const r = btn?.getBoundingClientRect();
      const d = document.documentElement;
      return { ok: !!r && r.top >= 0 && r.bottom <= innerHeight && d.scrollWidth <= innerWidth && d.scrollHeight <= innerHeight, top: r?.top, bottom: r?.bottom, sh: d.scrollHeight };
    }, name);
    await page.getByRole('button', { name: '开始游戏' }).waitFor();
    const title = await fit('开始游戏');
    check(`${viewport.width}x${viewport.height} 开屏开始游戏在一屏内`, title.ok, JSON.stringify(title));
    await page.getByRole('button', { name: '开始游戏' }).click();
    await page.getByText('乱世择主').first().waitFor();
    const lord = await fit('确认选择');
    check(`${viewport.width}x${viewport.height} 选主公确认按钮在一屏内`, lord.ok, JSON.stringify(lord));
    await page.context().close();
  }
  // 430 宽大屏 iPhone 竖屏：外框铺满视口，不再装进 390 小框
  const big = await open(null, { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true });
  await big.getByRole('button', { name: '开始游戏' }).waitFor();
  const shell = await big.locator('.phone-shell').boundingBox();
  check('430x932 竖屏外框铺满', Math.round(shell.width) === 430 && Math.round(shell.height) === 932, JSON.stringify(shell));
  await big.context().close();
});

await scenario('斗地主难度随场次', async () => {
  const page = await open(save({ homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }), { viewport: { width: 844, height: 390 } });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  const venues = await page.locator('.venue-list, main').first().innerText();
  check('场次列表写明对手牌艺', venues.includes('对手生手') && venues.includes('对手老手') && venues.includes('对手高手'), venues.replace(/\n/g, ' ').slice(0, 120));
  await page.getByRole('button', { name: /初级场/ }).click();
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  const badges = await page.locator('.ddz-seat--left .ddz-seat__badge, .ddz-seat--right .ddz-seat__badge').allInnerTexts();
  check('初级场对手标注生手', badges.some((b) => b.includes('生手')), badges.join('/'));
  await page.context().close();
});

await scenario('斗地主缴获随战力上涨', async () => {
  // 木屋：缴获按宅邸档次放开（木屋三成），初级场 3,000 × 0.3
  const low = await open(save({ homeLevel: 2, equippedWeaponId: 'fangtian' }), { viewport: { width: 844, height: 390 } });
  await low.getByRole('button', { name: '出征', exact: true }).click();
  await low.getByRole('button', { name: /初级场/ }).click();
  const lowSummary = await low.locator('.venue-summary').first().innerText();
  check('木屋初级场按三成放开 900', lowSummary.includes('本场胜缴获 900 金') && !lowSummary.includes('随战力上涨'), lowSummary);
  await low.context().close();
  // 王城、十位伴侣、方天画戟：自动战推荐档缴获已远超 2 万，斗地主跟着涨
  const all = ['zhenji', 'sunshangxiang', 'daqiao', 'xiaoqiao', 'huangyueying', 'diaochan', 'caiwenji', 'mifuren', 'zhurong', 'bulianshi'];
  const high = await open(save({ homeLevel: 6, farmLevel: 5, equippedWeaponId: 'fangtian', ownedPartnerIds: all }), { viewport: { width: 844, height: 390 } });
  await high.getByRole('button', { name: '出征', exact: true }).click();
  await high.getByRole('button', { name: /高级场/ }).click();
  const summary = await high.locator('.venue-summary').first().innerText();
  const gold = Number(summary.match(/本场胜缴获 ([\d,]+) 金/)?.[1].replace(/,/g, '') ?? 0);
  check('高战力高级场缴获高于 2 万底价并注明随战力上涨', gold > 20000 && summary.includes('缴获随战力上涨'), summary);
  const cards = await high.locator('.venue-card em').allInnerTexts();
  check('场次卡写出各场胜利缴获且高低场保持差距', cards.length === 3 && cards.every((t) => /胜 [\d,]+/.test(t)) && Number(cards[0].match(/胜 ([\d,]+)/)[1].replace(/,/g, '')) < gold, cards.join(' / '));
  await high.getByRole('button', { name: /^进入斗地主/ }).click();
  await high.getByText('斗地主牌局').first().waitFor();
  const quit = await high.locator('.ddz-topbar__quit').innerText();
  check('牌桌认输额按上涨后的缴获两成', quit.includes(`−${Math.round(gold * 0.2).toLocaleString()}`), quit);
  await high.context().close();
});

await scenario('叫地主与抢地主', async () => {
  const page = await open(save({ homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }), { viewport: { width: 844, height: 390 }, bidding: true });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  const handBefore = await page.locator('.player-hand .poker-card').count();
  check('开局每人 17 张、底牌未亮、先由你叫', handBefore === 17 && (await page.getByRole('button', { name: '叫地主' }).isEnabled()) && (await page.locator('.ddz-topbar__kitty').innerText()).includes('叫完地主后亮出'), `hand=${handBefore}`);
  await page.getByRole('button', { name: '叫地主' }).click();
  // 等叫抢结束（AI 可能抢，你可能还有一次回抢机会，这里一律不抢）
  for (let i = 0; i < 20; i += 1) {
    const noRob = page.getByRole('button', { name: '不抢' });
    if ((await noRob.count()) > 0 && (await noRob.isEnabled())) await noRob.click();
    if (!(await page.locator('.ddz-seat__role').first().innerText()).includes('叫牌')) break;
    await page.waitForTimeout(400);
  }
  const roles = await page.locator('.ddz-seat__role').allInnerTexts();
  const hands = await page.locator('.ddz-seat__count').allInnerTexts();
  const landlordSeat = roles.findIndex((r) => r === '地主');
  check('叫抢结束恰好一位地主且拿到 20 张', roles.filter((r) => r === '地主').length === 1 && roles.filter((r) => r === '农民').length === 2 && hands[landlordSeat]?.startsWith('20'), `${roles.join('/')} ${hands.join('/')}`);
  check('叫完后亮出底牌', (await page.locator('.ddz-topbar__kitty .mini-card').count()) === 3);
  await page.context().close();
});

await scenario('首页一屏主城', async () => {
  const page = await open(save({ homeLevel: 4, gold: 42000, day: 18, battleWins: 6, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'], eventLog: [{ id: 'a', day: 17, title: '流民归附', detail: '募为乡勇' }] }));
  await page.locator('.home-v2').waitFor();
  const fit = await page.evaluate(() => { const e = document.querySelector('.home-screen'); return { sh: e.scrollHeight, ch: e.clientHeight }; });
  check('390x844 首页一屏放下不用滚动', fit.sh <= fit.ch + 2, JSON.stringify(fit));
  const visible = await page.locator('main button:visible').allInnerTexts();
  check('首页不再重复放招募/兵器库/出征讨伐大按钮', !visible.some((t) => /招募伴侣|兵器库|出征讨伐/.test(t)), visible.join('|'));
  check('下一步只摆一件，其余收进「还有 N 件」', (await page.locator('.next-step__main').count()) === 1 && (await page.locator('.next-step__list').isHidden()) && /还有 \d+ 件可做/.test(await page.locator('.next-step__more').innerText()));
  check('可领赏排在下一步第一位', (await page.locator('.next-step__main').innerText()).includes('可领赏'));
  check('伴侣页签有红点（可再招一位）', (await page.getByRole('button', { name: '伴侣', exact: true }).locator('.home-dot').count()) === 1);
  await page.locator('.next-step__main').click();
  await page.getByRole('dialog', { name: '家业目标' }).waitFor();
  const before = (await read(page)).gold;
  await page.getByRole('button', { name: /全部领取/ }).click();
  await page.waitForTimeout(300);
  check('家业目标弹层一键全部领取', (await read(page)).gold > before && (await page.getByRole('button', { name: '领赏', exact: true }).count()) === 0);
  await closeGoals(page);
  await page.getByRole('button', { name: /^府中纪事/ }).click();
  check('纪事弹层列出近事', (await page.getByRole('dialog', { name: '府中纪事' }).innerText()).includes('流民归附'));
  await page.context().close();
});

await scenario('出征直达斗地主', async () => {
  const page = await open(save({ homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /^进入斗地主/ }).waitFor();
  check('点出征是疆域图 + 斗地主选场', (await page.locator('.expedition-map').count()) === 0 && (await page.locator('.conquest-map').isVisible()) && (await page.locator('h2').first().innerText()) === '出征' && (await page.locator('.venue-card').count()) === 3);
  await page.getByRole('button', { name: '其他战场 ›' }).click();
  check('其他战场展开小地图', (await page.locator('.expedition-map').isVisible()) && (await page.locator('.map-node').count()) === 2); // v2.2 北疆收起：只剩荆州、西蜀
  await page.getByRole('button', { name: '斗地主', exact: true }).click();
  check('地图里可一键回到出征页', (await page.locator('.expedition-map').count()) === 0 && (await page.locator('.conquest-map').isVisible()));
  await page.context().close();
});

await scenario('今日政务回报', async () => {
  const page = await open(save({ homeLevel: 4, day: 12 }));
  const before = (await read(page)).gold;
  await page.locator('.home-actions__main').click();
  await page.locator('.affair-report').waitFor();
  const text = await page.locator('.affair-report').innerText();
  const gained = (await read(page)).gold - before;
  check('点处理政务弹出今日政务：日子、事项、入账', text.includes('第 13 日') && text.includes('今日政务') && text.includes(`+${gained.toLocaleString()} 金`) && /清点仓廪|收取租赋|整顿市集|开设盐铺/.test(text), text.replace(/\n/g, ' '));
  await page.locator('.affair-report').waitFor({ state: 'detached', timeout: 5000 });
  check('政务回报 3 秒后收起', (await page.locator('.affair-report').count()) === 0);
  await page.context().close();
});

// v2.3 迁移：府中三件事改为处置府库这一整笔（钱粮全额；军务/治理积满 4 日才练、少拿 1 日收入）。
// 旧版「每点一次过一天、军务拿一半」的口径作废，改用真实时间存档（府库预先积好几日）验新规则
const rtSave = (extra = {}) => save({ clockVersion: 1, clockAt: Date.now(), orderClockAt: Date.now(), foundedAt: Date.now() - 3 * 86400e3, ...extra });
const dailyOf = async (page) => Number((await page.locator('.home-banner__detail summary').innerText()).match(/每日政务 \+([\d,]+) 金/)[1].replace(/,/g, ''));
await scenario('府中三件事', async () => {
  const page = await open(rtSave({ homeLevel: 4, day: 12, treasury: { gold: 3000, days: 5 } }), { affairs: true, realtime: true, dayMs: 0 });
  const daily = await dailyOf(page);
  const mainText = await page.locator('.home-actions__main').innerText();
  check('主按钮改为收取府库并写明积几日', mainText.includes('收取府库') && mainText.includes('+3,000金') && mainText.includes('积 5 日'), mainText.replace(/\n/g, ' '));
  const s0 = await read(page);
  await page.locator('.home-actions__main').click();
  const dialog = page.getByRole('dialog', { name: '府中三件事' });
  await dialog.waitFor();
  const text = await dialog.innerText();
  check('收取先弹出三件事：钱粮、军务、治理各一件，写明府库积几日', text.includes('府库积 5 日') && ['钱粮', '军务', '治理'].every((t) => text.includes(t)) && (await dialog.locator('.affairs-option').count()) === 3, text.replace(/\n/g, ' ').slice(0, 160));
  check('弹出时还没入账', (await read(page)).gold === s0.gold && (await read(page)).treasury.gold === 3000);
  check('卡片写明各自收益：钱粮全额、军务治理少拿 1 日并练属性', text.includes('+3,000 金 · 全额入账') && text.includes(`+${(3000 - daily).toLocaleString()} 金 · 少拿 1 日 · 武力 +1（本代 0/15）`) && text.includes(`+${(3000 - daily).toLocaleString()} 金 · 少拿 1 日 · 智谋、声望 +1（本代 0/15）`), `日收 ${daily} | ${text.replace(/\n/g, ' ')}`);
  const power0 = Number((await page.locator('.home-hud__chips').innerText()).match(/(\d+)\s*\n?\s*武力|武力\s*\n?\s*(\d+)/)?.slice(1).find(Boolean) ?? NaN);
  await dialog.locator('.affairs-option--military').click();
  await page.waitForTimeout(300);
  let s = await read(page);
  check('办军务：整笔少拿 1 日、本代武力 +1、府库清空、弹层收起', s.gold === s0.gold + 3000 - daily && s.affairTraining?.strength === 1 && s.treasury.gold === 0 && s.treasury.days === 0 && (await dialog.count()) === 0 && s.day === s0.day, `Δ=${s.gold - s0.gold} t=${JSON.stringify(s.affairTraining)} tr=${JSON.stringify(s.treasury)}`);
  const report = await page.locator('.affair-report').innerText().catch(() => '');
  check('回报写明收取府库积几日与入账', report.includes('收取府库 · 积 5 日') && report.includes(`+${(3000 - daily).toLocaleString()} 金`), report.replace(/\n/g, ' '));
  const power1 = Number((await page.locator('.home-hud__chips').innerText()).match(/(\d+)\s*\n?\s*武力|武力\s*\n?\s*(\d+)/)?.slice(1).find(Boolean) ?? NaN);
  check('顶栏武力 +1', power1 === power0 + 1, `${power0} → ${power1}`);
  const empty = await page.locator('.home-actions__main').innerText();
  check('府库空了主按钮置灰、写下一日约几分后', (await page.locator('.home-actions__main').isDisabled()) && /下一日约 [\d.]+ (分|小时)后/.test(empty), empty.replace(/\n/g, ' '));
  await page.context().close();

  // 不满 4 日：军务不练属性，按全额给
  const few = await open(rtSave({ homeLevel: 4, day: 12, treasury: { gold: 900, days: 3 } }), { affairs: true, realtime: true, dayMs: 0 });
  await few.locator('.home-actions__main').click();
  const d1 = few.getByRole('dialog', { name: '府中三件事' });
  check('积不满 4 日写明不练、此番全额', (await d1.innerText()).includes('+900 金 · 积满 4 日才练武力，此番全额'), (await d1.innerText()).replace(/\n/g, ' '));
  const f0 = (await read(few)).gold;
  await d1.locator('.affairs-option--military').click();
  await few.waitForTimeout(300);
  s = await read(few);
  check('积不满 4 日办军务：全额入账、属性不涨', s.gold === f0 + 900 && s.affairTraining.strength === 0, `Δ=${s.gold - f0} t=${JSON.stringify(s.affairTraining)}`);
  await few.context().close();

  // 练满：按全额给金，不再涨；存档里超上限的数会被压回 15
  const capped = await open(rtSave({ homeLevel: 4, day: 12, affairTraining: { strength: 99, civil: 15 }, treasury: { gold: 2000, days: 6 } }), { affairs: true, realtime: true, dayMs: 0 });
  check('读档时练出的属性压回上限 15', (await read(capped)).affairTraining?.strength === 15);
  await capped.locator('.home-actions__main').click();
  const d2 = capped.getByRole('dialog', { name: '府中三件事' });
  const text2 = await d2.innerText();
  check('练满后写明按全额给金', text2.includes('+2,000 金 · 武力已练满，按全额给金') && text2.includes('智谋声望已练满'), text2.replace(/\n/g, ' '));
  const c0 = (await read(capped)).gold;
  await d2.locator('.affairs-option--military').click();
  await capped.waitForTimeout(300);
  check('练满后办军务拿全额、属性不再涨', (await read(capped)).gold === c0 + 2000 && (await read(capped)).affairTraining.strength === 15);
  await capped.context().close();
});

// 用「提示」打完一局（不要就过），返回是否已出现结算
async function playOut(page, ms = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.locator('.doudizhu-result-banner').isVisible().catch(() => false)) return true;
    const hint = page.getByRole('button', { name: '提示', exact: true });
    const pass = page.getByRole('button', { name: '不要', exact: true });
    if (await hint.isEnabled().catch(() => false)) {
      await hint.click();
      await page.getByRole('button', { name: '出牌', exact: true }).click().catch(() => {});
    } else if (await pass.isEnabled().catch(() => false)) {
      await pass.click().catch(() => {});
    }
    await page.waitForTimeout(250);
  }
  return false;
}

await scenario('疆域图攻郡', async () => {
  // 侯府、20 万金、3 道军令：南阳、长沙与本府相邻可攻，其余未接壤
  const page = await open(save({ homeLevel: 5, gold: 200000, orders: 3, day: 40, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await page.getByRole('button', { name: '出征', exact: true }).click();
  const map = page.locator('.conquest-map');
  await map.waitFor();
  const label = async (name) => (await map.locator('g.conquest-node').filter({ hasText: name }).getAttribute('aria-label')) ?? '';
  check('出征页有疆域图：南阳、长沙可出兵，辽东、巴郡未接壤', (await label('南阳')).includes('可出兵') && (await label('长沙')).includes('可出兵') && (await label('辽东')).includes('未接壤') && (await label('巴')).includes('未接壤'));
  const panel = await map.locator('.conquest-panel').innerText();
  // v3.1：侯府起「侯门显贵」攻郡押金 −5%（75,000 → 71,250）
  check('默认选中最便宜的可攻郡南阳：写明守将、特权、军资', panel.includes('南阳郡 · 守将 张绣') && panel.includes('帝乡沃土') && panel.includes('71,250 金军资'), panel.replace(/\n/g, ' '));
  await map.locator('g.conquest-node').filter({ hasText: '辽东' }).click({ force: true });
  check('点未接壤的郡写明先拿下相邻郡', (await map.locator('.conquest-panel').innerText()).includes('先拿下颍川郡'));
  await map.locator('g.conquest-node').filter({ hasText: '南阳' }).click({ force: true });
  await map.getByRole('radio', { name: /整军/ }).click();
  const s0 = await read(page);
  await map.getByRole('button', { name: /出兵攻取南阳郡/ }).click();
  await page.getByText('攻取南阳郡').first().waitFor();
  const s1 = await read(page);
  check('出兵：押 71,250 军资（侯门显贵 −5%）、耗 1 军令、记下攻郡牌局', s0.gold - s1.gold === 71250 && s1.orders === s0.orders - 1 && s1.activeBattle?.conquest?.fiefId === 'nanyang' && s1.activeBattle.conquest.policyId === 'military', JSON.stringify(s1.activeBattle));
  check('牌桌上下家是守将张绣，按钮是「撤兵」', (await page.locator('.ddz-seat--left .ddz-seat__name').innerText()).includes('张绣') && (await page.getByRole('button', { name: '撤兵' }).isVisible()));
  const ended = await playOut(page);
  await page.waitForTimeout(400);
  const s2 = await read(page);
  const won = (await page.locator('.doudizhu-result-banner').innerText().catch(() => '')).includes('南阳郡归附');
  check('攻郡打完：胜则南阳归府下行整军，负则军资不退、郡不变', ended && (won ? s2.fiefs?.nanyang === 'military' && s2.battleWins === s0.battleWins + 1 : !s2.fiefs?.nanyang && s2.battleLosses === s0.battleLosses + 1) && s2.gold === s1.gold && !s2.activeBattle, `won=${won} fiefs=${JSON.stringify(s2.fiefs)}`);
  check('攻郡结算写进纪事', (s2.eventLog?.[0]?.title ?? '').includes(won ? '攻取南阳郡' : '攻南阳郡未克'), s2.eventLog?.[0]?.title);
  await page.context().close();

  // 中途刷新：按攻城失利，军资不退
  const quitter = await open(save({ homeLevel: 5, gold: 200000, orders: 3, day: 40 }));
  await quitter.getByRole('button', { name: '出征', exact: true }).click();
  await quitter.locator('.conquest-map').getByRole('button', { name: /出兵攻取南阳郡/ }).click();
  await quitter.getByText('攻取南阳郡').first().waitFor();
  await quitter.reload({ waitUntil: 'domcontentloaded' });
  await quitter.locator('.home-v2').waitFor();
  const q = await read(quitter);
  check('攻郡中途刷新：记一负、军资不退、郡不变', q.gold === 128750 && q.battleLosses === 1 && !q.fiefs?.nanyang && !q.activeBattle && (q.eventLog?.[0]?.title ?? '') === '攻郡未果', JSON.stringify({ g: q.gold, l: q.battleLosses, t: q.eventLog?.[0]?.title }));
  await quitter.context().close();

  // 侯府前：能看图，出兵按钮写明侯府开放
  const early = await open(save({ homeLevel: 4, gold: 200000 }));
  await early.getByRole('button', { name: '出征', exact: true }).click();
  check('侯府前出兵按钮锁住并写明原因', await early.locator('.conquest-go').isDisabled() && (await early.locator('.conquest-go').innerText()).includes('侯府后可出兵'));
  await early.context().close();

  // 飞地作废：只有辽东（与本府不连）读档后清掉；南阳—颍川—辽东一线保留
  const enclave = await open(save({ homeLevel: 5, fiefs: { liaodong: 'farming' } }));
  check('不连通的飞地读档作废', Object.keys((await read(enclave)).fiefs ?? {}).length === 0);
  await enclave.context().close();
});

await scenario('郡的牌桌特权', async () => {
  // 南阳：缴获 +20%；颍川：开局探下家三张；辽东：叫地主前看一张底牌
  const fiefs = { nanyang: 'farming', yingchuan: 'farming', liaodong: 'farming' };
  const page = await open(save({ homeLevel: 5, gold: 50000, orders: 3, fiefs, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }), { bidding: true });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /初级场/ }).click();
  const summary = await page.locator('.venue-summary').first().innerText();
  check('南阳：选场写明缴获 +20%', summary.includes('（南阳 +20%）'), summary);
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  check('辽东：叫地主前底牌亮出一张', (await page.locator('.ddz-topbar__kitty .mini-card').count()) === 1);
  check('颍川：开局写明探得下家三张牌', /谋士探得 .+ 手里有/.test(await page.locator('.ddz-scout').innerText().catch(() => '')));
  await page.context().close();
});

await scenario('斗地主再来一局', async () => {
  const page = await open(save({ homeLevel: 4, gold: 20000, orders: 3, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /初级场/ }).click();
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  await playOut(page);
  const again = page.getByRole('button', { name: /再来一局/ });
  check('结算后有「再来一局」并写明剩余军令', (await again.isVisible()) && (await again.innerText()).includes('剩 2'), await again.innerText().catch(() => ''));
  await again.click();
  await page.waitForTimeout(500);
  const s = await read(page);
  check('再来一局：重新发牌、再耗 1 军令', (await page.locator('.doudizhu-result-banner').count()) === 0 && (await page.locator('.player-hand .poker-card').count()) >= 17 && s.orders === 1 && s.activeBattle?.doudizhu === true, `orders=${s.orders}`);
  await page.context().close();
});

await scenario('出牌倒计时', async () => {
  // 打满 5 局才算老手：新手局超时不进托管，单独测
  const page = await open(save({ battleWins: 5, homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }), { viewport: { width: 844, height: 390 }, turnSeconds: 2 });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  check('轮到你时显示倒计时', (await page.locator('.ddz-clock').count()) === 1 && ['1', '2'].includes((await page.locator('.ddz-clock').innerText()).trim()));
  // 地主先出，2 秒不动就自动出最小的一张
  await page.waitForFunction(() => document.querySelectorAll('.player-hand .poker-card').length === 19, null, { timeout: 8000 }).catch(() => {});
  check('超时自动出最小一张', (await page.locator('.player-hand .poker-card').count()) === 19, `${await page.locator('.player-hand .poker-card').count()} 张`);
  check('超时代出牌有桌心提示', (await page.locator('.ddz-flash').innerText().catch(() => '')).includes('超时 · 自动出牌'), await page.locator('.ddz-flash').innerText().catch(() => '无'));
  await page.getByText('再超时将托管').first().waitFor({ timeout: 8000 }).catch(() => {});
  check('第一次超时后提示再超时将托管', (await page.getByText('再超时将托管').count()) > 0 || (await page.locator('.doudizhu-result-banner').count()) > 0);
  // 再超时一次（或牌局已结束）→ 自动托管，并说明原因
  await page.getByText('连续超时，已托管').first().waitFor({ timeout: 15000 }).catch(() => {});
  check('连续两次超时进入托管', (await page.getByText('连续超时，已托管').count()) > 0 || (await page.locator('.doudizhu-result-banner').count()) > 0);
  await page.context().close();
});

await scenario('手动托管与取消', async () => {
  const page = await open(save({ homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }), { viewport: { width: 390, height: 844 } });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  const row = await page.locator('.ddz-actions__row').evaluate((el) => ({ right: el.getBoundingClientRect().right, scroll: el.scrollWidth - el.clientWidth }));
  check('竖屏按钮行一行放得下', row.right <= 390 && row.scroll <= 0, JSON.stringify(row));
  await page.getByRole('button', { name: '托管', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.player-hand .poker-card').length < 20, null, { timeout: 8000 }).catch(() => {});
  check('托管后系统代你出牌', (await page.getByText('托管中').count()) > 0 && (await page.locator('.player-hand .poker-card').count()) < 20);
  if ((await page.getByRole('button', { name: '取消托管' }).count()) > 0) await page.getByRole('button', { name: '取消托管' }).click();
  check('取消托管后恢复出牌按钮', (await page.locator('.doudizhu-result-banner').count()) > 0 || (await page.getByRole('button', { name: '出牌', exact: true }).count()) === 1);
  await page.context().close();
});

await scenario('新手局倒计时与托管', async () => {
  const base = { homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] };
  // 不覆盖倒计时：老手叫牌 15 秒，新手（不足 5 局）加倍到 30 秒
  const vet = await open(save({ ...base, battleWins: 5 }), { viewport: { width: 844, height: 390 }, bidding: true, turnSeconds: '' });
  await vet.getByRole('button', { name: '出征', exact: true }).click();
  await vet.getByRole('button', { name: /中级场/ }).click();
  await vet.getByRole('button', { name: /^进入斗地主/ }).click();
  await vet.getByText('斗地主牌局').first().waitFor();
  const vetClock = Number((await vet.locator('.ddz-clock').innerText()).trim());
  check('老手叫牌倒计时 15 秒', vetClock >= 14 && vetClock <= 15, `${vetClock}`);
  await vet.context().close();
  const fresh = await open(save(base), { viewport: { width: 844, height: 390 }, bidding: true, turnSeconds: '' });
  await fresh.getByRole('button', { name: '出征', exact: true }).click();
  await fresh.getByRole('button', { name: /中级场/ }).click();
  await fresh.getByRole('button', { name: /^进入斗地主/ }).click();
  await fresh.getByText('斗地主牌局').first().waitFor();
  const freshClock = Number((await fresh.locator('.ddz-clock').innerText()).trim());
  check('新手叫牌倒计时加倍到 30 秒', freshClock >= 29 && freshClock <= 30, `${freshClock}`);
  // 叫牌阶段开托管：系统一律不叫，永远不替玩家当地主
  await fresh.getByRole('button', { name: '托管', exact: true }).click();
  await fresh.waitForFunction(() => ![...document.querySelectorAll('.ddz-seat__role')].some((el) => el.textContent?.includes('叫牌')), null, { timeout: 30000 }).catch(() => {});
  const selfRole = await fresh.locator('.ddz-seat--self .ddz-seat__role').innerText();
  check('托管叫牌不替玩家当地主', selfRole === '农民', selfRole);
  await fresh.context().close();
  // 新手局连续超时：只代这一手，不进托管
  const page = await open(save(base), { viewport: { width: 844, height: 390 }, turnSeconds: 1 });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.player-hand .poker-card').length === 19, null, { timeout: 8000 }).catch(() => {});
  // 等到第二次轮到你并再次超时
  await page.waitForTimeout(6000);
  const flashes = await page.locator('.ddz-flash').allInnerTexts();
  check('新手局超时不进托管', (await page.getByText('托管中').count()) === 0 && (await page.getByText('已托管').count()) === 0 && (await page.getByText('再超时将托管').count()) === 0 && (await page.locator('.player-hand .poker-card').count()) <= 19, `${await page.locator('.player-hand .poker-card').count()} 张 flash=${flashes.join('/')}`);
  await page.context().close();
});

await scenario('斗地主刷新按当前倍数结算', async () => {
  const base = { gold: 50000, battleWins: 5, homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] };
  // 固定洗牌：Math.random 恒取 0.9999 时洗牌不动，你拿 3/4/5/6 四个炸弹；开桌后恢复随机
  let fixedGold = NaN;
  const enterFixed = async (page) => {
    await page.getByRole('button', { name: '出征', exact: true }).click();
    await page.getByRole('button', { name: /中级场/ }).click();
    fixedGold = await venueGold(page);
    await page.evaluate(() => { window.__realRandom = Math.random; Math.random = () => 0.9999; });
    await page.getByRole('button', { name: /^进入斗地主/ }).click();
    await page.getByText('斗地主牌局').first().waitFor();
    await page.evaluate(() => { Math.random = window.__realRandom; });
  };
  const quitAmount = async (page) => Number((await page.locator('.ddz-topbar__quit').innerText()).replace(/[^\d]/g, ''));
  // 地主打出炸弹（×2）后刷新：扣款 = 认输金额
  const lord = await open(save(base), { viewport: { width: 844, height: 390 } });
  await enterFixed(lord);
  for (const card of await lord.locator('.player-hand .poker-card[data-rank="3"]').all()) await card.press('Enter');
  await lord.getByRole('button', { name: '出牌', exact: true }).click();
  await lord.waitForFunction((k) => JSON.parse(localStorage.getItem(k) || 'null')?.activeBattle?.multiplier === 2, KEY, { timeout: 5000 }).catch(() => {});
  // 等轮回到你（AI 都不炸），倍数不再变
  await lord.getByRole('button', { name: '提示', exact: true }).and(lord.locator(':enabled')).waitFor({ timeout: 8000 }).catch(() => {});
  const lordQuit = await quitAmount(lord);
  const g0 = (await read(lord)).gold;
  await lord.reload({ waitUntil: 'domcontentloaded' });
  await lord.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 }).catch(() => {});
  const g1 = (await read(lord)).gold;
  check('地主炸弹后刷新扣款 = 认输金额', lordQuit === Math.round(fixedGold * 0.2) * 2 && g0 - g1 === lordQuit, `缴获 ${fixedGold} 认输 ${lordQuit} Δ=${g0 - g1}`);
  await lord.context().close();
  // 农民（AI 叫抢后当地主）刷新：按半份扣
  const farmer = await open(save(base), { viewport: { width: 844, height: 390 }, bidding: true });
  await enterFixed(farmer);
  await farmer.getByRole('button', { name: '不叫' }).click();
  await farmer.waitForFunction(() => document.querySelector('.ddz-seat--self .ddz-seat__role')?.textContent === '农民', null, { timeout: 10000 }).catch(() => {});
  await farmer.waitForFunction((k) => JSON.parse(localStorage.getItem(k) || 'null')?.activeBattle?.share === 0.5, KEY, { timeout: 5000 }).catch(() => {});
  await farmer.getByRole('button', { name: '提示', exact: true }).and(farmer.locator(':enabled')).waitFor({ timeout: 15000 }).catch(() => {});
  const farmerQuit = await quitAmount(farmer);
  const ab = (await read(farmer)).activeBattle;
  const f0 = (await read(farmer)).gold;
  await farmer.reload({ waitUntil: 'domcontentloaded' });
  await farmer.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 }).catch(() => {});
  const f1 = (await read(farmer)).gold;
  check('农民刷新按半份扣（= 认输金额）', ab?.share === 0.5 && farmerQuit === Math.round(Math.round(fixedGold * 0.2) * ab.multiplier * 0.5) && f0 - f1 === farmerQuit, `×${ab?.multiplier} share=${ab?.share} 认输 ${farmerQuit} Δ=${f0 - f1}`);
  await farmer.context().close();
  // 老存档没记倍数：按 ×1 全额
  const old = await open(save({ ...base, activeBattle: { mode: 'land', lossGold: 1600, doudizhu: true } }));
  await old.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 }).catch(() => {});
  await old.waitForTimeout(300);
  const o = await read(old);
  check('老存档斗地主刷新按基础额扣', o.activeBattle === null && o.gold === 50000 - 1600, `gold=${o.gold}`);
  await old.context().close();
});

await scenario('练兵之策翻倍横幅', async () => {
  // 固定洗牌（Math.random 恒 0.7，离线模拟笨地主对老手各性格组合 9/9 全胜），用提示打完；横幅金额必须等于实际入账（含练兵之策翻倍）
  const page = await open(save({ gold: 50000, battleWins: 5, nextBattleBonus: 2, homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }), { viewport: { width: 844, height: 390 } });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  const before = await read(page);
  await page.evaluate(() => { window.__realRandom = Math.random; Math.random = () => 0.7; });
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  await page.evaluate(() => { Math.random = window.__realRandom; });
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    if (await page.getByRole('button', { name: '返回家业' }).isVisible().catch(() => false)) break;
    const hint = page.getByRole('button', { name: '提示', exact: true });
    const pass = page.getByRole('button', { name: '不要', exact: true });
    if (await hint.isEnabled().catch(() => false)) {
      await hint.click();
      await page.getByRole('button', { name: '出牌', exact: true }).click();
    } else if (await pass.isEnabled().catch(() => false)) {
      await pass.click();
    }
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(400);
  const banner = await page.locator('.doudizhu-result-banner').innerText().catch(() => '');
  const shown = Number(banner.match(/胜 \+([\d,]+)/)?.[1]?.replace(/,/g, '') ?? NaN);
  const after = await read(page);
  const delta = after.gold - before.gold;
  check('练兵之策翻倍：横幅金额 = 实际入账', banner.includes('牌局得胜') && shown === delta && after.nextBattleBonus === null, `${banner.replace(/\n/g, ' ')} Δ=${delta}`);
  await page.context().close();
});

await scenario('斗地主倍数与记牌器', async () => {
  const page = await open(save({ homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }), { viewport: { width: 844, height: 390 } });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  check('开局倍数 ×1', (await page.locator('.ddz-multiplier').innerText()).includes('×1'));
  const cells = await page.locator('.ddz-counter__cell').allInnerTexts();
  // 记牌器总数 = 54 − 自己 20 张 = 34
  const total = cells.reduce((sum, t) => sum + Number(t.split('\n')[1] ?? 0), 0);
  check('记牌器显示另外两家共 34 张', cells.length === 15 && total === 34, `${cells.length} 格 共 ${total}`);
  // 滑动选牌：按住从第 1 张划到第 4 张，四张全选中
  const boxes = await page.locator('.player-hand .poker-card').evaluateAll((els) => els.slice(0, 4).map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + 8, y: r.top + 24 }; }));
  await page.mouse.move(boxes[0].x, boxes[0].y);
  await page.mouse.down();
  for (const b of boxes.slice(1)) await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const pressed = await page.locator('.player-hand .poker-card[aria-pressed="true"]').count();
  check('滑动连选四张', pressed === 4, `选中 ${pressed} 张`);
  await page.context().close();
});

await scenario('斗地主', async () => {
  // 认输回府记一负
  const page = await open(save({ homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }), { viewport: { width: 844, height: 390 } });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  const midGold = await venueGold(page);
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  // 对手座位显示性格标签，且两局对手不同
  const names1 = await page.locator('.ddz-seat--left .ddz-seat__name, .ddz-seat--right .ddz-seat__name').allInnerTexts();
  const g0 = (await read(page)).gold;
  let accept = false;
  page.on('dialog', (d) => (accept ? d.accept() : d.dismiss()));
  await page.getByRole('button', { name: /^认输/ }).click();
  await page.waitForTimeout(300);
  check('认输先弹确认，取消则留在牌局', (await page.getByText('斗地主牌局').first().isVisible()) && (await read(page)).gold === g0);
  accept = true;
  await page.getByRole('button', { name: /^认输/ }).click();
  await page.locator('.home-v2').waitFor();
  check('认输记一负并折损 20% 缴获', (await read(page)).battleLosses === 1 && g0 - (await read(page)).gold === Math.round(midGold * 0.2), `缴获 ${midGold} Δ=${g0 - (await read(page)).gold}`);

  // 用提示打完整局：不能卡死，胜负与金币一致
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  const before = await read(page);
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  const badges = await page.locator('.ddz-seat--left .ddz-seat__badge, .ddz-seat--right .ddz-seat__badge').allInnerTexts();
  check('对手座位标注性格', badges.some((b) => /激进|稳健|均衡/.test(b)), badges.join('/'));
  check('中级场对手标注老手', badges.some((b) => b.includes('老手')), badges.join('/'));
  const names2 = await page.locator('.ddz-seat--left .ddz-seat__name, .ddz-seat--right .ddz-seat__name').allInnerTexts();
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
  // 炸弹/王炸/春天会翻倍，按牌桌显示的最终倍数核对
  const mult = Number((await page.locator('.ddz-multiplier').innerText()).match(/×(\d+)/)?.[1] ?? 1);
  await page.waitForTimeout(400);
  const after = await read(page);
  const delta = after.gold - before.gold;
  check('斗地主整局可打完且结算一致', ended && (win ? delta === midGold * mult && after.battleWins === before.battleWins + 1 : delta === -Math.min(before.gold, Math.round(midGold * 0.2) * mult) && after.battleLosses === before.battleLosses + 1),
    `${win ? '胜' : '负'} ×${mult} Δgold=${delta}`);
  await page.context().close();
});

await scenario('主城入口与加成文案', async () => {
  // 告急条「去守城」直达疆域图并选中被围的郡，面板主按钮是迎战守城（v2.2 由北疆「去迎战」迁来；守城不赢金，练兵之策预览一项作废）
  const now = Date.now();
  const fr = await open(save({ homeLevel: 5, day: 11, gold: 20000, fiefs: { nanyang: 'farming', changsha: 'farming' }, fiefTakenAt: { nanyang: now - 100 * 3600e3, changsha: now - 100 * 3600e3 }, nextSiegeAt: now + 3600e3, siege: { fiefId: 'changsha', attacker: '韩玄', skill: 'novice', startedAt: now, dueAt: now + 3600e3 }, nextBattleBonus: 2 }));
  await fr.getByRole('button', { name: '去守城 →' }).click();
  await fr.locator('.conquest-map').waitFor();
  check('去守城选中被围的长沙', (await fr.locator('.conquest-map g.conquest-node.is-selected').getAttribute('aria-label') ?? '').includes('长沙郡 已归府下') && (await fr.locator('.conquest-panel').innerText()).includes('长沙郡 · 告急'));
  check('去守城主按钮为迎战守城', await fr.getByRole('button', { name: /迎战守城 · 韩玄/ }).isEnabled());
  await fr.context().close();

  // 今日军功与江东/许都加成文案随自动战 10-15 收起，不再测

  // 练兵之策待用时，门客献策卡提示不叠加
  const adv = await open(save({ day: 14, gold: 5000, homeLevel: 4, nextBattleBonus: 2 }));
  await adv.getByRole('button', { name: /^处理政务/ }).click();
  await adv.waitForTimeout(400);
  check('已有翻倍时提示再选不叠加', (await adv.locator('.choice-card__options button').nth(1).innerText()).includes('再选不叠加'));
  await adv.context().close();
  const adv2 = await open(save({ day: 14, gold: 5000, homeLevel: 4 }));
  await adv2.getByRole('button', { name: /^处理政务/ }).click();
  await adv2.waitForTimeout(400);
  check('无翻倍时不提示不叠加', !(await adv2.locator('.choice-card__options button').nth(1).innerText()).includes('不叠加'));
  await adv2.context().close();

  // 引导第 3 步差钱：有军令就去打一局斗地主，没军令才过一天；钱够去兵器库
  const allQuests = ['upgrade-wood', 'first-partner', 'first-weapon', 'first-win', 'estate-third', 'power-200', 'naval-first-win', 'court-first-win', 'farm-first', 'frontier-first-win', 'succession', 'partner-event', 'fief-first', 'three-partners'];
  const step3 = (extra) => save({ tutorialDone: false, homeLevel: 2, gold: 760, day: 6, ownedPartnerIds: ['diaochan', 'zhurong'], claimedQuestIds: allQuests, ...extra });
  const g3 = await open(step3({ orders: 2 }));
  const panel = g3.locator('[aria-label="开局引导"]');
  await panel.waitFor();
  check('第 3 步差钱时主按钮去打斗地主', (await panel.innerText()).includes('第 3 步') && (await g3.locator('.starter-do').innerText()) === '去打一局斗地主 →', await g3.locator('.starter-do').innerText());
  check('第 3 步说明打一局能凑多少', /一场就够|场凑齐/.test(await panel.innerText()));
  await g3.locator('.starter-do').click();
  check('引导出征落在斗地主选场', await g3.getByRole('button', { name: /^进入斗地主 · 耗 1 军令/ }).isVisible());
  await g3.context().close();
  const g3b = await open(step3({ orders: 0 }));
  await g3b.locator('.starter-do').waitFor();
  check('没军令时仍是过一天', (await g3b.locator('.starter-do').innerText()).startsWith('过一天'), await g3b.locator('.starter-do').innerText());
  await g3b.context().close();
  const g3c = await open(step3({ orders: 2, gold: 1600 }));
  await g3c.locator('.starter-do').waitFor();
  check('钱够时去兵器库', (await g3c.locator('.starter-do').innerText()) === '去兵器库 →');
  await g3c.context().close();
});

// ===== v2.1 伴侣上牌桌：每位伴侣一项 + 通用四项（jiaye-ddz-seed 复现牌局，期望值用同一份 doudizhu.ts 在 node 里算） =====
const ddzLib = await (async () => {
  const { readFileSync, writeFileSync, mkdtempSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const ts = createRequire(join(root, 'package.json'))('typescript');
  const file = join(mkdtempSync(join(tmpdir(), 'jiaye-scn-')), 'doudizhu.mjs');
  writeFileSync(file, ts.transpileModule(readFileSync(join(root, 'src/lib/doudizhu.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText);
  return import(pathToFileURL(file).href);
})();
/** 按种子发 n 副牌（与牌桌同一条随机流）；返回最后一副与随机源 */
function seededDeals(seed, n = 1) {
  const rand = ddzLib.seededRandom(seed);
  const deals = [];
  for (let i = 0; i < n; i += 1) deals.push(ddzLib.createDoudizhuDeal(rand));
  return { deals, rand };
}
/** 叫地主阶段的 17 张（去掉底牌） */
const bidHandOf = (deal) => deal.hands[0].filter((card) => !deal.landlordCards.some((k) => k.id === card.id));
/** 找第一个满足条件的种子 */
function findSeed(pred, from = 1) {
  for (let seed = from; seed < from + 5000; seed += 1) if (pred(seededDeals(seed).deals[0], seed)) return seed;
  throw new Error('no_seed');
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const skillBar = (page) => page.getByRole('group', { name: '伴侣技能' });
const flashText = (page) => page.locator('.ddz-flash').evaluate((el) => el.textContent ?? '').catch(() => '');
async function enterDdz(page, venue = /中级场/) {
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: venue }).click();
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
}
/** 键盘选牌：叠放的牌被下一张盖住，鼠标点中心会点到别的牌 */
async function pickCards(page, cards) {
  for (const card of cards) await page.locator(`.player-hand .poker-card[data-card-id="${card.id}"]`).press('Enter');
}
const strong = { homeLevel: 4, equippedWeaponId: 'fangtian' };

await scenario('伴侣·貂蝉闭月', async () => {
  const seed = 7;
  const deal = seededDeals(seed).deals[0];
  // 吕布 + 貂蝉 = 良缘，二重：探上家（座位 2）最大 3 张
  const page = await open(save({ ...strong, ownedPartnerIds: ['diaochan'] }), { viewport: { width: 844, height: 390 }, ls: { 'jiaye-ddz-seed': String(seed) } });
  await enterDdz(page);
  const flash = await flashText(page);
  const bar = skillBar(page);
  const text = await bar.innerText();
  const shown = await bar.locator('[data-line="moon"] .mini-card').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  const expected = ddzLib.sortCardsDescending(deal.hands[2]).slice(0, 3).map((card) => card.label);
  check('貂蝉闭月：开局播报「貂蝉·闭月」，技能条写二重', flash.includes('貂蝉·闭月') && text.includes('貂蝉·闭月') && text.includes('二重') && text.includes('生效中'), `${flash} | ${text.replace(/\n/g, ' ')}`);
  check('貂蝉闭月：探得的正是上家手里最大 3 张', sameSet(shown, expected), `${shown.join(' ')} vs ${expected.join(' ')}`);
  await page.context().close();
});

await scenario('伴侣·黄月英木牛流马', async () => {
  const seed = 9;
  const { deals, rand } = seededDeals(seed);
  const deal = deals[0];
  // 一重：盲换。黄月英良缘是诸葛亮，吕布帐下只有一重
  const page = await open(save({ ...strong, ownedPartnerIds: ['huangyueying'] }), { viewport: { width: 844, height: 390 }, bidding: true, ls: { 'jiaye-ddz-seed': String(seed) } });
  await enterDdz(page);
  const bar = skillBar(page);
  await bar.getByRole('button', { name: '木牛流马·换牌' }).click();
  check('木牛流马：点技能后提示点手牌盲换', (await bar.innerText()).includes('盲换'));
  const give = ddzLib.sortCards(bidHandOf(deal))[0];
  await pickCards(page, [give]);
  await page.waitForTimeout(200);
  // 牌桌在发牌后从同一条随机流里挑一张没亮的底牌
  const got = deal.landlordCards[[0, 1, 2][Math.floor(rand() * 3)]];
  const hand = await page.locator('.player-hand .poker-card').evaluateAll((els) => els.map((el) => el.dataset.cardId));
  const kitty = await page.locator('.ddz-topbar__kitty .mini-card').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  check('木牛流马盲换：最小的牌换走、换来随机底牌，换出的那张亮在底牌', hand.length === 17 && hand.includes(got.id) && !hand.includes(give.id) && kitty.length === 1 && kitty[0] === give.label, `got=${got.label} kitty=${kitty.join(' ')}`);
  check('木牛流马：播报换得并用完次数', (await flashText(page)).includes(`换得 ${got.label}`) && (await bar.innerText()).includes('×0'), await flashText(page));
  await page.context().close();

  // 二重（诸葛亮良缘）：先翻开一张底牌再换
  const lv2 = await open(save({ ...strong, selectedLordId: 'zhugeliang', ownedPartnerIds: ['huangyueying'] }), { viewport: { width: 844, height: 390 }, bidding: true, ls: { 'jiaye-ddz-seed': String(seed) } });
  // 诸葛亮武力低，进初级场
  await enterDdz(lv2, /初级场/);
  await skillBar(lv2).getByRole('button', { name: '木牛流马·翻底牌' }).click();
  const flipped = deal.landlordCards[0];
  const kitty1 = await lv2.locator('.ddz-topbar__kitty .mini-card').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  check('木牛流马二重：先翻开一张底牌', kitty1.length === 1 && kitty1[0] === flipped.label && (await skillBar(lv2).innerText()).includes(`换翻开的 ${flipped.label}`), kitty1.join(' '));
  await pickCards(lv2, [give]);
  await lv2.waitForTimeout(200);
  const hand2 = await lv2.locator('.player-hand .poker-card').evaluateAll((els) => els.map((el) => el.dataset.cardId));
  check('木牛流马二重：拿手牌换走翻开的那张', hand2.includes(flipped.id) && !hand2.includes(give.id));
  await lv2.context().close();
});

await scenario('伴侣·甄姬洛神', async () => {
  const seed = 13;
  const { deals } = seededDeals(seed, 2);
  const page = await open(save({ ...strong, ownedPartnerIds: ['zhenji'] }), { viewport: { width: 844, height: 390 }, bidding: true, ls: { 'jiaye-ddz-seed': String(seed) } });
  await enterDdz(page);
  const ids = () => page.locator('.player-hand .poker-card').evaluateAll((els) => els.map((el) => el.dataset.cardId));
  const before = await ids();
  check('洛神：开局手牌就是种子第一副', sameSet(before, bidHandOf(deals[0]).map((c) => c.id)));
  await skillBar(page).getByRole('button', { name: '洛神·重发' }).click();
  await page.waitForTimeout(200);
  const after = await ids();
  check('洛神：整桌重发成种子第二副、倍数 ×1、播报甄姬·洛神', sameSet(after, bidHandOf(deals[1]).map((c) => c.id)) && (await page.locator('.ddz-multiplier').innerText()).includes('×1') && (await flashText(page)).includes('甄姬·洛神'));
  check('洛神一重：用完后按钮收起、底牌仍不亮', (await skillBar(page).getByRole('button', { name: '洛神·重发' }).count()) === 0 && (await page.locator('.ddz-topbar__kitty .mini-card').count()) === 0);
  await page.context().close();
  // 二重（曹操良缘）：重发后多看 1 张底牌
  const lv2 = await open(save({ ...strong, selectedLordId: 'caocao', ownedPartnerIds: ['zhenji'] }), { viewport: { width: 844, height: 390 }, bidding: true, ls: { 'jiaye-ddz-seed': String(seed) } });
  await enterDdz(lv2);
  await skillBar(lv2).getByRole('button', { name: '洛神·重发' }).click();
  await lv2.waitForTimeout(200);
  const kitty = await lv2.locator('.ddz-topbar__kitty .mini-card').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  check('洛神二重：重发后多看 1 张底牌', kitty.length === 1 && kitty[0] === deals[1].landlordCards[0].label, kitty.join(' '));
  await lv2.context().close();
});

await scenario('伴侣·小乔赤壁', async () => {
  // 跳过叫地主：你当地主，叫完即可选加倍
  const page = await open(save({ ...strong, gold: 900000, ownedPartnerIds: ['xiaoqiao'] }), { viewport: { width: 844, height: 390 }, ls: { 'jiaye-ddz-seed': '17' } });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  const gold = await venueGold(page);
  const loss = Math.round(gold * 0.2);
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  const bar = skillBar(page);
  check('赤壁：当地主时可加倍，写明对赌失手付缴获 ×4', (await bar.innerText()).includes('可加倍') && (await bar.innerText()).includes('失手付缴获 ×4'), (await bar.innerText()).replace(/\n/g, ' '));
  await bar.getByRole('button', { name: '加倍', exact: true }).click();
  const mult = Number((await page.locator('.ddz-multiplier').innerText()).match(/×([\d.]+)/)?.[1]);
  const quit = await page.locator('.ddz-topbar__quit').innerText();
  check('赤壁加倍：倍数 ×2，认输额按对赌（两成 × 2 × 10）', mult === 2 && quit.includes(`−${(loss * 2 * 10).toLocaleString()}`) && (await bar.innerText()).includes('已加倍'), `${mult} ${quit}`);
  const before = await read(page);
  const ended = await playOut(page);
  await page.waitForTimeout(400);
  const after = await read(page);
  const finalMult = Number((await page.locator('.ddz-multiplier').innerText()).match(/×([\d.]+)/)?.[1]);
  const banner = await page.locator('.doudizhu-result-banner').innerText().catch(() => '');
  const won = banner.includes('胜 +');
  const delta = after.gold - before.gold;
  check('赤壁加倍：结算金额与倍数一致', ended && /赤壁(加倍|对赌)/.test(banner) && (won ? delta === gold * finalMult : delta === -Math.round(loss * finalMult * 10)), `${won ? '胜' : '失手'} ×${finalMult} Δ=${delta} ${banner.replace(/\n/g, ' ')}`);
  await page.context().close();
  // 叫地主流程：叫完之前不弹加倍
  const bid = await open(save({ ...strong, ownedPartnerIds: ['xiaoqiao'] }), { viewport: { width: 844, height: 390 }, bidding: true, ls: { 'jiaye-ddz-seed': '17' } });
  await enterDdz(bid);
  check('赤壁：叫地主阶段写明叫完可加倍、没有加倍按钮', (await skillBar(bid).innerText()).includes('叫完地主可加倍') && (await skillBar(bid).getByRole('button', { name: '加倍', exact: true }).count()) === 0);
  await bid.context().close();
});

await scenario('伴侣·小乔赤壁（封顶与农民）', async () => {
  // 叫抢把倍数抢到 ×8：加倍多赢不到，不再弹（种子 442：你叫、两家都抢、你回抢）
  const capped = await open(save({ ...strong, gold: 900000, ownedPartnerIds: ['xiaoqiao'] }), { viewport: { width: 844, height: 390 }, bidding: true, ls: { 'jiaye-ddz-seed': '442' } });
  await enterDdz(capped);
  const bidOnce = async () => {
    const btn = capped.locator('.ddz-btn--hint');
    await capped.waitForFunction(() => { const b = document.querySelector('.ddz-btn--hint'); return !b || !b.disabled; }, null, { timeout: 15000 });
    if ((await btn.count()) > 0) await btn.click();
  };
  await bidOnce();
  await bidOnce();
  await capped.waitForFunction(() => ![...document.querySelectorAll('.ddz-seat__role')].some((el) => el.textContent?.includes('叫牌')), null, { timeout: 15000 });
  const cappedMult = Number((await capped.locator('.ddz-multiplier').innerText()).match(/×([\d.]+)/)?.[1]);
  const cappedBar = await skillBar(capped).innerText();
  check('赤壁：倍数已抢到 ×8 时不弹加倍', cappedMult === 8 && !cappedBar.includes('可加倍') && (await skillBar(capped).getByRole('button', { name: '加倍', exact: true }).count()) === 0 && cappedBar.includes('倍数已满'), `×${cappedMult} ${cappedBar.replace(/\n/g, ' ')}`);
  await capped.context().close();

  // 二重（周瑜良缘）当农民：加倍未定之前 AI 不出牌；失手付缴获 ×N 按实际扣金（农民半份）
  const page = await open(save({ ...strong, selectedLordId: 'zhouyu', gold: 900000, ownedPartnerIds: ['xiaoqiao'] }), { viewport: { width: 844, height: 390 }, bidding: true, ls: { 'jiaye-ddz-seed': '23' } });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  const gold = await venueGold(page);
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  await page.getByRole('button', { name: '不叫' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.ddz-seat__role')].some((el) => el.textContent?.includes('叫牌')), null, { timeout: 15000 });
  const farmer = (await page.locator('.ddz-seat--self .ddz-seat__role').innerText()).includes('农民');
  await page.waitForTimeout(2500);
  const playedWhileOpen = await page.locator('.ddz-seat--left .ddz-seat__play .mini-card, .ddz-seat--right .ddz-seat__play .mini-card').count();
  const bar = skillBar(page);
  const offerText = await bar.innerText();
  check('赤壁当农民：加倍未定前 AI 不出牌，按钮仍在', farmer && playedWhileOpen === 0 && (await bar.getByRole('button', { name: '加倍', exact: true }).count()) === 1, `farmer=${farmer} played=${playedWhileOpen} ${offerText.replace(/\n/g, ' ')}`);
  // 农民半份：失手付 两成 × 1 × 20 × 0.5 = 缴获 ×2
  check('赤壁当农民：对赌说明按农民半份写「失手付缴获 ×2」', offerText.includes('失手付缴获 ×2（平时 ×0.1）'), offerText.replace(/\n/g, ' '));
  await bar.getByRole('button', { name: '加倍', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.ddz-seat--left .ddz-seat__play .mini-card, .ddz-seat--right .ddz-seat__play .mini-card, .ddz-seat__action').length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const aiPlayed = await page.locator('.ddz-seat--left .ddz-seat__play .mini-card, .ddz-seat--right .ddz-seat__play .mini-card').count();
  check('赤壁当农民：选完加倍后牌局继续', aiPlayed > 0, `played=${aiPlayed}`);
  let message = '';
  page.on('dialog', (d) => { message = d.message(); d.accept(); });
  const before = await read(page);
  await page.getByRole('button', { name: /^认输/ }).click();
  await page.locator('.home-v2').waitFor();
  const after = await read(page);
  const paid = before.gold - after.gold;
  const ratio = Math.round((paid / gold) * 10) / 10;
  check('赤壁认输：确认框写牌桌倍数（不超 8）与实际「付缴获 ×N」，扣金一致', paid > 0 && message.includes(`认输将损失 ${paid.toLocaleString()} 金`) && message.includes(`付缴获 ×${ratio}`) && !/×(1[0-9]|[2-9][0-9])）/.test(message) && !/当前 ×(9|[1-9][0-9])/.test(message), `${message} Δ=${paid} gold=${gold}`);
  await page.context().close();
});

await scenario('伴侣·孙尚香枭姬', async () => {
  // 找一副地主 20 张里有炸弹的牌：你先出，直接炸
  const seed = findSeed((deal) => ddzLib.findPlayableCombos(deal.hands[0], null).some((cards) => ddzLib.evaluateCards(cards).type === 'bomb'));
  const deal = seededDeals(seed).deals[0];
  const bomb = ddzLib.findPlayableCombos(deal.hands[0], null).find((cards) => ddzLib.evaluateCards(cards).type === 'bomb');
  const page = await open(save({ ...strong, ownedPartnerIds: ['sunshangxiang'] }), { viewport: { width: 844, height: 390 }, ls: { 'jiaye-ddz-seed': String(seed) } });
  await enterDdz(page);
  await pickCards(page, bomb);
  await page.getByRole('button', { name: '出牌', exact: true }).click();
  await page.waitForTimeout(150);
  check('枭姬一重：你的炸弹翻 ×2.25 并播报弓腰姬', (await page.locator('.ddz-multiplier').innerText()).includes('×2.25') && (await flashText(page)).includes('弓腰姬 ×2.25'), `${await page.locator('.ddz-multiplier').innerText()} ${await flashText(page)}`);
  await page.context().close();
});

await scenario('伴侣·大乔同心', async () => {
  // 你牌力弱不叫、有家会叫：你当农民，二重（孙权良缘）亮出队友整手
  const score = (hand) => { const c = new Map(); for (const x of hand) c.set(x.value, (c.get(x.value) ?? 0) + 1); return (c.get(17) ? 3 : 0) + (c.get(16) ? 2 : 0) + (c.get(15) ?? 0) * 2 + (c.get(14) ?? 0) + [...c.values()].filter((n) => n === 4).length * 4; };
  const seed = findSeed((deal) => score(bidHandOf(deal)) < 8 && (score(deal.hands[1]) >= 8 || score(deal.hands[2]) >= 8));
  const page = await open(save({ ...strong, selectedLordId: 'sunquan', ownedPartnerIds: ['daqiao'] }), { viewport: { width: 844, height: 390 }, bidding: true, ls: { 'jiaye-ddz-seed': String(seed) } });
  await enterDdz(page);
  await page.getByRole('button', { name: '不叫' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.ddz-seat__role')].some((el) => el.textContent?.includes('叫牌')), null, { timeout: 15000 });
  const view = await page.evaluate(() => {
    const seats = [...document.querySelectorAll('.ddz-seat')].map((seat) => ({ role: seat.querySelector('.ddz-seat__role')?.textContent, name: seat.querySelector('.ddz-seat__name')?.textContent, count: Number(seat.querySelector('.ddz-seat__count')?.textContent?.match(/\d+/)?.[0]) }));
    const line = document.querySelector('.ddz-skillbar [data-line="mate"]');
    return { seats, text: line?.textContent ?? '', cards: line ? line.querySelectorAll('.mini-card').length : -1 };
  });
  const mate = view.seats.slice(0, 2).find((seat) => seat.role === '农民');
  check('同心二重：当农民亮出队友整手', view.seats[2]?.role === '农民' && mate && view.text.includes(`队友${mate.name}整手`) && view.cards === mate.count, JSON.stringify(view));
  await page.context().close();
});

await scenario('伴侣·蔡文姬胡笳辨音', async () => {
  const seed = 19;
  const deal = seededDeals(seed).deals[0];
  const sum = ddzLib.unseenSummary(deal.hands[0], []);
  const page = await open(save({ ...strong, ownedPartnerIds: ['caiwenji'] }), { viewport: { width: 844, height: 390 }, ls: { 'jiaye-ddz-seed': String(seed) } });
  await enterDdz(page);
  const text = await skillBar(page).innerText();
  check('胡笳辨音：写明两家尚余炸弹、王、2 的张数', text.includes(`两家尚余：炸弹 ${sum.bombs} · 王 ${sum.jokers} · 2 ${sum.twos}`), text.replace(/\n/g, ' '));
  await page.context().close();
});

await scenario('伴侣·步练师问计', async () => {
  const seed = 23;
  const deal = seededDeals(seed).deals[0];
  const first = ddzLib.findPlayableCombos(deal.hands[0], null)[0];
  const combo = ddzLib.evaluateCards(first);
  const verdict = (hand) => (ddzLib.findPlayableCombos(hand, combo).length > 0 ? '有牌可压' : '压不过');
  const page = await open(save({ ...strong, ownedPartnerIds: ['bulianshi'] }), { viewport: { width: 844, height: 390 }, ls: { 'jiaye-ddz-seed': String(seed) } });
  await enterDdz(page);
  const bar = skillBar(page);
  check('问计：没选牌时按钮不可点', await bar.getByRole('button', { name: '问计' }).isDisabled());
  await page.getByRole('button', { name: '提示', exact: true }).click();
  await bar.getByRole('button', { name: '问计' }).click();
  const text = await bar.innerText();
  check('问计：答出下家、上家压不压得过，次数 −1', text.includes(`下家${verdict(deal.hands[1])}`) && text.includes(`上家${verdict(deal.hands[2])}`) && text.includes('×1'), text.replace(/\n/g, ' '));
  await page.context().close();
});

await scenario('伴侣·糜夫人舍身', async () => {
  // 刘备良缘：二重，失手少付 20%
  const page = await open(save({ ...strong, selectedLordId: 'liubei', gold: 50000, ownedPartnerIds: ['mifuren'] }), { viewport: { width: 844, height: 390 } });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByRole('button', { name: /中级场/ }).click();
  const gold = await venueGold(page);
  const summary = await page.locator('.venue-summary').first().innerText();
  const cut = Math.round(gold * 0.2 * 0.8);
  check('舍身二重：选场写明失手少付 20%，折损按八成', summary.includes('（舍身：失手少付 20%）') && summary.includes(`败折损 ${cut.toLocaleString()} 金`), summary);
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  const g0 = (await read(page)).gold;
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /^认输/ }).click();
  await page.locator('.home-v2').waitFor();
  const s1 = await read(page);
  check('舍身：认输按少付后的金额扣，并记一次发动', g0 - s1.gold === cut && s1.skillStats?.mifuren?.games === 1 && s1.skillStats.mifuren.uses === 1, `Δ=${g0 - s1.gold} ${JSON.stringify(s1.skillStats)}`);
  await page.context().close();
  // 攻郡未克：退还 15% 军资
  const siege = await open(save({ ...strong, homeLevel: 5, selectedLordId: 'liubei', gold: 200000, orders: 3, day: 40, ownedPartnerIds: ['mifuren'] }));
  await siege.getByRole('button', { name: '出征', exact: true }).click();
  await siege.locator('.conquest-map').getByRole('button', { name: /出兵攻取南阳郡/ }).click();
  await siege.getByText('攻取南阳郡').first().waitFor();
  siege.on('dialog', (d) => d.accept());
  await siege.getByRole('button', { name: '撤兵' }).click();
  await siege.locator('.home-v2').waitFor();
  const s2 = await read(siege);
  // v3.1：侯门显贵押金 −5%（75,000 → 71,250），舍身 15% 护回 10,688
  check('舍身：攻郡未克护回 15% 军资', s2.gold === 200000 - 71250 + 10688 && (s2.eventLog?.[0]?.detail ?? '').includes('舍身'), `${s2.gold} ${s2.eventLog?.[0]?.detail}`);
  await siege.context().close();
  // 攻郡中途刷新离开：与点「撤兵」一样退 15% 军资（比例出兵时写进存档）
  const fled = await open(save({ ...strong, homeLevel: 5, selectedLordId: 'liubei', gold: 200000, orders: 3, day: 40, ownedPartnerIds: ['mifuren'] }));
  await fled.getByRole('button', { name: '出征', exact: true }).click();
  await fled.locator('.conquest-map').getByRole('button', { name: /出兵攻取南阳郡/ }).click();
  await fled.getByText('攻取南阳郡').first().waitFor();
  const mid = await read(fled);
  await fled.reload({ waitUntil: 'domcontentloaded' });
  await fled.waitForTimeout(500);
  const s3 = await read(fled);
  check('舍身：攻郡中途刷新离开同样护回 15% 军资', mid.activeBattle?.conquest?.refundRate === 0.15 && s3.activeBattle === null && s3.gold === 200000 - 71250 + 10688 && (s3.eventLog?.[0]?.detail ?? '').includes('舍身'), `${JSON.stringify(mid.activeBattle?.conquest)} ${s3.gold} ${s3.eventLog?.[0]?.detail}`);
  await fled.context().close();
});

await scenario('伴侣·祝融烈火', async () => {
  const isLong = (cards) => ['straight', 'pair-straight', 'airplane'].includes(ddzLib.evaluateCards(cards).type) && cards.length >= 5;
  const seed = findSeed((deal) => ddzLib.findPlayableCombos(deal.hands[0], null).some(isLong));
  const deal = seededDeals(seed).deals[0];
  const long = ddzLib.findPlayableCombos(deal.hands[0], null).find(isLong);
  const page = await open(save({ ...strong, ownedPartnerIds: ['zhurong'] }), { viewport: { width: 844, height: 390 }, ls: { 'jiaye-ddz-seed': String(seed) } });
  await enterDdz(page);
  await pickCards(page, long);
  await page.getByRole('button', { name: '出牌', exact: true }).click();
  await page.waitForTimeout(150);
  check('烈火：打出长牌型播报 +5%，技能条记 +5%', (await flashText(page)).includes('烈火 +5%') && (await skillBar(page).innerText()).includes('+5%'), `${await flashText(page)} | ${(await skillBar(page).innerText()).replace(/\n/g, ' ')}`);
  await page.context().close();
});

await scenario('伴侣·随行选择持久化', async () => {
  const page = await open(save({ ...strong, homeLevel: 5, gold: 200000, orders: 3, ownedPartnerIds: ['diaochan', 'zhurong'] }), { viewport: { width: 844, height: 390 } });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  const group = page.locator('.venue-panel').getByRole('radiogroup', { name: '随行伴侣' });
  check('出征页有随行伴侣，默认良缘貂蝉', (await group.getByRole('radio').count()) === 2 && (await group.getByRole('radio', { checked: true }).innerText()).includes('貂蝉'));
  check('攻郡面板只写一行当前随行，不重复放选择器', (await page.locator('.conquest-panel').getByRole('radiogroup', { name: '随行伴侣' }).count()) === 0 && (await page.locator('.conquest-panel .escort-summary').innerText()).includes('随行：貂蝉'));
  await group.getByRole('radio', { name: /祝融/ }).click();
  check('点选即换并写进存档', (await read(page)).escortPartnerId === 'zhurong');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '出征', exact: true }).click();
  check('刷新后仍是祝融随行', (await page.locator('.venue-panel').getByRole('radio', { checked: true }).innerText()).includes('祝融'));
  await page.getByRole('button', { name: /^进入斗地主/ }).click();
  await page.getByText('斗地主牌局').first().waitFor();
  check('牌桌技能条换成祝融·烈火', (await skillBar(page).innerText()).includes('祝融·烈火'));
  await page.context().close();
});

await scenario('伴侣·心事卡写明技能升级', async () => {
  // 关羽帐下貂蝉一重：了却第一段心事升二重
  const page = await open(save({ selectedLordId: 'guanyu', day: 15, ownedPartnerIds: ['diaochan'], pendingChoice: { eventId: 'partner:diaochan', day: 15, dailyIncome: 100 } }));
  const card = page.getByRole('dialog', { name: '伴侣心事' });
  await card.waitFor();
  check('心事卡写明了却后技能升至二重', (await card.innerText()).includes('了却心事，貂蝉「闭月」升至二重：开局探得上家最大 3 张牌'), (await card.innerText()).replace(/\n/g, ' '));
  await page.context().close();
});

await scenario('伴侣·老存档技能等级', async () => {
  // 老存档没有随行字段：两段心事都了却 → 三重；随行按第一位入府默认；脏的 skillStats 截成非负整数
  const page = await open(save({ selectedLordId: 'guanyu', ownedPartnerIds: ['zhenji', 'daqiao'], resolvedPartnerEvents: { zhenji: 'a', 'zhenji#2': 'b' }, skillStats: { zhenji: { games: -3, uses: 2.7 }, nobody: { games: 1, uses: 1 } } }));
  await page.locator('.home-v2').waitFor();
  await page.waitForTimeout(400);
  const s = await read(page);
  check('老存档读入：随行默认第一位入府、统计已清洗', s.escortPartnerId === 'zhenji' && JSON.stringify(s.skillStats) === JSON.stringify({ zhenji: { games: 0, uses: 2 } }), JSON.stringify({ e: s.escortPartnerId, st: s.skillStats }));
  await page.getByRole('button', { name: '伴侣', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '伴侣招募' });
  await modal.waitFor();
  check('伴侣弹窗：甄姬洛神三重、大乔同心一重', (await modal.getByLabel('牌桌技能 洛神').innerText()).includes('洛神」 · 三重') && (await modal.getByLabel('牌桌技能 同心').innerText()).includes('同心」 · 一重'));
  await page.context().close();
});

await scenario('伴侣·随行统计累计', async () => {
  const page = await open(save({ ...strong, gold: 50000, orders: 3, ownedPartnerIds: ['diaochan'] }), { viewport: { width: 844, height: 390 } });
  page.on('dialog', (d) => d.accept());
  for (let i = 0; i < 2; i += 1) {
    await enterDdz(page, /初级场/);
    await page.getByRole('button', { name: /^认输/ }).click();
    await page.locator('.home-v2').waitFor();
  }
  const s = await read(page);
  check('随行两局：skillStats 记 2 局、闭月发动 2 次', s.skillStats?.diaochan?.games === 2 && s.skillStats.diaochan.uses === 2, JSON.stringify(s.skillStats));
  await page.getByRole('button', { name: '伴侣', exact: true }).click();
  check('伴侣弹窗写「随行 2 局 · 发动 2 次」', (await page.getByRole('dialog', { name: '伴侣招募' }).getByLabel('牌桌技能 闭月').innerText()).includes('随行 2 局 · 发动 2 次'));
  await page.context().close();
});

// ===== v2.2 邻郡反攻守城（替代北疆边患）：存档直接写时间戳，不真等 =====
const HR = 3600e3;
const near = (value, target, tol = 5 * 60e3) => typeof value === 'number' && Math.abs(value - target) <= tol;
const ALL_FIEFS = { nanyang: 'farming', runan: 'farming', yingchuan: 'farming', changsha: 'farming', bajun: 'farming', liaodong: 'farming' };
const allTaken = (at) => Object.fromEntries(Object.keys(ALL_FIEFS).map((id) => [id, at]));
/** 侯府、南阳 + 汝南，汝南正被袁术反攻（城防满、早过保护期） */
const siegeSave = (extra = {}) => {
  const now = Date.now();
  return save({
    homeLevel: 5, gold: 100000, day: 40, orders: 3, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan'],
    fiefs: { nanyang: 'farming', runan: 'farming' }, fiefWalls: { nanyang: 2, runan: 2 }, fiefTakenAt: { nanyang: now - 200 * HR, runan: now - 200 * HR },
    nextSiegeAt: now + 40 * HR, siege: { fiefId: 'runan', attacker: '袁术', skill: 'novice', startedAt: now, dueAt: now + 20 * HR }, ...extra
  });
};
const siegeLabel = async (page, name) => (await page.locator('.conquest-map g.conquest-node').filter({ hasText: name }).getAttribute('aria-label')) ?? '';

await scenario('守城·起反攻只选末端郡', async () => {
  // 六郡全占、都过了保护期、到点：只会在汝南、巴郡、辽东里挑（南阳、颍川、长沙是中间郡）
  // v3.1：六郡 + 王城即天下归心、不再起反攻，六郡全占的用例改用侯府
  const page = await open(save({ homeLevel: 5, legacyPoints: 0, gold: 50000, fiefs: ALL_FIEFS, fiefTakenAt: allTaken(Date.now() - 200 * HR), nextSiegeAt: Date.now() - 1000 }));
  await page.waitForTimeout(600);
  let s = await read(page);
  check('六郡全占只反攻末端郡', ['runan', 'bajun', 'liaodong'].includes(s.siege?.fiefId), JSON.stringify(s.siege));
  check('应战窗口 24 小时、来犯将牌艺降档', s.siege && s.siege.dueAt - s.siege.startedAt === 24 * HR && s.siege.skill === ({ runan: 'novice', bajun: 'veteran', liaodong: 'veteran' })[s.siege.fiefId], JSON.stringify(s.siege));
  check('首页告急条写明郡名、来犯将与剩余时间', /(汝南|巴|辽东)告急 · (袁术|严颜|公孙度)卷土重来 · 约 2[34] 小时/.test(await page.locator('.siege-alert').innerText()), await page.locator('.siege-alert').innerText());
  check('纪事记下告急', (s.eventLog[0]?.title ?? '').endsWith('告急'), s.eventLog[0]?.title);
  await page.getByRole('button', { name: '去守城 →' }).click();
  await page.locator('.conquest-map').waitFor();
  const besieged = page.locator('.conquest-map g.conquest-node.is-besieged');
  check('疆域图被围的郡红色告急并写倒计时', (await besieged.count()) === 1 && ((await besieged.getAttribute('aria-label')) ?? '').includes('告急') && /约2[34]时/.test(await besieged.locator('.conquest-node__timer').textContent()));
  await page.context().close();

  // 测试开关：jiaye-siege-now 跳过间隔与保护期，jiaye-siege-target 指定郡（须是末端郡）
  const forced = await open(save({ homeLevel: 5, fiefs: ALL_FIEFS, fiefTakenAt: allTaken(Date.now() - HR), nextSiegeAt: Date.now() + 40 * HR }), { ls: { 'jiaye-siege-now': '1', 'jiaye-siege-target': 'liaodong' } });
  await forced.waitForTimeout(600);
  s = await read(forced);
  check('siege-now + target：立即反攻辽东，公孙度高手降为老手', s.siege?.fiefId === 'liaodong' && s.siege.attacker === '公孙度' && s.siege.skill === 'veteran', JSON.stringify(s.siege));
  await forced.context().close();
  const hub = await open(save({ homeLevel: 5, fiefs: ALL_FIEFS, fiefTakenAt: allTaken(Date.now() - HR), nextSiegeAt: Date.now() + 40 * HR }), { ls: { 'jiaye-siege-now': '1', 'jiaye-siege-target': 'nanyang' } });
  await hub.waitForTimeout(600);
  s = await read(hub);
  check('指定中间郡南阳无效，仍只打末端郡', ['runan', 'bajun', 'liaodong'].includes(s.siege?.fiefId), JSON.stringify(s.siege));
  await hub.context().close();
  // 整军方略的郡再降一档：汝南袁术老手 → 生手 → 生手；颍川荀彧老手（整军）作为末端郡 → 生手
  const mil = await open(save({ homeLevel: 5, fiefs: { nanyang: 'farming', yingchuan: 'military' }, fiefTakenAt: { nanyang: Date.now() - 200 * HR, yingchuan: Date.now() - 200 * HR }, nextSiegeAt: Date.now() - 1000 }));
  await mil.waitForTimeout(600);
  s = await read(mil);
  check('整军郡来犯将再降一档（颍川荀彧老手 → 生手）', s.siege?.fiefId === 'yingchuan' && s.siege.skill === 'novice', JSON.stringify(s.siege));
  await mil.context().close();
});

await scenario('守城·保护期与迁移', async () => {
  // 末端郡都在 72 小时保护期内：不起反攻，6 小时后再看
  const now = Date.now();
  const page = await open(save({ homeLevel: 5, fiefs: ALL_FIEFS, fiefTakenAt: { ...allTaken(now - 200 * HR), runan: now - HR, bajun: now - HR, liaodong: now - 2 * HR }, nextSiegeAt: now - 1000 }));
  await page.waitForTimeout(600);
  let s = await read(page);
  check('末端郡都在保护期内不起反攻，6 小时后再看', s.siege === null && near(s.nextSiegeAt, Date.now() + 6 * HR), JSON.stringify({ siege: s.siege, next: s.nextSiegeAt - Date.now() }));
  check('没有反攻时首页无告急条', (await page.locator('.siege-alert').count()) === 0);
  await page.context().close();

  // 老存档：北疆边患一律作废（逾期的也不扣金），补日志；城防补 2、得郡时刻补现在、48 小时后才起第一次反攻
  const old = await open(save({ homeLevel: 5, gold: 40000, fiefs: { nanyang: 'farming' }, frontierRaid: { startDay: 10, startedAt: now - 25 * HR, dueAt: now - HR }, nextRaidDay: 10, frontierWins: 2 }));
  await old.waitForTimeout(600);
  s = await read(old);
  check('旧北疆存档：边患清掉不扣金并补日志', s.frontierRaid === null && s.gold === 40000 && s.frontierWins === 2 && s.eventLog.some((e) => e.title === '北疆已靖'), JSON.stringify({ g: s.gold, raid: s.frontierRaid, log: s.eventLog.map((e) => e.title) }));
  check('旧存档迁移：城防补 2、得郡时刻补现在、48 小时后起首次反攻', s.fiefWalls?.nanyang === 2 && near(s.fiefTakenAt?.nanyang, Date.now()) && near(s.nextSiegeAt, Date.now() + 48 * HR) && s.siege === null && s.peakFiefs === 1, JSON.stringify({ w: s.fiefWalls, t: s.fiefTakenAt, n: s.nextSiegeAt - Date.now(), p: s.peakFiefs }));
  check('首页不再有北疆告警', (await old.locator('.frontier-alert').count()) === 0 && !(await old.locator('main').innerText()).includes('去迎战'));
  await old.context().close();
  const noFief = await open(save({ homeLevel: 4, frontierRaid: { startDay: 10, startedAt: now, dueAt: now + HR }, nextRaidDay: 10 }));
  await noFief.waitForTimeout(400);
  s = await read(noFief);
  check('无郡的旧存档：边患清掉、反攻不计时', s.frontierRaid === null && s.nextSiegeAt === 0 && s.siege === null);
  await noFief.context().close();
  // 北疆迎战中途关页的旧存档：只算离阵，不扣金
  const midRaid = await open(save({ homeLevel: 4, gold: 5000, activeBattle: { mode: 'frontier', lossGold: 1000, rewardGold: 2000, odds: 0.5 } }));
  await midRaid.waitForTimeout(400);
  s = await read(midRaid);
  check('旧存档北疆中途离开：不扣金', s.activeBattle === null && s.gold === 5000 && s.eventLog[0]?.title === '中途离阵');
  await midRaid.context().close();
  // 坏数据：城防越界截到 1..2，不在手的郡的城防删掉，反攻目标不在手作废
  const dirty = await open(save({ homeLevel: 5, fiefs: { nanyang: 'farming' }, fiefWalls: { nanyang: 9, runan: 1 }, fiefTakenAt: { nanyang: now - 200 * HR }, nextSiegeAt: now + 40 * HR, siege: { fiefId: 'runan', attacker: '袁术', skill: 'novice', startedAt: now, dueAt: now + HR } }));
  await dirty.waitForTimeout(400);
  s = await read(dirty);
  check('坏数据修剪：城防截到 2、不在手的郡与反攻作废', JSON.stringify(s.fiefWalls) === '{"nanyang":2}' && s.siege === null, JSON.stringify({ w: s.fiefWalls, siege: s.siege }));
  await dirty.context().close();
  // 开疆志向按本代最高郡数：丢过郡不倒退，也不能靠丢了再收复刷进度
  const amb = await open(save({ generation: 2, homeLevel: 5, fiefs: { nanyang: 'farming' }, peakFiefs: 2, ambition: { id: 'expansion', target: 1, baseFiefs: 1 } }));
  check('开疆志向按本代最高郡数算（失郡不倒退）', (await amb.locator('.home-hud').innerText()).includes('志向 开疆 已达成'), await amb.locator('.home-hud').innerText());
  await amb.context().close();
});

await scenario('守城·整局结算', async () => {
  // 城防 1 的汝南被反攻，0 道军令照样迎战；城主坐庄打完：守住则城防回满 + 犒赏 2,500 + 守城胜场；失手则失郡
  let won = false;
  let lossChecked = false;
  for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
    const page = await open(siegeSave({ orders: 0, fiefWalls: { nanyang: 2, runan: 1 } }), { ls: { 'jiaye-ddz-seed': String(seed) } });
    const s0 = await read(page);
    await page.getByRole('button', { name: '去守城 →' }).click();
    await page.getByRole('button', { name: /迎战守城 · 袁术/ }).click();
    await page.getByText('守卫汝南郡').first().waitFor();
    if (seed === 11) {
      const s1 = await read(page);
      check('守城不耗军令、不押军资', s1.orders === 0 && s1.gold === s0.gold && s1.activeBattle?.conquest?.kind === 'defend' && s1.activeBattle.conquest.stake === 0, JSON.stringify(s1.activeBattle));
      check('城主坐庄：开局即地主先出、对面是来犯将袁术、按钮是弃城', (await page.locator('.ddz-seat--self .ddz-seat__role').innerText()) === '地主' && (await page.locator('.ddz-seat--left .ddz-seat__name').innerText()).includes('袁术') && (await page.getByRole('button', { name: '弃城' }).isVisible()));
    }
    const ended = await playOut(page);
    await page.waitForTimeout(500);
    const s2 = await read(page);
    const banner = await page.locator('.doudizhu-result-banner').innerText().catch(() => '');
    if (ended && banner.includes('守住汝南郡')) {
      won = true;
      check('守住：城防回满、犒赏 2,500、守城胜场 +1、48 小时后再来', s2.fiefWalls.runan === 2 && s2.gold === s0.gold + 2500 && s2.frontierWins === 1 && s2.battleWins === s0.battleWins + 1 && s2.siege === null && near(s2.nextSiegeAt, Date.now() + 48 * HR) && s2.orders === 0 && !s2.activeBattle, JSON.stringify({ w: s2.fiefWalls, dg: s2.gold - s0.gold, fw: s2.frontierWins, n: s2.nextSiegeAt - Date.now() }));
      check('守住写进纪事', s2.eventLog[0]?.title === '守住汝南郡' && s2.eventLog[0]?.goldDelta === 2500, JSON.stringify(s2.eventLog[0]));
      await page.getByRole('button', { name: '返回家业' }).click();
      await openGoals(page);
      check('任务「首守城池」可领赏（id 仍是 frontier-first-win）', await page.locator('.quest-item').filter({ hasText: '首守城池' }).getByRole('button', { name: '领赏' }).isEnabled().catch(() => false));
    } else if (ended && !lossChecked) {
      lossChecked = true;
      check('守城未克（城防 1）：失郡、不扣金、记一负', !s2.fiefs.runan && near(s2.lostFiefs?.runan, Date.now()) && s2.gold === s0.gold && s2.battleLosses === s0.battleLosses + 1 && s2.siege === null, JSON.stringify({ f: s2.fiefs, g: s2.gold - s0.gold, l: s2.lostFiefs }));
    }
    await page.context().close();
    if (won) break;
  }
  check('守城能打赢一局（8 个种子内）', won);
});

await scenario('守城·失手告急与特权暂停', async () => {
  const page = await open(siegeSave());
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '出征', exact: true }).click();
  check('城防满时汝南特权生效', (await page.locator('.venue-summary').first().innerText()).includes('（汝南：失手减半）'));
  const s0 = await read(page);
  await page.getByRole('button', { name: /迎战守城/ }).click();
  await page.getByText('守卫汝南郡').first().waitFor();
  await page.getByRole('button', { name: '弃城' }).click();
  await page.locator('.home-v2').waitFor();
  const s = await read(page);
  check('牌桌上弃城按失手：城防降为 1、郡还在、不扣金', s.fiefWalls.runan === 1 && s.fiefs.runan === 'farming' && s.gold === s0.gold && s.battleLosses === s0.battleLosses + 1 && s.siege === null && near(s.nextSiegeAt, Date.now() + 48 * HR) && !s.activeBattle, JSON.stringify({ w: s.fiefWalls, g: s.gold - s0.gold }));
  check('纪事写告急与特权暂停', s.eventLog[0]?.title === '汝南郡告急' && (s.eventLog[0]?.detail ?? '').includes('「门生故吏」暂停'), JSON.stringify(s.eventLog[0]));
  check('首页提示城防告急、特权暂停，可去修城', (await page.locator('.siege-alert').innerText()).includes('汝南城防告急，郡中特权暂停') && (await page.getByRole('button', { name: '去修城 →' }).isVisible()));
  await page.getByRole('button', { name: '出征', exact: true }).click();
  check('告急郡的牌桌特权暂停（选场不再写汝南减半）', !(await page.locator('.venue-summary').first().innerText()).includes('汝南'));
  check('疆域图写城防 1/2', (await siegeLabel(page, '汝南')).includes('城防 1/2'), await siegeLabel(page, '汝南'));
  await page.context().close();

  // 地图上的弃城要二次确认：取消则什么都不变
  const keep = await open(siegeSave());
  keep.on('dialog', (d) => d.dismiss());
  await keep.getByRole('button', { name: '去守城 →' }).click();
  const k0 = await read(keep);
  await keep.locator('.conquest-panel').getByRole('button', { name: '弃城' }).click();
  await keep.waitForTimeout(300);
  const k1 = await read(keep);
  check('弃城取消确认则不变', k1.siege?.fiefId === 'runan' && k1.fiefWalls.runan === 2 && k1.battleLosses === k0.battleLosses);
  await keep.context().close();
});

await scenario('守城·再失手失郡', async () => {
  // 城防 1 的汝南（整军）再失手：郡暂归袁术、地图缩回、军令按新上限截断
  // v2.3 军令上限 6 → 8：汝南整军时上限 9，存 9 道，失郡后收回到 8
  const page = await open(siegeSave({ fiefs: { nanyang: 'farming', runan: 'military' }, fiefWalls: { nanyang: 2, runan: 1 }, orders: 9 }));
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '去守城 →' }).click();
  await page.locator('.conquest-map').waitFor();
  const heldBefore = await page.locator('.conquest-edge.is-held').count();
  await page.locator('.conquest-panel').getByRole('button', { name: '弃城' }).click();
  await page.waitForTimeout(400);
  const s = await read(page);
  check('城防归零失郡：删郡与城防、记失郡时刻、军令 9 → 8（v2.3 军令上限 6 → 8）', !s.fiefs.runan && s.fiefWalls.runan === undefined && s.fiefTakenAt.runan === undefined && near(s.lostFiefs?.runan, Date.now()) && s.orders === 8 && s.siege === null, JSON.stringify({ f: s.fiefs, w: s.fiefWalls, o: s.orders, l: s.lostFiefs }));
  check('纪事写暂归，不写负面字', s.eventLog[0]?.title === '汝南郡暂归袁术' && !/[输败亏]/.test(s.eventLog[0]?.detail ?? ''), JSON.stringify(s.eventLog[0]));
  check('地图缩回：连线收回一条、汝南褪色写暂归可半价收复', (await page.locator('.conquest-edge.is-held').count()) === heldBefore - 1 && (await siegeLabel(page, '汝南')).includes('暂归袁术 · 可半价收复') && (await page.locator('.conquest-map g.conquest-node.is-lost').count()) === 1, `${heldBefore} → ${await page.locator('.conquest-edge.is-held').count()} ${await siegeLabel(page, '汝南')}`);
  await page.getByRole('button', { name: '回府' }).click();
  check('首页提示可半价收复', (await page.locator('.siege-alert').innerText()).includes('汝南暂归袁术') && (await page.getByRole('button', { name: '去收复 →' }).isVisible()));
  await page.context().close();
});

await scenario('守城·逾期最低到 1', async () => {
  const past = { startedAt: Date.now() - 30 * HR, dueAt: Date.now() - 6 * HR };
  const page = await open(siegeSave({ siege: { fiefId: 'runan', attacker: '袁术', skill: 'novice', ...past } }));
  await page.waitForTimeout(500);
  let s = await read(page);
  check('逾期没应战：城防 −1、排下一次', s.fiefWalls.runan === 1 && s.siege === null && near(s.nextSiegeAt, Date.now() + 48 * HR) && s.eventLog.some((e) => e.title === '汝南郡城防受损'), JSON.stringify({ w: s.fiefWalls, n: s.nextSiegeAt - Date.now() }));
  await page.context().close();
  // 城防 1 再逾期（离线 10 天）：最低留 1，不会失郡
  const off = await open(siegeSave({ fiefWalls: { nanyang: 2, runan: 1 }, siege: { fiefId: 'runan', attacker: '袁术', skill: 'novice', ...past }, lastSavedAt: Date.now() - 241 * HR }));
  await off.waitForTimeout(600);
  s = await read(off);
  check('离线逾期最低扣到 1，不会失郡', s.fiefs.runan === 'farming' && s.fiefWalls.runan === 1 && s.siege === null && s.day > 40, JSON.stringify({ f: s.fiefs, w: s.fiefWalls, d: s.day }));
  await off.context().close();
  // 连点政务不推进反攻（按真实时间算，烧不掉应战窗口）
  const burn = await open(siegeSave());
  const b0 = await read(burn);
  // 府中来报弹窗出来就先定夺（选第一项），再接着办政务
  for (let i = 0; i < 8; i++) {
    const option = burn.locator('.choice-card__options button').first();
    if (await option.isVisible().catch(() => false)) await option.click();
    else await burn.locator('.home-actions__main').click();
    await burn.waitForTimeout(150);
  }
  s = await read(burn);
  check('连点政务不推进反攻', s.day >= b0.day + 4 && s.siege?.dueAt === b0.siege.dueAt && s.fiefWalls.runan === 2, `day=${b0.day}→${s.day}`);
  await burn.context().close();
});

await scenario('守城·刷新保留可重打', async () => {
  const page = await open(siegeSave());
  const s0 = await read(page);
  await page.getByRole('button', { name: '去守城 →' }).click();
  await page.getByRole('button', { name: /迎战守城/ }).click();
  await page.getByText('守卫汝南郡').first().waitFor();
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.home-v2').waitFor({ timeout: 8000 });
  const s = await read(page);
  check('守城中途刷新：反攻保留、不扣金不记负、城防不变', !s.activeBattle && s.siege?.fiefId === 'runan' && s.siege.dueAt === s0.siege.dueAt && s.gold === s0.gold && s.battleLosses === s0.battleLosses && s.fiefWalls.runan === 2 && s.eventLog[0]?.title === '守城暂歇', JSON.stringify({ ab: s.activeBattle, siege: s.siege, t: s.eventLog[0]?.title }));
  await page.getByRole('button', { name: '去守城 →' }).click();
  await page.getByRole('button', { name: /迎战守城/ }).click();
  check('刷新后可以重打', await page.getByText('守卫汝南郡').first().isVisible({ timeout: 8000 }).catch(() => false));
  await page.context().close();
});

await scenario('守城·修城', async () => {
  const page = await open(siegeSave({ siege: null, fiefWalls: { nanyang: 2, runan: 1 }, gold: 20000 }));
  await page.getByRole('button', { name: '去修城 →' }).click();
  await page.locator('.conquest-panel').waitFor();
  check('去修城直达汝南、面板写特权暂停', (await page.locator('.conquest-panel').innerText()).includes('城防 1/2 · 告急：牌桌特权「门生故吏」暂停'));
  await page.getByRole('button', { name: '修城 · 12,500 金' }).click();
  await page.waitForTimeout(300);
  const s = await read(page);
  check('修城：扣开拓价 5%、城防回满', s.gold === 7500 && s.fiefWalls.runan === 2 && s.eventLog[0]?.title === '修缮汝南郡城防', JSON.stringify({ g: s.gold, w: s.fiefWalls }));
  await page.context().close();
  const poor = await open(siegeSave({ siege: null, fiefWalls: { nanyang: 2, runan: 1 }, gold: 10000 }));
  await poor.getByRole('button', { name: '去修城 →' }).click();
  const btn = poor.getByRole('button', { name: /修城 · 差 2,500 金/ });
  check('金不足时修城按钮禁用并写差额', await btn.isDisabled());
  await poor.context().close();
});

await scenario('守城·收复半价', async () => {
  // 失郡 72 小时内：押开拓价 25%（汝南 62,500；v3.1 侯府「侯门显贵」押金 −5% → 59,375），记为收复
  const lost = { nanyang: 'farming' };
  const page = await open(save({ homeLevel: 5, gold: 200000, orders: 3, day: 40, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan'], fiefs: lost, fiefTakenAt: { nanyang: Date.now() - 200 * HR }, lostFiefs: { runan: Date.now() - HR }, nextSiegeAt: Date.now() + 40 * HR }));
  await page.getByRole('button', { name: '去收复 →' }).click();
  await page.locator('.conquest-panel').waitFor();
  check('收复面板写暂归与半价', (await page.locator('.conquest-panel').innerText()).includes('汝南郡 · 暂归袁术') && (await page.locator('.conquest-panel').innerText()).includes('半价收复'));
  const s0 = await read(page);
  await page.getByRole('button', { name: '收复汝南郡 · 耗 1 军令 · 押 59,375 金' }).click();
  await page.getByText('攻取汝南郡').first().waitFor();
  const s1 = await read(page);
  check('收复押 25%（×0.95）、耗 1 军令、记为收复', s0.gold - s1.gold === 59375 && s1.orders === 2 && s1.activeBattle?.conquest?.kind === 'reclaim', JSON.stringify(s1.activeBattle));
  const ended = await playOut(page);
  await page.waitForTimeout(500);
  const s2 = await read(page);
  const won = Boolean(s2.fiefs.runan);
  check('收复打完：胜则重得郡、城防满、重新保护 72 小时；未克则军资不退', ended && (won
    ? s2.fiefWalls.runan === 2 && near(s2.fiefTakenAt.runan, Date.now()) && !s2.lostFiefs.runan && s2.eventLog[0]?.title === '收复汝南郡'
    : s2.gold === s1.gold && near(s2.lostFiefs.runan, s0.lostFiefs.runan, 10) && s2.eventLog[0]?.title === '收复汝南郡未克'), `won=${won} ${s2.eventLog[0]?.title}`);
  await page.context().close();
  // 过了 72 小时按原价（50%，侯门显贵 ×0.95 → 118,750）
  const late = await open(save({ homeLevel: 5, gold: 200000, orders: 3, fiefs: lost, fiefTakenAt: { nanyang: Date.now() - 200 * HR }, lostFiefs: { runan: Date.now() - 73 * HR }, nextSiegeAt: Date.now() + 40 * HR }));
  check('超过 72 小时不再提示收复', (await late.locator('.siege-alert').count()) === 0);
  await late.getByRole('button', { name: '出征', exact: true }).click();
  await late.locator('.conquest-map g.conquest-node').filter({ hasText: '汝南' }).click({ force: true });
  check('超过 72 小时按原价押 118,750', await late.getByRole('button', { name: '出兵攻取汝南郡 · 耗 1 军令 · 押 118,750 金' }).isVisible());
  await late.context().close();
});

await scenario('守城·天下归心后不再起', async () => {
  const page = await open(save({ homeLevel: 6, legacyPoints: 20, fiefs: ALL_FIEFS, fiefTakenAt: allTaken(Date.now() - 200 * HR), nextSiegeAt: Date.now() - 1000 }), { ls: { 'jiaye-siege-now': '1' } });
  await page.waitForTimeout(800);
  const s = await read(page);
  check('天下归心后即使 siege-now 也不起反攻', s.siege === null && (await page.locator('.siege-alert').count()) === 0, JSON.stringify(s.siege));
  await page.context().close();
});

await scenario('守城·直达按钮在首屏', async () => {
  // 首页告急条一点直达：迎战守城 / 修城 / 收复按钮不用再滚就在视口里（横竖屏、平板）
  const inView = async (page, name) => page.getByRole('button', { name }).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0;
  });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 667, height: 375 }, { width: 768, height: 1024 }]) {
    const tag = `${viewport.width}x${viewport.height}`;
    const page = await open(siegeSave(), { viewport });
    await page.getByRole('button', { name: '去守城 →' }).click();
    await page.getByRole('button', { name: /迎战守城 · 袁术/ }).waitFor();
    await page.waitForTimeout(300);
    check(`${tag} 去守城后「迎战守城」在首屏`, await inView(page, /迎战守城 · 袁术/));
    await page.context().close();
  }
  const repair = await open(siegeSave({ siege: null, fiefWalls: { nanyang: 2, runan: 1 }, gold: 20000 }));
  await repair.getByRole('button', { name: '去修城 →' }).click();
  await repair.getByRole('button', { name: /修城 · 12,500 金/ }).waitFor();
  await repair.waitForTimeout(300);
  check('390x844 去修城后修城按钮在首屏', await inView(repair, /修城 · 12,500 金/));
  await repair.context().close();
  const reclaim = await open(save({ homeLevel: 5, gold: 200000, orders: 3, day: 40, fiefs: { nanyang: 'farming' }, fiefTakenAt: { nanyang: Date.now() - 200 * HR }, lostFiefs: { runan: Date.now() - HR }, nextSiegeAt: Date.now() + 40 * HR }));
  await reclaim.getByRole('button', { name: '去收复 →' }).click();
  await reclaim.getByRole('button', { name: /收复汝南郡 · 耗 1 军令/ }).waitFor();
  await reclaim.waitForTimeout(300);
  check('390x844 去收复后收复按钮在首屏', await inView(reclaim, /收复汝南郡 · 耗 1 军令/));
  await reclaim.context().close();
});

await scenario('守城·被围郡成腹地即解围', async () => {
  // 只持南阳（城防 1）且南阳被围，反攻窗口内攻下汝南：南阳成了中间郡，反攻作罢，不会连带丢汝南
  const base = (extra = {}) => save({ homeLevel: 5, gold: 400000, day: 40, orders: 3, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan'],
    fiefs: { nanyang: 'farming' }, fiefWalls: { nanyang: 1 }, fiefTakenAt: { nanyang: Date.now() - 200 * HR },
    nextSiegeAt: Date.now() + 40 * HR, siege: { fiefId: 'nanyang', attacker: '张绣', skill: 'novice', startedAt: Date.now(), dueAt: Date.now() + 20 * HR }, ...extra });
  let won = false;
  for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
    const page = await open(base(), { ls: { 'jiaye-ddz-seed': String(seed) } });
    await page.getByRole('button', { name: '出征', exact: true }).click();
    await page.locator('.conquest-map g.conquest-node').filter({ hasText: '汝南' }).click({ force: true });
    await page.getByRole('button', { name: /出兵攻取汝南郡/ }).click();
    await page.getByText('攻取汝南郡').first().waitFor();
    const ended = await playOut(page);
    await page.waitForTimeout(500);
    const s = await read(page);
    if (ended && s.fiefs.runan) {
      won = true;
      check('攻下被围郡背后的郡：反攻作罢、48 小时后再来、城防不变', s.siege === null && near(s.nextSiegeAt, Date.now() + 48 * HR) && s.fiefWalls.nanyang === 1 && s.fiefs.nanyang === 'farming', JSON.stringify({ siege: s.siege, n: s.nextSiegeAt - Date.now(), w: s.fiefWalls }));
      check('纪事写南阳围解，不写负面字', s.eventLog.some((e) => e.title === '南阳围解' && e.detail.includes('已成腹地')) && !s.eventLog.slice(0, 3).some((e) => /[输败亏]/.test(e.title + e.detail)), JSON.stringify(s.eventLog.slice(0, 2)));
      await page.getByRole('button', { name: '返回家业' }).click();
      check('首页告急条随之消失', (await page.locator('.siege-alert').filter({ hasText: '南阳告急' }).count()) === 0);
    }
    await page.context().close();
    if (won) break;
  }
  check('反攻期间攻郡能打赢一局（8 个种子内）', won);
  // 读档兜底：存档里被围的已是中间郡（如旧版本留下的），读档即解围，两郡都在
  const load = await open(base({ fiefs: { nanyang: 'farming', runan: 'farming' }, fiefWalls: { nanyang: 1, runan: 2 }, fiefTakenAt: { nanyang: Date.now() - 200 * HR, runan: Date.now() - HR } }));
  await load.waitForTimeout(500);
  const s = await read(load);
  check('读档时被围郡已是中间郡：反攻作罢、两郡都在', s.siege === null && s.fiefs.nanyang && s.fiefs.runan && s.eventLog[0]?.title === '南阳围解', JSON.stringify({ siege: s.siege, f: s.fiefs, t: s.eventLog[0]?.title }));
  await load.context().close();
});

await scenario('守城·天下归心时进行中的反攻作罢', async () => {
  // 六郡全占 + 王城 + 家业点满足结局，存档里巴郡（城防 1）还被围：读档即解围，结局入口保留
  const page = await open(save({ homeLevel: 6, legacyPoints: 20, fiefs: ALL_FIEFS, fiefTakenAt: allTaken(Date.now() - 200 * HR), fiefWalls: { ...Object.fromEntries(Object.keys(ALL_FIEFS).map((id) => [id, 2])), bajun: 1 }, nextSiegeAt: Date.now() + 40 * HR, siege: { fiefId: 'bajun', attacker: '严颜', skill: 'veteran', startedAt: Date.now(), dueAt: Date.now() + 20 * HR } }));
  await page.waitForTimeout(500);
  const s = await read(page);
  check('天下归心：进行中的反攻作罢、六郡都在', s.siege === null && Object.keys(s.fiefs).length === 6 && s.eventLog[0]?.title === '巴围解' && s.eventLog[0].detail.includes('天下归心'), JSON.stringify({ siege: s.siege, t: s.eventLog[0] }));
  check('首页没有告急条', (await page.locator('.siege-alert').filter({ hasText: '告急 ·' }).count()) === 0);
  await page.context().close();
});

// 「守城·第二代重回侯府有缓冲」v3.1 删除：传位不再重走宅邸，没有「第二代重回侯府」这一步；换成下面这条
await scenario('守城·传位不中断反攻计时', async () => {
  const siege = { fiefId: 'runan', attacker: '袁术', skill: 'novice', startedAt: Date.now() - HR, dueAt: Date.now() + 20 * HR };
  const nextSiegeAt = Date.now() + 40 * HR;
  const page = await open(save({ homeLevel: 6, gold: 300000, fiefs: { nanyang: 'farming', runan: 'farming' }, fiefTakenAt: { nanyang: Date.now() - 200 * HR, runan: Date.now() - 200 * HR }, fiefWalls: { nanyang: 2, runan: 1 }, siege, nextSiegeAt }));
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '设置与存档' }).click();
  await page.getByRole('button', { name: '传位给下一代' }).click();
  await page.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  const mid = await read(page);
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  const s = await read(page);
  check('传位后反攻仍在、计时与城防不变', mid.siege?.fiefId === 'runan' && s.siege?.dueAt === siege.dueAt && s.nextSiegeAt === nextSiegeAt && s.fiefWalls.runan === 1 && Object.keys(s.fiefs).length === 2, JSON.stringify({ siege: s.siege, n: s.nextSiegeAt - nextSiegeAt, w: s.fiefWalls }));
  check('首页仍有告急条可去守城', await page.getByRole('button', { name: '去守城 →' }).isVisible());
  await page.context().close();
});

await scenario('守城·称号与任务', async () => {
  const page = await open(save({ homeLevel: 5, battleWins: 5, frontierWins: 3, fiefs: { nanyang: 'farming' }, claimedQuestIds: [] }));
  check('守城 3 次得称号「金汤之将」（id 仍是 north-general）', (await page.locator('.home-hud').innerText()).includes('「金汤之将」'));
  await openGoals(page);
  check('家业目标写守城战绩', (await page.locator('.home-record').innerText()).includes('守城 3'));
  check('任务改为「首守城池」', (await page.locator('.quest-item').filter({ hasText: '首守城池' }).innerText()).includes('守住一次邻郡反攻'));
  // v3.1：坐拥两郡（court-star）退役直接删，百战之将（river-tiger）仍现役
  await closeGoals(page);
  await page.getByRole('button', { name: '主公' }).click();
  const lordText = await page.getByRole('dialog', { name: '主公' }).innerText();
  check('court-star 已退役、river-tiger 仍现役', !lordText.includes('坐拥两郡') && lordText.includes('「百战之将」') && lordText.includes('斗地主缴获 +5%'), lordText.slice(0, 80));
  await page.context().close();
});

// ===== v2.3 真实时间府库与军令 =====
// 时间相关一律写存档时间戳或改页内 Date.now（shiftClock 往后拨并触发一次 tick），不真等
const HOUR = 3600e3;
async function shiftClock(page, ms) {
  await page.evaluate((delta) => {
    const w = window;
    if (!w.__realNow) w.__realNow = Date.now.bind(Date);
    w.__shift = (w.__shift ?? 0) + delta;
    Date.now = () => w.__realNow() + w.__shift;
    document.dispatchEvent(new Event('visibilitychange'));
  }, ms);
  await page.waitForTimeout(300);
}

await scenario('真实时间·府库自动推进', async () => {
  // 日长缩到 1.5 秒：开着页面不点任何东西，日子自己走、钱进府库不进金币
  const page = await open(rtSave({ day: 11, homeLevel: 2, ownedPartnerIds: [] }), { realtime: true, dayMs: 1500 });
  await page.waitForTimeout(3600);
  // 在线 tick 30 秒一次；切一次前后台立即补算（与真玩家切回前台同一路径）
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300);
  const s = await read(page);
  check('开着页面日子按真实时间推进、钱进府库', s.day >= 13 && s.treasury.days === s.day - 11 && s.treasury.gold > 0 && s.gold === 5000, JSON.stringify({ day: s.day, t: s.treasury, g: s.gold }));
  const text = await page.locator('.home-actions__main').innerText();
  check('主按钮写收取府库与积几日、进度条写府库 N/12 日', text.includes('收取府库') && /积 \d+ 日/.test(text) && /府库 \d+\/12 日/.test(await page.locator('.treasury-meter').innerText()), text.replace(/\n/g, ' '));
  const before = await read(page);
  await page.locator('.home-actions__main').click();
  await page.waitForTimeout(200);
  const after = await read(page);
  check('收取后入账、府库清空', after.gold - before.gold >= before.treasury.gold && after.treasury.gold <= after.gold - before.gold, JSON.stringify({ d: after.gold - before.gold, t0: before.treasury, t1: after.treasury }));
  await page.context().close();
});

await scenario('真实时间·府库封顶与半价', async () => {
  // 木屋上限 12 日：离开 15 小时 = 15 日，后 3 日只得半数；乡望第 15 日（未满）全额、第 25 日（已满）半数，门客献策被流民归附顶掉（第 20 日，未满）按现钱全额入库，流民归附留待定夺
  const page = await open(rtSave({ day: 11, homeLevel: 2, ownedPartnerIds: [], clockAt: Date.now() - 15 * HOUR - 60e3 }), { realtime: true, dayMs: 0 });
  await page.waitForTimeout(400);
  const s = await read(page);
  await dismissChoice(page);
  const inc = await dailyOf(page);
  const expected = 12 * inc + 3 * Math.round(inc * 0.5) + inc * 2 + Math.round(inc * 2 * 0.5) + 5 * inc;
  check('满 12 日后政务与事件现钱一律半价积存', s.day === 26 && s.treasury.days === 15 && s.treasury.gold === expected && s.gold === 5000, JSON.stringify({ day: s.day, t: s.treasury, expected, inc }));
  check('最近一桩二选一留待定夺、被顶掉的折现', s.pendingChoice?.eventId === 'refugees' && s.pendingChoice.day === 20, JSON.stringify(s.pendingChoice));
  check('离开 6 小时以上只写一条汇总纪事', s.eventLog[0]?.title === '离府归来' && s.eventLog[0].detail.includes('离开 15 小时') && s.eventLog[0].detail.includes('已满') && s.eventLog[0].detail.includes('待定夺') && !s.eventLog.some((e) => e.title === '乡望渐隆'), s.eventLog[0]?.detail);
  // 先把流民归附定夺掉（主按钮此时是「府中来报」），再看满额红点
  await page.locator('.home-actions__main').click();
  await page.locator('.choice-card__options button').first().click();
  await page.waitForTimeout(300);
  const meter = await page.locator('.treasury-meter').innerText();
  check('府库满额：进度条写积几日（满额几日）再放减半、主按钮亮红点', meter.includes('府库 15 日（满额 12）') && meter.includes('再放减半') && (await page.locator('.home-actions__main .treasury-dot').count()) === 1, meter);
  // 主按钮：「收取府库」与「+金额金」各自不拆行，红点不压字
  const layout = await page.evaluate(() => {
    const btn = document.querySelector('.home-actions__main');
    const amount = btn.querySelector('.treasury-amount');
    const dot = btn.querySelector('.treasury-dot').getBoundingClientRect();
    const rects = [...btn.querySelectorAll('.treasury-label, .treasury-amount')].map((el) => el.getBoundingClientRect());
    const lineH = parseFloat(getComputedStyle(amount).lineHeight) || 24;
    return { amountOneLine: amount.getClientRects().length === 1 && amount.getBoundingClientRect().height < lineH * 1.5, overlap: rects.some((r) => !(dot.right <= r.left || dot.left >= r.right || dot.bottom <= r.top || dot.top >= r.bottom)) };
  });
  check('主按钮金额不拆行、满额红点不压字', layout.amountOneLine && !layout.overlap, JSON.stringify(layout));
  await page.context().close();
  // 侯府上限 20：同样 15 日全额
  const big = await open(rtSave({ day: 11, homeLevel: 5, ownedPartnerIds: [], clockAt: Date.now() - 15 * HOUR - 60e3 }), { realtime: true, dayMs: 0 });
  await big.waitForTimeout(400);
  await dismissChoice(big);
  const b = await read(big);
  const inc5 = await dailyOf(big);
  check('侯府上限 20 日，15 日全额', b.treasury.gold === 15 * inc5 + 4 * inc5 + 5 * inc5 && /府库 15\/20 日/.test(await big.locator('.treasury-meter').innerText()), JSON.stringify({ t: b.treasury, inc5 }));
  await big.context().close();
});

await scenario('真实时间·48 日硬顶', async () => {
  const page = await open(rtSave({ day: 11, homeLevel: 2, ownedPartnerIds: [], clockAt: Date.now() - 100 * HOUR - 60e3 }), { realtime: true, dayMs: 0 });
  await page.waitForTimeout(400);
  const s = await read(page);
  const inc = 32;
  // 第 48 日以后不再积政务收入（只剩事件现钱）：比较离开 48 小时与 100 小时的政务部分
  const incomePart = 12 * inc + 36 * Math.round(inc * 0.5);
  check('离开 100 小时：日子照走，府库封顶 48 日', s.day === 111 && s.treasury.days === 48 && s.treasury.gold >= incomePart, JSON.stringify({ day: s.day, t: s.treasury }));
  const meter = await page.locator('.treasury-meter').innerText();
  check('48 日硬顶：进度条写积满 48 日、不再积存（不写减半）', meter.includes('府库积满 48 日') && meter.includes('不再积存') && !meter.includes('减半'), meter);
  await page.context().close();
  // 事件现钱同受 48 日硬顶：离开 60 小时与 240 小时，前 48 日完全相同，之后一文不进，府库金额应一致
  const short = await open(rtSave({ day: 11, homeLevel: 2, ownedPartnerIds: [], clockAt: Date.now() - 60 * HOUR - 60e3 }), { realtime: true, dayMs: 0 });
  await short.waitForTimeout(400);
  const a = await read(short);
  await short.context().close();
  const long = await open(rtSave({ day: 11, homeLevel: 2, ownedPartnerIds: [], clockAt: Date.now() - 240 * HOUR - 60e3 }), { realtime: true, dayMs: 0 });
  await long.waitForTimeout(400);
  const z = await read(long);
  check('满 48 日后乡望与折现事件也不再进府库', a.treasury.days === 48 && z.treasury.days === 48 && z.day === 251 && a.treasury.gold === z.treasury.gold && z.eventLog[0]?.detail.includes('已积满 48 日') && Number(z.eventLog[0].detail.match(/(\d+) 桩府中喜事/)?.[1] ?? 0) === Number(a.eventLog[0]?.detail.match(/(\d+) 桩府中喜事/)?.[1] ?? 0), JSON.stringify({ a: a.treasury, z: z.treasury, log: z.eventLog[0]?.detail }));
  await long.context().close();
});

await scenario('真实时间·军令按分钟回复', async () => {
  const now = Date.now();
  // 府邸前 20 分钟一道：离开 1 小时 + 30 秒回 3 道，顶栏写下一道约几分
  const early = await open(rtSave({ homeLevel: 2, orders: 0, orderClockAt: now - 60 * 60e3 - 30e3 }), { realtime: true, dayMs: 0 });
  await early.waitForTimeout(300);
  const e = await read(early);
  check('府邸前 20 分钟回 1 道', e.orders === 3 && /下一道约(19|20)分/.test(await early.locator('.home-hud__chips').innerText()), `orders=${e.orders} ${(await early.locator('.home-hud__chips').innerText()).replace(/\n/g, ' ')}`);
  await early.context().close();
  // 府邸起 120 分钟一道：离开 10 小时 + 1 分回 5 道
  const late = await open(rtSave({ homeLevel: 4, orders: 0, orderClockAt: now - 10 * HOUR - 60e3 }), { realtime: true, dayMs: 0 });
  await late.waitForTimeout(300);
  const l = await read(late);
  check('府邸起 120 分钟回 1 道', l.orders === 5 && /下一道约(9\d|1[01]\d|120)分/.test(await late.locator('.home-hud__chips').innerText()), `orders=${l.orders} ${(await late.locator('.home-hud__chips').innerText()).replace(/\n/g, ' ')}`);
  await late.context().close();
  // 上限 8：离开 30 小时只到 8；满额时从耗用那一刻起重新计时
  const full = await open(rtSave({ homeLevel: 4, orders: 0, gold: 20000, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'], orderClockAt: now - 30 * HOUR }), { realtime: true, dayMs: 0 });
  await full.waitForTimeout(300);
  check('军令上限 8', (await read(full)).orders === 8 && (await full.locator('.home-hud__chips').innerText()).includes('8/8'));
  await full.getByRole('button', { name: '出征', exact: true }).click();
  await full.getByRole('button', { name: /初级场/ }).click();
  check('出征页写军令 8/8', (await full.locator('.screen-header').first().innerText()).includes('军令 8/8'));
  await full.getByRole('button', { name: /^进入斗地主 · 耗 1 军令/ }).click();
  await full.getByText('斗地主牌局').first().waitFor();
  const spent = await read(full);
  check('满额耗 1 道后从当下起算', spent.orders === 7 && Math.abs(spent.orderClockAt - Date.now()) < 5000, `orders=${spent.orders} Δ=${spent.orderClockAt - Date.now()}`);
  await shiftClock(full, 2 * HOUR + 5e3);
  check('2 小时后回满 8 道', (await read(full)).orders === 8, `orders=${(await read(full)).orders}`);
  await full.context().close();
});

await scenario('真实时间·在线跨日弹心事', async () => {
  // 差 10 秒到第 5 日：tick 跨日后首页直接弹出甄姬心事
  const page = await open(rtSave({ day: 4, homeLevel: 2, ownedPartnerIds: ['zhenji'], clockAt: Date.now() - HOUR + 10e3 }), { realtime: true, dayMs: 0 });
  await page.waitForTimeout(300);
  check('跨日前没有心事', (await read(page)).pendingChoice === null && (await page.locator('[aria-label="伴侣心事"]').count()) === 0);
  await shiftClock(page, 20e3);
  const s = await read(page);
  check('在线跨日弹出心事卡', s.day === 5 && s.pendingChoice?.eventId === 'partner:zhenji' && (await page.locator('[aria-label="伴侣心事"]').isVisible()), JSON.stringify({ day: s.day, p: s.pendingChoice }));
  await page.context().close();
});

await scenario('真实时间·心事不被自动结算', async () => {
  // 甄姬心事待回应时离开 20 小时：心事留着，期间的商旅、门客、流民按现钱入府库
  const page = await open(rtSave({ day: 5, homeLevel: 2, ownedPartnerIds: ['zhenji', 'daqiao'], pendingChoice: { eventId: 'partner:zhenji', day: 5, dailyIncome: 32 }, clockAt: Date.now() - 20 * HOUR - 60e3 }), { realtime: true, dayMs: 0 });
  await page.waitForTimeout(400);
  const s = await read(page);
  check('心事永不自动结算', s.day === 25 && s.pendingChoice?.eventId === 'partner:zhenji' && Object.keys(s.resolvedPartnerEvents ?? {}).length === 0 && (await page.locator('[aria-label="伴侣心事"]').isVisible()), JSON.stringify({ day: s.day, p: s.pendingChoice, r: s.resolvedPartnerEvents }));
  check('同期二选一折现入府库并写进汇总', /\d+ 桩府中喜事折现入库/.test(s.eventLog[0]?.detail ?? '') && s.treasury.gold > 20 * 32, s.eventLog[0]?.detail);
  await page.context().close();
});

await scenario('真实时间·老存档迁移不双算', async () => {
  // 没有 clockVersion 的老存档离开 5.5 小时：按旧规则补 5 日、钱直接入账，写入 clockVersion
  const page = await open(save({ day: 11, homeLevel: 2, ownedPartnerIds: [], lastSavedAt: Date.now() - 5.5 * HOUR }), { realtime: true, dayMs: 0 });
  await page.waitForTimeout(500);
  const s = await read(page);
  check('老存档按旧规则补足并切到新口径', s.day === 16 && s.gold > 5000 && s.clockVersion === 1 && s.treasury.gold === 0 && s.treasury.days === 0 && s.eventLog[0]?.title === '离线经营' && Math.abs(s.clockAt - Date.now()) < 10000, JSON.stringify({ day: s.day, g: s.gold, v: s.clockVersion, t: s.treasury }));
  // 读档后立刻 tick：金额与日子不变
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(300);
  const t = await read(page);
  check('读档后立刻 tick 不重复结算', t.day === 16 && t.gold === s.gold && t.treasury.gold === 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const r = await read(page);
  check('再次读档不再补算', r.day === 16 && r.gold === s.gold && r.eventLog.filter((e) => e.title === '离线经营').length === 1, JSON.stringify({ day: r.day, g: r.gold }));
  await page.context().close();
});

await scenario('真实时间·时间回拨不推进', async () => {
  // 存档锚点在未来（系统时间调快后又调回）：读档保留未来锚点、不补算，等真实时间追上才继续走（复核修复：原先置为当下，可反复调钟刷府库）
  const future = await open(rtSave({ day: 11, homeLevel: 2, ownedPartnerIds: [], clockAt: Date.now() + 5 * HOUR, orderClockAt: Date.now() + 5 * HOUR, orders: 0 }), { realtime: true, dayMs: 0 });
  await future.waitForTimeout(300);
  const f = await read(future);
  check('未来锚点读档保留、不补算', f.day === 11 && f.treasury.days === 0 && f.clockAt > Date.now() + 4 * HOUR && f.orderClockAt > Date.now() + 4 * HOUR && f.orders === 0, JSON.stringify({ day: f.day, c: f.clockAt - Date.now() }));
  // 在线把时钟往回拨 3 小时：不推进；拨到比读档时晚 4 小时，仍早于锚点，不推进；拨到晚 7 小时 10 秒，只补锚点之后的 2 日
  await shiftClock(future, -3 * HOUR);
  check('时钟回拨不推进', (await read(future)).day === 11 && (await read(future)).treasury.days === 0);
  await shiftClock(future, 7 * HOUR);
  check('真实时间没追上锚点不推进', (await read(future)).day === 11 && (await read(future)).orders === 0);
  await shiftClock(future, 3 * HOUR + 10e3);
  const g = await read(future);
  check('追上锚点后只补锚点之后的日子与军令', g.day === 13 && g.treasury.days === 2 && g.orders === 6, JSON.stringify({ day: g.day, t: g.treasury, o: g.orders }));
  await future.context().close();
  // 离谱的未来锚点（> 240 小时）截到 240 小时，免得永远卡住
  const far = await open(rtSave({ day: 11, homeLevel: 2, ownedPartnerIds: [], clockAt: Date.now() + 1000 * HOUR }), { realtime: true, dayMs: 0 });
  await far.waitForTimeout(300);
  const fa = await read(far);
  check('超远未来锚点截到 240 小时内', fa.clockAt <= Date.now() + 240 * HOUR && fa.clockAt > Date.now() + 239 * HOUR, String((fa.clockAt - Date.now()) / HOUR));
  await far.context().close();
});

await scenario('真实时间·调钟刷府库不生效', async () => {
  // 「调快 12 小时→读档→调回→读档」重复两轮：只有第一轮算数（第一轮本来就是调快后的真实读数），第二轮起锚点在未来，不再补算
  const page = await open(rtSave({ day: 11, homeLevel: 2, ownedPartnerIds: [], orders: 0 }), { realtime: true, dayMs: 0 });
  await page.context().addInitScript(() => {
    const off = Number(localStorage.getItem('__test-shift') || 0);
    if (off) { const real = Date.now.bind(Date); Date.now = () => real() + off; }
  });
  const reloadAt = async (offset) => {
    await page.evaluate((o) => localStorage.setItem('__test-shift', String(o)), offset);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    return read(page);
  };
  const r1 = await reloadAt(12 * HOUR + 30e3);
  await reloadAt(0);
  const r2 = await reloadAt(12 * HOUR + 30e3);
  await reloadAt(0);
  const r3 = await reloadAt(12 * HOUR + 30e3);
  check('调快后读档推进一次', r1.day === 23 && r1.treasury.days === 12, JSON.stringify({ d: r1.day, t: r1.treasury }));
  check('调回再调快：不再重复推进府库与日子', r2.day === r1.day && r3.day === r1.day && r3.treasury.gold === r1.treasury.gold, JSON.stringify({ d2: r2.day, d3: r3.day, t3: r3.treasury }));
  await page.context().close();
});

await scenario('真实时间·后台多小时回来一次性结算', async () => {
  const page = await open(rtSave({ day: 11, homeLevel: 2, ownedPartnerIds: [] }), { realtime: true, dayMs: 0 });
  await page.waitForTimeout(300);
  // 后台被节流、一次 tick 都没跑：切回前台那一下按锚点一次补齐 7 日
  await shiftClock(page, 7 * HOUR + 30e3);
  const s = await read(page);
  check('后台 7 小时回来一次补 7 日、写汇总', s.day === 18 && s.treasury.days === 7 && s.eventLog[0]?.title === '离府归来' && s.eventLog[0].detail.includes('离开 7 小时'), JSON.stringify({ day: s.day, t: s.treasury, log: s.eventLog[0]?.detail }));
  await shiftClock(page, 0);
  check('同一段时间不会算两次', (await read(page)).day === 18 && (await read(page)).treasury.days === 7);
  await page.context().close();
});

await scenario('真实时间·切磋局', async () => {
  const page = await open(rtSave({ homeLevel: 4, gold: 20000, orders: 2, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'], battleWins: 3, battleLosses: 1 }), { realtime: true, dayMs: 0 });
  const s0 = await read(page);
  await page.getByRole('button', { name: '出征', exact: true }).click();
  const practice = page.getByRole('button', { name: /^切磋 · 不耗军令/ });
  check('出征页有切磋入口，写明不耗军令、不给缴获', (await practice.isVisible()) && (await practice.innerText()).includes('不给缴获、不计战绩'));
  await practice.click();
  await page.getByText('斗地主切磋').first().waitFor();
  const s1 = await read(page);
  check('切磋不耗军令、不记进行中的牌局', s1.orders === 2 && s1.activeBattle === null, JSON.stringify({ o: s1.orders, a: s1.activeBattle }));
  check('切磋局随行伴侣技能照常', await page.locator('.ddz-skillbar').isVisible().catch(() => false));
  await playOut(page);
  await page.waitForTimeout(400);
  const banner = await page.locator('.doudizhu-result-banner').innerText();
  const s2 = await read(page);
  check('切磋不给缴获、不计战绩', s2.gold === s0.gold && s2.battleWins === 3 && s2.battleLosses === 1 && s2.orders === 2 && /切磋得胜|再切磋一局/.test(banner) && !/输|败|亏/.test(banner), `${banner.replace(/\n/g, ' ')} g=${s2.gold - s0.gold}`);
  await page.getByRole('button', { name: /再切磋一局/ }).click();
  await page.getByText('斗地主切磋').first().waitFor();
  check('再切磋一局仍不耗军令', (await read(page)).orders === 2);
  await page.getByRole('button', { name: '离席' }).click();
  await page.locator('.home-actions__main').waitFor();
  check('切磋中途离席不扣金', (await read(page)).gold === s0.gold && (await read(page)).battleLosses === 1);
  await page.context().close();
});

await scenario('真实时间·多标签页同步', async () => {
  // A 页收取府库，B 页同步后府库为空，不能再收一次
  const a = await open(rtSave({ day: 11, homeLevel: 2, ownedPartnerIds: [], treasury: { gold: 640, days: 6 } }), { realtime: true, dayMs: 0 });
  const b = await a.context().newPage();
  await b.goto(URL, { waitUntil: 'domcontentloaded' });
  await b.locator('.home-actions__main').waitFor();
  check('两页都显示府库积存', (await b.locator('.home-actions__main').innerText()).includes('+640金'));
  await a.locator('.home-actions__main').click();
  await a.waitForTimeout(800);
  const bText = await b.locator('.home-actions__main').innerText();
  check('另一页同步后府库已空、按钮置灰', (await b.locator('.home-actions__main').isDisabled()) && !bText.includes('+640') && (await read(b)).gold === 5640, bText.replace(/\n/g, ' '));
  await a.context().close();
});

// ===== v3.1 止血 + 节奏 + 称号 =====
const SIX = { nanyang: 'farming', runan: 'farming', yingchuan: 'farming', changsha: 'farming', bajun: 'farming', liaodong: 'farming' };
async function openSuccession(page) {
  await page.getByRole('button', { name: '设置与存档' }).click();
  await page.getByText('当前存档').first().waitFor();
  return page.locator('.succession-panel').innerText();
}
async function doSucceed(page) {
  if (!(await page.getByRole('button', { name: '传位给下一代' }).isVisible().catch(() => false))) await openSuccession(page);
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '传位给下一代' }).click();
  await page.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  return read(page);
}

await scenario('v3.1·传位只换主公', async () => {
  const page = await open(save({ homeLevel: 6, gold: 2000000, farmLevel: 2, ownedPartnerIds: ['diaochan', 'zhenji'], equippedWeaponId: 'fangtian', ownedWeaponIds: ['xuanjian', 'fangtian'], fiefs: { nanyang: 'farming' }, battleWins: 12, frontierWins: 1, claimedQuestIds: ['farm-first', 'fief-first', 'first-win'] }));
  const panel = await openSuccession(page);
  // 200 万从 0 点起：前 8 点 5+10+…+40 = 180 万，第 9 点要 45 万 → 只得 8 点
  check('200 万从 0 点起只得 8 点（面板写花费与余金）', panel.includes('可得 8 点') && panel.includes('花 1,800,000 金、余 200,000 金') && panel.includes('再下一点要 450,000 金'), panel.replace(/\n/g, ' '));
  const mid = await doSucceed(page);
  check('传位后宅邸、屯田、封地、伴侣、兵器、任务、战绩都在', mid.homeLevel === 6 && mid.farmLevel === 2 && mid.fiefs.nanyang === 'farming' && mid.ownedPartnerIds.length === 2 && mid.equippedWeaponId === 'fangtian' && mid.battleWins === 12 && mid.frontierWins === 1 && mid.claimedQuestIds.includes('first-win'), JSON.stringify({ h: mid.homeLevel, f: mid.fiefs, p: mid.ownedPartnerIds, w: mid.battleWins }));
  check('传位按递增价实扣 180 万、家业点 8、家谱记存金', mid.gold === 200000 && mid.legacyPoints === 8 && mid.generation === 2 && mid.chronicle.at(-1)?.gold === 2000000 && mid.chronicle.at(-1)?.wins === 12, JSON.stringify({ g: mid.gold, lp: mid.legacyPoints, c: mid.chronicle.at(-1) }));
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  const s = await read(page);
  check('择主后直接回主城、第 2 代、本代起点记下', s.selectedLordId && s.generation === 2 && s.genStart?.wins === 12 && (await page.locator('.home-hud').innerText()).includes('第 2 代') && (await page.locator('.home-banner h2').innerText()).includes('王城'), JSON.stringify(s.genStart));
  await page.context().close();
});

await scenario('v3.1·家业点递增价', async () => {
  // 已有 5 点、50 万：第 6 点 30 万，第 7 点 35 万扣不起 → 1 点；面板价与实扣一致
  const page = await open(save({ homeLevel: 6, gold: 500000, legacyPoints: 5, generation: 2 }));
  const panel = await openSuccession(page);
  check('已有 5 点时从第 6 点（30 万）起价', panel.includes('可得 1 点') && panel.includes('花 300,000 金、余 200,000 金') && panel.includes('再下一点要 350,000 金'), panel.replace(/\n/g, ' '));
  const s = await doSucceed(page);
  check('实扣与面板一致', s.legacyPoints === 6 && s.gold === 200000, JSON.stringify({ lp: s.legacyPoints, g: s.gold }));
  await page.context().close();
  // 富国家风八折：4 万 + 8 万 = 12 万得 2 点，第 3 点 12 万扣不起
  const two = [{ generation: 1, lordId: 'lvbu', days: 40, gold: 250000, wins: 31, fiefs: 0, ambition: 'wealth', ambitionDone: true }, { generation: 2, lordId: 'caocao', days: 36, gold: 620000, wins: 28, fiefs: 1, ambition: 'wealth', ambitionDone: true }];
  const wealth = await open(save({ generation: 3, homeLevel: 6, gold: 160000, chronicle: two }));
  const wp = await openSuccession(wealth);
  check('富国家风八折：面板写八折与实价', wp.includes('富国家风八折') && wp.includes('可得 2 点') && wp.includes('花 120,000 金'), wp.replace(/\n/g, ' '));
  const ws = await doSucceed(wealth);
  check('富国家风实扣 12 万', ws.legacyPoints === 2 && ws.gold === 40000, JSON.stringify({ lp: ws.legacyPoints, g: ws.gold }));
  await wealth.context().close();
});

await scenario('v3.1·折不到 1 点也可传位', async () => {
  const page = await open(save({ homeLevel: 6, gold: 30000, legacyPoints: 0 }));
  const panel = await openSuccession(page);
  check('3 万金：面板写只换主公、按钮可点', panel.includes('只换主公、不加点') && (await page.getByRole('button', { name: '传位给下一代' }).isEnabled()), panel.replace(/\n/g, ' '));
  const s = await doSucceed(page);
  check('只换主公：家业点 0、金不动、第 2 代', s.legacyPoints === 0 && s.gold === 30000 && s.generation === 2 && s.selectedLordId === null);
  await page.context().close();
});

await scenario('v3.1·统一条件六郡加王城', async () => {
  // 六郡 + 侯府：提示升王城即天下归心；升上去即出统一卡（家业点 0、第一代）
  const page = await open(save({ homeLevel: 5, gold: 400000, legacyPoints: 0, generation: 1, fiefs: SIX, fiefTakenAt: allTaken(Date.now() - 200 * HR) }));
  check('六郡 + 侯府提示升王城即统一', (await page.locator('.chance-bar').textContent()).includes('宅邸升至王城即天下归心'));
  await page.getByRole('button', { name: /升级宅邸/ }).click();
  await page.waitForTimeout(3000);
  check('升王城即出统一卡', (await page.locator('.ending-hint').innerText().catch(() => '')).includes('天下归心') && (await read(page)).earnedTitles.includes('unifier'));
  await page.context().close();
});

await scenario('v3.1·志向不隐藏与家业点奖励', async () => {
  // 家业点满 20：志向卡照常；达成后传位改发 3 万金
  const full = await open(save({ generation: 2, homeLevel: 6, legacyPoints: 20, gold: 600000, ambition: { id: 'wealth', target: 500000, baseFiefs: 0 } }));
  const s = await doSucceed(full);
  check('家业点满时志向奖励改发 3 万金', s.legacyPoints === 20 && s.gold === 630000 && s.chronicle.at(-1)?.ambitionDone === true, JSON.stringify({ lp: s.legacyPoints, g: s.gold }));
  await full.context().close();
  // 家学渊源（三代志向达成）：奖励 2 点；第 4 代富国目标 100 万，从第 3 点起折 4 点花 90 万，再 +2
  const chron = [['wealth', 'lvbu'], ['might', 'caocao'], ['wealth', 'liubei']].map(([ambition, lordId], i) => ({ generation: i + 1, lordId, days: 30, gold: 0, wins: 10, fiefs: 0, ambition, ambitionDone: true }));
  const sch = await open(save({ generation: 4, homeLevel: 6, legacyPoints: 2, gold: 1000000, chronicle: chron, ambition: { id: 'wealth', target: 1000000, baseFiefs: 0 } }));
  await sch.getByRole('button', { name: '主公' }).click();
  check('家学渊源已得并写明效果', /「家学渊源」\s*已获得 · 志向达成得 2 点家业点/.test(await sch.getByRole('dialog', { name: '主公' }).innerText()));
  await sch.getByRole('button', { name: '关闭' }).click();
  const t = await doSucceed(sch);
  check('家学渊源：志向达成得 2 点', t.legacyPoints === 8 && t.gold === 100000, JSON.stringify({ lp: t.legacyPoints, g: t.gold }));
  await sch.context().close();
  // 旧版「稍后再定」写在 sessionStorage：读档时清掉，志向卡重新出现
  const later = await open(save({ generation: 2, legacyPoints: 20 }));
  await later.evaluate(() => sessionStorage.setItem('jiaye-ambition-deferred', '2'));
  await later.reload({ waitUntil: 'domcontentloaded' });
  await later.locator('.home-v2').waitFor();
  check('旧 sessionStorage 推迟记录读到即清、志向卡仍在', (await later.evaluate(() => sessionStorage.getItem('jiaye-ambition-deferred'))) === null && (await later.locator('.ambition-card').isVisible()));
  await later.context().close();
});

await scenario('v3.1·造价曲线', async () => {
  // 老存档（没有 paceCurve）：沿用旧价，王城 18 万
  const old = await open(save({ homeLevel: 5, gold: 1000 }));
  check('老存档 paceCurve 缺省为 v2、王城 180,000', (await read(old)).paceCurve === 'v2' && (await old.getByRole('button', { name: /升级宅邸/ }).innerText()).includes('180,000'));
  await old.context().close();
  // 新开档：v3
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('jiaye-clock-manual', '1'); localStorage.setItem('jiaye-affair-quick', '1'); } catch { /* ignore */ } });
  const fresh = await ctx.newPage();
  await fresh.goto(URL, { waitUntil: 'domcontentloaded' });
  await fresh.getByRole('button', { name: '开始游戏' }).click();
  await fresh.getByRole('button', { name: '确认选择' }).click();
  await fresh.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await fresh.getByRole('button', { name: '携美人，共创家业' }).click();
  await fresh.locator('.home-v2').waitFor();
  check('新开档写 v3 曲线与 schema 3', (await read(fresh)).paceCurve === 'v3' && (await read(fresh)).schema === 3);
  await ctx.close();
  // v3 存档：王城 36 万，首郡南阳押 33 万（15 万 × 2.2）× 50% × 侯门显贵 0.95 = 156,750
  const v3 = await open(save({ schema: 3, paceCurve: 'v3', homeLevel: 5, gold: 200000, orders: 3 }));
  check('v3 王城 360,000、首郡押 156,750', (await v3.getByRole('button', { name: /升级宅邸/ }).innerText()).includes('360,000') && (await v3.locator('.chance-bar').textContent()).includes('押 156,750 金'));
  await v3.context().close();
});

await scenario('v3.1·v3 造价各处一致', async () => {
  const now = Date.now();
  const page = await open(save({ schema: 3, paceCurve: 'v3', homeLevel: 5, gold: 2000000, orders: 3, fiefs: { nanyang: 'farming', changsha: 'farming' }, fiefTakenAt: { nanyang: now - 200 * HR, changsha: now - 200 * HR }, fiefWalls: { nanyang: 1, changsha: 2 }, lostFiefs: { runan: now - HR }, nextSiegeAt: now + 40 * HR, siege: { fiefId: 'nanyang', attacker: '张绣', skill: 'novice', startedAt: now - HR, dueAt: now + 20 * HR } }));
  // 机会栏：下一郡是失守的汝南（收复期内）：55 万 × 25% × 0.95 = 130,625
  check('机会栏收复押金按 v3', (await page.locator('.chance-bar').textContent()).includes('押 130,625 金'), (await page.locator('.chance-bar').textContent()).replace(/\n/g, ' ').slice(0, 200));
  await page.getByRole('button', { name: '去守城 →' }).click();
  await page.locator('.conquest-panel').waitFor();
  const besieged = await page.locator('.conquest-panel').innerText();
  check('守城犒赏 3,300（33 万 × 1%）、修城 16,500（× 5%）', besieged.includes('守住犒赏 3,300 金') && besieged.includes('修城 · 16,500 金'), besieged.replace(/\n/g, ' '));
  const g0 = (await read(page)).gold;
  await page.getByRole('button', { name: '修城 · 16,500 金' }).click();
  await page.waitForTimeout(300);
  check('修城实扣 16,500、城防回满', (await read(page)).gold === g0 - 16500 && (await read(page)).fiefWalls.nanyang === 2);
  await page.locator('.conquest-map g.conquest-node').filter({ hasText: '长沙' }).click({ force: true });
  check('改方略 154,000（154 万 × 10%）', await page.getByRole('button', { name: '改行整军 · 154,000 金' }).isVisible());
  const g1 = (await read(page)).gold;
  await page.getByRole('button', { name: '改行整军 · 154,000 金' }).click();
  await page.waitForTimeout(300);
  check('改方略实扣 154,000', (await read(page)).gold === g1 - 154000 && (await read(page)).fiefs.changsha === 'military');
  await page.locator('.conquest-map g.conquest-node').filter({ hasText: '巴' }).click({ force: true });
  check('攻郡押金 1,149,500（242 万 × 50% × 0.95）', await page.getByRole('button', { name: '出兵攻取巴郡 · 耗 1 军令 · 押 1,149,500 金' }).isVisible());
  await page.locator('.conquest-map g.conquest-node').filter({ hasText: '汝南' }).click({ force: true });
  const g2 = (await read(page)).gold;
  await page.getByRole('button', { name: '收复汝南郡 · 耗 1 军令 · 押 130,625 金' }).click();
  await page.getByText('攻取汝南郡').first().waitFor();
  check('收复实扣 130,625（reducer 按同一价校验）', (await read(page)).gold === g2 - 130625 && (await read(page)).activeBattle?.conquest?.kind === 'reclaim');
  await page.context().close();
});

await scenario('v3.1·称号效果', async () => {
  const venueOf = async (page) => { await page.getByRole('button', { name: '出征', exact: true }).click(); await page.getByRole('button', { name: /初级场/ }).click(); return page.locator('.venue-summary').first().innerText(); };
  const goldOf = (t) => Number(t.match(/胜缴获 ([\d,]+) 金/)?.[1].replace(/,/g, '') ?? NaN);
  // 白身：无匾无旗
  const plain = await open(save({ homeLevel: 2 }));
  check('白身：不挂匾、收入明细无称号项', (await plain.locator('.home-honors').count()) === 0 && !(await plain.locator('.home-banner__detail p').textContent()).includes('称号'));
  await plain.context().close();
  // 乡绅：政务收入 +3%（与劝农同一加法项）
  const gentry = await open(save({ homeLevel: 3 }));
  check('乡绅：收入明细写称号 +3%', (await gentry.locator('.home-banner__detail p').textContent()).includes('称号 +3%'));
  await gentry.context().close();
  // 侯门显贵：南阳押 75,000 × 0.95 = 71,250
  const marquis = await open(save({ homeLevel: 5, gold: 100000, orders: 3 }));
  await marquis.getByRole('button', { name: '出征', exact: true }).click();
  await marquis.locator('.conquest-map g.conquest-node').filter({ hasText: '南阳' }).click({ force: true });
  check('侯门显贵：攻郡押金 −5%', await marquis.getByRole('button', { name: '出兵攻取南阳郡 · 耗 1 军令 · 押 71,250 金' }).isVisible());
  await marquis.context().close();
  // 百战之将：20 胜起斗地主缴获 +5%
  const p19 = await open(save({ homeLevel: 4, battleWins: 19 }));
  const g19 = goldOf(await venueOf(p19));
  await p19.context().close();
  const p20 = await open(save({ homeLevel: 4, battleWins: 20 }));
  const t20 = await venueOf(p20);
  check('百战之将：斗地主缴获 +5% 并写明', Math.abs(goldOf(t20) - g19 * 1.05) <= 1 && t20.includes('百战之将 +5%'), `${g19} → ${goldOf(t20)}`);
  await p20.context().close();
  // 金汤之将：修城八折（汝南 12,500 → 10,000）
  const north = await open(save({ homeLevel: 5, gold: 50000, frontierWins: 3, fiefs: { nanyang: 'farming', runan: 'farming' }, fiefTakenAt: { nanyang: Date.now() - 200 * HR, runan: Date.now() - 200 * HR }, fiefWalls: { nanyang: 2, runan: 1 }, nextSiegeAt: Date.now() + 40 * HR }));
  await north.getByRole('button', { name: '去修城 →' }).click();
  check('金汤之将：修城八折', await north.getByRole('button', { name: '修城 · 10,000 金' }).isVisible());
  await north.context().close();
  // 一代枭雄：王城 + 30 胜军令上限 +1
  const h29 = await open(save({ homeLevel: 6, battleWins: 29 }));
  const cap29 = await h29.locator('.home-hud__orders strong').innerText();
  await h29.context().close();
  const h30 = await open(save({ homeLevel: 6, battleWins: 30 }));
  check('一代枭雄：军令上限 8 → 9', cap29.endsWith('/8') && (await h30.locator('.home-hud__orders strong').innerText()).endsWith('/9'), cap29);
  await h30.context().close();
  // 天下归心：每朝开局军令满（国号魏上限 9）
  const uni = await open(save({ screen: 'title', lastScreen: 'title', selectedLordId: null, generation: 1, ownedPartnerIds: [], realm: 'wei', realms: { wei: 1, shu: 0, wu: 0 }, pastDynasties: [{ dynasty: 1, realm: null, generations: 2, days: 60, wins: 40, ambitions: 0 }], earnedTitles: ['unifier'] }));
  await uni.getByRole('button', { name: '继续家业' }).click();
  await uni.getByRole('button', { name: '确认选择' }).click();
  await uni.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await uni.getByRole('button', { name: '携美人，共创家业' }).click();
  await uni.locator('.home-v2').waitFor();
  check('天下归心：新朝开局军令满', (await read(uni)).orders === 9, `orders=${(await read(uni)).orders}`);
  await uni.context().close();
  // 再造山河：收复押金减半（汝南 250,000 × 12.5% × 0.95 = 29,688）
  const rest = await open(save({ homeLevel: 5, gold: 100000, orders: 3, pastDynasties: [{ dynasty: 1, realm: null, generations: 2, days: 60, wins: 40, ambitions: 0 }], fiefs: { nanyang: 'farming' }, fiefTakenAt: { nanyang: Date.now() - 200 * HR }, lostFiefs: { runan: Date.now() - HR }, nextSiegeAt: Date.now() + 40 * HR }));
  await rest.getByRole('button', { name: '去收复 →' }).click();
  await rest.locator('.conquest-panel').waitFor();
  check('再造山河：收复押金减半', (await rest.locator('.conquest-panel').innerText()).includes('只押开拓价 12.5%') && await rest.getByRole('button', { name: '收复汝南郡 · 耗 1 军令 · 押 29,688 金' }).isVisible());
  await rest.context().close();
  // 三朝元老：本朝首次反攻（逾期）城防不扣；没有这个家声的对照扣到 1
  const siegeOver = (extra) => save({ homeLevel: 5, fiefs: { nanyang: 'farming' }, fiefTakenAt: { nanyang: Date.now() - 200 * HR }, fiefWalls: { nanyang: 2 }, nextSiegeAt: Date.now() + 40 * HR, siege: { fiefId: 'nanyang', attacker: '张绣', skill: 'novice', startedAt: Date.now() - 30 * HR, dueAt: Date.now() - 6 * HR }, ...extra });
  const elder = await open(siegeOver({ pastDynasties: [1, 2].map((d) => ({ dynasty: d, realm: null, generations: 1, days: 30, wins: 10, ambitions: 0 })) }));
  await elder.waitForTimeout(300);
  const e = await read(elder);
  check('三朝元老：首次反攻城池必保', e.fiefWalls.nanyang === 2 && e.firstSiegeDone === true && e.siege === null && e.eventLog.some((ev) => ev.title.includes('城池必保')), JSON.stringify({ w: e.fiefWalls, f: e.firstSiegeDone }));
  await elder.context().close();
  const noElder = await open(siegeOver({}));
  await noElder.waitForTimeout(300);
  check('无三朝元老：逾期城防扣到 1', (await read(noElder)).fiefWalls.nanyang === 1);
  await noElder.context().close();
  const elder2 = await open(siegeOver({ firstSiegeDone: true, pastDynasties: [1, 2].map((d) => ({ dynasty: d, realm: null, generations: 1, days: 30, wins: 10, ambitions: 0 })) }));
  await elder2.waitForTimeout(300);
  check('三朝元老只保本朝第一次', (await read(elder2)).fiefWalls.nanyang === 1);
  await elder2.context().close();
  // 三分归一：改方略费减半（南阳 15,000 → 7,500）
  const three = await open(save({ homeLevel: 5, gold: 50000, realm: 'wu', realms: { wei: 1, shu: 1, wu: 1 }, pastDynasties: [{ dynasty: 1, realm: null, generations: 1, days: 30, wins: 10, ambitions: 0 }, { dynasty: 2, realm: 'wei', generations: 1, days: 30, wins: 10, ambitions: 0 }, { dynasty: 3, realm: 'shu', generations: 1, days: 30, wins: 10, ambitions: 0 }], fiefs: { nanyang: 'farming' }, fiefTakenAt: { nanyang: Date.now() - 200 * HR }, nextSiegeAt: Date.now() + 40 * HR }));
  await three.getByRole('button', { name: '出征', exact: true }).click();
  await three.locator('.conquest-map g.conquest-node').filter({ hasText: '南阳' }).click({ force: true });
  check('三分归一：改方略费减半', await three.getByRole('button', { name: '改行整军 · 7,500 金' }).isVisible());
  await three.context().close();
});

await scenario('v3.1·主城匾旗', async () => {
  const gentry = await open(save({ homeLevel: 3 }));
  const plaque = gentry.getByRole('button', { name: /匾额「耕读传家」/ });
  check('砖瓦宅挂木匾「耕读传家」', await plaque.isVisible());
  await plaque.click();
  check('点匾弹层写明效果', (await gentry.locator('.home-honors__pop').innerText()).includes('乡绅：政务收入 +3%'));
  await gentry.context().close();
  // 王城 + 31 胜 + 守城 3 + 三朝 + 家声若干：王匾、左旗 3 面、右上国号大纛（吴 · 第 3 朝）与家声旗
  const past = [{ dynasty: 1, realm: null, generations: 1, days: 30, wins: 10, ambitions: 0 }, { dynasty: 2, realm: 'wei', generations: 1, days: 30, wins: 10, ambitions: 0 }];
  const grand = await open(save({ homeLevel: 6, battleWins: 31, frontierWins: 3, realm: 'wu', realms: { wei: 1, shu: 0, wu: 1 }, pastDynasties: past, earnedTitles: ['unifier', 'eternal'], fiefs: { nanyang: 'farming' }, fiefTakenAt: { nanyang: Date.now() - 200 * HR }, nextSiegeAt: Date.now() + 40 * HR }));
  check('王匾、三面左旗、国号大纛、家声旗', (await grand.getByRole('button', { name: /匾额「王」/ }).isVisible()) && (await grand.locator('.home-honors__left .home-honors__flag').count()) === 3 && (await grand.getByRole('button', { name: '国号大纛 · 吴 · 第 3 朝' }).isVisible()) && (await grand.locator('.home-honors__lineage .home-honors__flag').count()) === 2);
  await grand.getByRole('button', { name: /国号大纛/ }).click();
  check('点大纛写明天下归心效果', (await grand.locator('.home-honors__pop').innerText()).includes('天下归心：每朝开局军令满'));
  // 主公页固定挂旧誉纪念匾
  await grand.getByRole('button', { name: '主公' }).click();
  await grand.getByRole('dialog', { name: '主公' }).getByRole('radio', { name: /千秋家业/ }).click();
  await grand.getByRole('button', { name: '关闭' }).click();
  check('主公页可改挂纪念匾「千秋家业」', (await read(grand)).plaque === 'eternal' && (await grand.getByRole('button', { name: /匾额「千秋家业」/ }).isVisible()));
  // 疆域图：本府挂国号小旗、金汤描金边
  await grand.getByRole('button', { name: '出征', exact: true }).click();
  check('疆域图本府挂国号吴小旗并描金边', ((await grand.locator('.conquest-node.is-home').getAttribute('aria-label')) ?? '').includes('国号吴 · 金汤'));
  await grand.context().close();
  // 横屏也能看到匾
  const land = await open(save({ homeLevel: 5 }), { viewport: { width: 844, height: 390 } });
  const box = await land.getByRole('button', { name: /匾额「侯门」/ }).boundingBox();
  check('横屏匾额在视口内', box !== null && box.y >= 0 && box.y + box.height <= 390, JSON.stringify(box));
  await land.context().close();
});

await scenario('v3.1·旧誉白名单', async () => {
  const page = await open(save({ earnedTitles: ['founder', 'eternal', 'tradition', 'court-star', 'bogus', 'unifier'] }));
  const s = await read(page);
  check('退役家声读档保留、退役本朝称号与乱码剔除', ['founder', 'eternal', 'tradition', 'unifier'].every((id) => s.earnedTitles.includes(id)) && !s.earnedTitles.includes('court-star') && !s.earnedTitles.includes('bogus'), JSON.stringify(s.earnedTitles));
  await page.getByRole('button', { name: '主公' }).click();
  const text = await page.getByRole('dialog', { name: '主公' }).innerText();
  check('主公页单列旧誉、灰字无效果', text.includes('旧誉') && text.includes('「家风传世」') && text.includes('没有效果'), text.slice(text.indexOf('旧誉'), text.indexOf('旧誉') + 80));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.home-v2').waitFor();
  check('再读档旧誉仍在', (await read(page)).earnedTitles.includes('founder'));
  await page.context().close();
});

await scenario('v3.1·schema 3 迁移', async () => {
  // 老存档：家业点 25（脏）、第 2 代 → 截到 20、paceCurve v2、写一条「家业新制」；再读档不重复
  const page = await open(save({ generation: 2, legacyPoints: 25, homeLevel: 5 }));
  await page.waitForTimeout(300);
  let s = await read(page);
  const count = (st) => st.eventLog.filter((ev) => ev.title === '家业新制').length;
  check('迁移：schema 3、paceCurve v2、家业点截到 20、纪事一条', s.schema === 3 && s.paceCurve === 'v2' && s.legacyPoints === 20 && count(s) === 1 && s.genStart?.day === 1, JSON.stringify({ sc: s.schema, p: s.paceCurve, lp: s.legacyPoints, n: count(s) }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.home-v2').waitFor();
  await page.waitForTimeout(300);
  s = await read(page);
  check('迁移幂等：再读档不再写纪事、字段不变', s.schema === 3 && s.paceCurve === 'v2' && count(s) === 1 && s.legacyPoints === 20);
  await page.context().close();
  // 老档「六郡 + 王城、12 点」：读档即统一并补记天下归心，家业点不动
  const unify = await open(save({ generation: 2, legacyPoints: 12, homeLevel: 6, fiefs: SIX, fiefTakenAt: allTaken(Date.now() - 200 * HR) }));
  const u = await read(unify);
  check('老档六郡 + 王城读档即统一、家业点不动', u.earnedTitles.includes('unifier') && u.legacyPoints === 12 && (await unify.locator('.ending-hint').isVisible()));
  await unify.context().close();
  // 老档第二代、20 点、缺两郡：点数、旧价都在，志向卡恢复
  const mid = await open(save({ generation: 2, legacyPoints: 20, homeLevel: 5, gold: 1000, fiefs: { nanyang: 'farming', runan: 'farming', yingchuan: 'farming', changsha: 'farming' }, fiefTakenAt: allTaken(Date.now() - 200 * HR), earnedTitles: ['founder', 'eternal'] }));
  const m = await read(mid);
  check('老档 20 点缺两郡：点数家声旧价都在、志向卡恢复', m.legacyPoints === 20 && m.paceCurve === 'v2' && m.earnedTitles.includes('eternal') && (await mid.getByRole('button', { name: /升级宅邸/ }).innerText()).includes('180,000') && (await mid.locator('.ambition-card').isVisible()));
  await mid.context().close();
  // 新档字段原样保留
  const v3 = await open(save({ schema: 3, paceCurve: 'v3', genStart: { day: 5, wins: 3, defends: 0 }, day: 11, battleWins: 4, plaque: 'gentry', homeLevel: 3 }));
  const n = await read(v3);
  check('schema 3 存档字段原样保留、不写迁移纪事', n.paceCurve === 'v3' && n.genStart?.day === 5 && n.genStart?.wins === 3 && n.plaque === 'gentry' && count(n) === 0, JSON.stringify({ p: n.paceCurve, g: n.genStart }));
  await v3.context().close();
});

await scenario('复核·志向点不走金价', async () => {
  // 19 点、100 万、富国达成：志向那 1 点补满 20，金子一文不动（旧实现先拿 100 万买第 20 点、志向改发 3 万金）
  const a = await open(save({ generation: 2, homeLevel: 6, legacyPoints: 19, gold: 1000000, ambition: { id: 'wealth', target: 500000, baseFiefs: 0 } }));
  check('19 点：机会栏写再得 1 点', (await a.locator('.chance-bar').textContent()).includes('志向已达成，再得 1 点'), (await a.locator('.chance-bar').textContent()).replace(/\n/g, ' ').slice(0, 200));
  const pa = await openSuccession(a);
  check('19 点：面板写得 1 点家业点、志向之赏补满', pa.includes('得 1 点家业点') && !pa.includes('30,000 金') && pa.includes('志向之赏记上后家业点即满 20 点'), pa.replace(/\n/g, ' '));
  const sa = await doSucceed(a);
  check('19 点：传位后 20 点、100 万金原样留下', sa.legacyPoints === 20 && sa.gold === 1000000, JSON.stringify({ lp: sa.legacyPoints, g: sa.gold, log: sa.eventLog[0]?.detail }));
  await a.context().close();
  // 18 点、195 万：金子只折到第 19 点（95 万），志向补第 20 点 → 20 点、余 100 万
  const b = await open(save({ generation: 2, homeLevel: 6, legacyPoints: 18, gold: 1950000, ambition: { id: 'wealth', target: 500000, baseFiefs: 0 } }));
  const pb = await openSuccession(b);
  check('18 点：面板写折 1 点花 95 万余 100 万、志向得 1 点', pb.includes('可得 1 点') && pb.includes('花 950,000 金、余 1,000,000 金') && pb.includes('累计 20 点') && pb.includes('得 1 点家业点'), pb.replace(/\n/g, ' '));
  const sb = await doSucceed(b);
  check('18 点：实扣与面板一致（20 点、余 100 万）', sb.legacyPoints === 20 && sb.gold === 1000000, JSON.stringify({ lp: sb.legacyPoints, g: sb.gold }));
  await b.context().close();
  // 20 点已满：照旧改发 3 万金，面板写 3 万金
  const c = await open(save({ generation: 2, homeLevel: 6, legacyPoints: 20, gold: 600000, ambition: { id: 'wealth', target: 500000, baseFiefs: 0 } }));
  const pc = await openSuccession(c);
  check('20 点已满：面板写 30,000 金（家业点已满）', pc.includes('30,000 金（家业点已满）'), pc.replace(/\n/g, ' '));
  await c.context().close();
});

await scenario('复核·传位不重置本朝最高郡数', async () => {
  // 王城、只剩南阳、汝南 1 小时前失守（收复期内）、本朝最高 2 郡：传位后新主定开疆，收复汝南不算新开拓
  const now = Date.now();
  const page = await open(save({ schema: 3, paceCurve: 'v3', generation: 3, homeLevel: 6, gold: 20000, fiefs: { nanyang: 'farming' }, fiefTakenAt: { nanyang: now - 200 * HR }, peakFiefs: 2, lostFiefs: { runan: now - HR }, nextSiegeAt: now + 40 * HR }));
  const s = await doSucceed(page);
  check('传位后本朝最高郡数仍是 2、失郡记录还在', s.peakFiefs === 2 && typeof s.lostFiefs?.runan === 'number', JSON.stringify({ p: s.peakFiefs, l: s.lostFiefs }));
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.locator('.ambition-options button').filter({ hasText: '开疆' }).click();
  await page.waitForTimeout(300);
  const t = await read(page);
  check('新主定开疆：基数按本朝最高 2 郡', t.ambition?.id === 'expansion' && t.ambition?.baseFiefs === 2, JSON.stringify(t.ambition));
  // 模拟收复汝南（resolveConquest 胜：汝南回到封地）后读档：开疆仍未达成
  await page.evaluate(([k]) => { const st = JSON.parse(localStorage.getItem(k)); st.fiefs.runan = 'farming'; delete st.lostFiefs.runan; localStorage.setItem(k, JSON.stringify(st)); }, [KEY]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.home-v2').waitFor();
  await openGoals(page);
  const prog = await page.locator('.ambition-progress').innerText();
  check('收复上一代丢的郡不算开疆', prog.includes('0/1') || prog.includes('现 0'), prog.replace(/\n/g, ' '));
  await page.context().close();
});

await scenario('复核·新规矩开新朝不补旧誉', async () => {
  // v3 档、第一代、0 点、六郡 + 王城即统一；开新朝后再读档，不应凭空多出开国元勋/千秋家业等旧誉
  const page = await open(save({ schema: 3, paceCurve: 'v3', homeLevel: 6, legacyPoints: 0, generation: 1, gold: 50000, fiefs: SIX, fiefTakenAt: allTaken(Date.now() - 200 * HR) }));
  await page.getByRole('button', { name: '展开卷轴 →' }).click();
  await page.getByRole('radio', { name: /蜀/ }).click();
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /开创新朝 · 国号蜀/ }).click();
  await page.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  const s = await read(page);
  const retired = ['founder', 'eternal', 'marquis', 'six-commanderies'];
  check('开新朝后读档：家声留天下归心、无旧誉', s.earnedTitles.includes('unifier') && retired.every((id) => !s.earnedTitles.includes(id)) && s.pastDynasties.length === 1, JSON.stringify(s.earnedTitles));
  await page.context().close();
  // 老档（无 schema）有前朝：照旧补记当年终局必得的家声（旧誉）
  const old = await open(save({ pastDynasties: [{ dynasty: 1, realm: null, generations: 3, days: 90, wins: 60, ambitions: 1 }], realms: { wei: 0, shu: 1, wu: 0 }, realm: 'shu' }));
  const o = await read(old);
  check('老档有前朝仍补记旧誉', retired.every((id) => o.earnedTitles.includes(id)), JSON.stringify(o.earnedTitles));
  await old.context().close();
});

await scenario('复核·旧版标签页与新存档隔离', async () => {
  const OLD_KEY = 'jiaye-tianxia-save-v1';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('jiaye-clock-manual', '1'); localStorage.setItem('jiaye-affair-quick', '1'); } catch { /* ignore */ } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  // 升级后第一次打开：只有旧 key 的老档 → 读入、迁移一次、写到新 key，旧 key 原样留作备份
  await page.evaluate(([nk, ok, st]) => { localStorage.removeItem(nk); localStorage.setItem(ok, JSON.stringify(st)); }, [KEY, OLD_KEY, save({ generation: 2, legacyPoints: 4, homeLevel: 5, battleWins: 7 })]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.home-v2').waitFor();
  await page.waitForTimeout(400);
  const count = (st) => st.eventLog.filter((ev) => ev.title === '家业新制').length;
  let s = await read(page);
  const oldRaw = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), OLD_KEY);
  check('旧 key 老档读入：新 key 写 schema 3、v2 价、迁移纪事一条，旧 key 未动', s?.schema === 3 && s.paceCurve === 'v2' && s.legacyPoints === 4 && count(s) === 1 && oldRaw.schema === undefined && oldRaw.battleWins === 7, JSON.stringify({ sc: s?.schema, p: s?.paceCurve, n: s && count(s) }));
  await page.context().close();

  // 新玩家（v3）开着页面时，旧版标签页往旧 key 写去掉新字段的存档：新标签页不受影响、不来回覆盖、不刷迁移纪事
  const fresh = await open(save({ schema: 3, paceCurve: 'v3', genStart: { day: 1, wins: 0, defends: 0 }, homeLevel: 3, battleWins: 2 }));
  const before = await read(fresh);
  const other = await fresh.context().newPage();
  await other.goto(URL, { waitUntil: 'domcontentloaded' });
  await other.locator('.home-v2').waitFor();
  // 另一个新版标签页数新 key 被写了几次：旧 key 来回写不该牵动新 key（旧实现同 key 下每 2 秒约 650 次）
  await other.evaluate((k) => { window.__newKeyWrites = 0; window.addEventListener('storage', (e) => { if (e.key === k) window.__newKeyWrites += 1; }); }, KEY);
  const stripped = { ...before, schema: undefined, paceCurve: undefined, genStart: undefined };
  await fresh.evaluate(async ([ok, st]) => {
    for (let i = 0; i < 5; i += 1) { localStorage.setItem(ok, JSON.stringify({ ...st, lastSavedAt: Date.now() + i })); await new Promise((r) => setTimeout(r, 100)); }
  }, [OLD_KEY, stripped]);
  await other.evaluate(([ok, st]) => localStorage.setItem(ok, JSON.stringify({ ...st, lastSavedAt: Date.now() })), [OLD_KEY, stripped]);
  await fresh.waitForTimeout(2000);
  const writes = await other.evaluate(() => window.__newKeyWrites);
  const after = await read(fresh);
  check('旧 key 被写：新存档仍是 v3、无迁移纪事', after.paceCurve === 'v3' && after.schema === 3 && count(after) === 0 && writes <= 2, JSON.stringify({ p: after.paceCurve, n: count(after), w: writes }));
  await fresh.context().close();

  // 旧版标签页在发版后接着打了几场（同一代、胜场更多、存得更晚）：读档收下旧 key 的进度，v3 字段保留，不再跑迁移
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx2.addInitScript(() => { try { localStorage.setItem('jiaye-clock-manual', '1'); } catch { /* ignore */ } });
  const p2 = await ctx2.newPage();
  await p2.goto(URL, { waitUntil: 'domcontentloaded' });
  const t0 = Date.now();
  const cur = save({ schema: 3, paceCurve: 'v3', genStart: { day: 1, wins: 0, defends: 0 }, homeLevel: 3, battleWins: 5, gold: 8000, lastSavedAt: t0 - 60e3, earnedTitles: ['river-tiger'] });
  const oldTab = save({ homeLevel: 3, battleWins: 9, gold: 12000, lastSavedAt: t0 });
  await p2.evaluate(([nk, ok, a, b]) => { localStorage.setItem(nk, JSON.stringify(a)); localStorage.setItem(ok, JSON.stringify(b)); }, [KEY, OLD_KEY, cur, oldTab]);
  await p2.reload({ waitUntil: 'domcontentloaded' });
  await p2.locator('.home-v2').waitFor();
  await p2.waitForTimeout(400);
  const m = await read(p2);
  check('收下旧标签页多打的胜场，v3 曲线保留、不写迁移纪事', m.battleWins === 9 && m.paceCurve === 'v3' && m.schema === 3 && count(m) === 0, JSON.stringify({ w: m.battleWins, p: m.paceCurve, n: count(m) }));
  await p2.reload({ waitUntil: 'domcontentloaded' });
  await p2.locator('.home-v2').waitFor();
  check('再读档不重复收、不变', (await read(p2)).battleWins === 9 && count(await read(p2)) === 0);
  // 重置存档：新旧 key 一起清，旧档不会借尸还魂
  await p2.getByRole('button', { name: '设置与存档' }).click();
  p2.on('dialog', (d) => d.accept());
  await p2.getByRole('button', { name: '重置存档' }).click();
  await p2.waitForTimeout(500);
  const oldLeft = await p2.evaluate((ok) => localStorage.getItem(ok), OLD_KEY);
  await p2.reload({ waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(500);
  const r = await read(p2);
  check('重置存档：旧 key 一并清掉、重开后不回到旧档', oldLeft === null && (!r || !r.selectedLordId), JSON.stringify({ oldLeft: oldLeft?.slice(0, 40), lord: r?.selectedLordId }));
  await ctx2.close();
});

await scenario('复核·押金折扣写明与家声旗热区', async () => {
  // 侯府（侯门显贵 −5%）打开疆域图：标题与押金说明写出折扣
  const page = await open(save({ schema: 3, paceCurve: 'v3', homeLevel: 5, gold: 400000, orders: 3 }));
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.locator('.conquest-map').waitFor();
  const title = await page.locator('.conquest-map .section-title strong').innerText();
  check('疆域图标题写侯门 −5%', title.includes('开拓价 50%') && title.includes('侯门 −5%'), title);
  await page.locator('.conquest-map g.conquest-node').filter({ hasText: '南阳' }).click({ force: true });
  const panel = await page.locator('.conquest-panel').innerText();
  check('攻郡说明写已计侯门显贵', panel.includes('156,750 金军资（已计侯门显贵 −5%）'), panel.replace(/\n/g, ' '));
  await page.context().close();
  // 家声旗整组一个按钮，点开逐条写效果；每面左旗热区 ≥ 34px
  const chron = [['wealth', 'lvbu'], ['might', 'caocao'], ['wealth', 'liubei']].map(([ambition, lordId], i) => ({ generation: i + 1, lordId, days: 30, gold: 0, wins: 10, fiefs: 0, ambition, ambitionDone: true }));
  const grand = await open(save({ generation: 4, homeLevel: 6, battleWins: 31, frontierWins: 3, chronicle: chron, earnedTitles: ['restorer'] }));
  const lineage = grand.getByRole('button', { name: /^家声旗/ });
  check('家声旗一个按钮', (await lineage.count()) === 1);
  const box = await lineage.boundingBox();
  await lineage.click();
  const pop = await grand.locator('.home-honors__pop').innerText();
  check('点家声旗列出各家声效果', pop.includes('再造山河：') && pop.includes('家学渊源：'), pop.replace(/\n/g, ' '));
  const flags = await grand.locator('.home-honors__left > button').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  check('左旗热区 ≥ 34×46、家声组 ≥ 44', flags.length > 0 && flags.every(([w, h]) => w >= 34 && h >= 46) && box && box.width >= 44 && box.height >= 44, JSON.stringify({ flags, box }));
  await grand.context().close();
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) {
  console.error('scenarios_failed');
  process.exit(1);
}
console.log('scenarios_ok');
