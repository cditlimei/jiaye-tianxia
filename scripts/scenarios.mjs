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
  const { bidding = false, turnSeconds = 0, ...rest } = contextOptions;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...rest });
  // 旧用例按「玩家当地主」写，默认跳过叫地主；叫地主流程单独测（bidding: true）
  if (!bidding) await ctx.addInitScript(() => { try { localStorage.setItem('jiaye-ddz-skip-bid', '1'); } catch { /* 存储被禁用的用例 */ } });
  // 出牌倒计时默认关掉，免得慢机上用例被自动「不要」；倒计时单独测
  await ctx.addInitScript((sec) => { try { localStorage.setItem('jiaye-ddz-turn-seconds', String(sec)); } catch { /* 存储被禁用的用例 */ } }, turnSeconds);
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
  // ONLY=关键字 只跑名字含该关键字的场景（本地排查用）
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
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

await scenario('选择对手', async () => {
  // 诸葛亮开局战力约 81：推荐山贼头目；可自选更强的叛军校尉，胜率更低、缴获更高；弱档几乎必胜
  const page = await open(save({ selectedLordId: 'zhugeliang', ownedPartnerIds: [], homeLevel: 1 }));
  await page.getByRole('button', { name: '出征', exact: true }).click();
  await page.getByText('九州征途').first().waitFor();
  await page.getByRole('button', { name: /官道/ }).click();
  const cards = page.locator('.tier-card');
  const texts = await cards.allInnerTexts();
  const odds = texts.map((t) => Number(t.match(/胜率约 (\d+)%/)?.[1] ?? -1));
  check('对手列表显示八档与胜率', texts.length === 8 && odds.every((o) => o >= 0), odds.join('/'));
  // 头像是懒加载，先滚进视口再等它们加载完
  await page.locator('.tier-card').last().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.tier-card__avatar')].every((e) => e.tagName !== 'IMG' || e.complete), null, { timeout: 8000 }).catch(() => {});
  const avatars = await page.locator('.tier-card__avatar').evaluateAll((els) => els.map((e) => e.tagName === 'IMG' && e.naturalWidth > 0));
  check('对手卡片带立绘头像', avatars.length === 8 && avatars.every(Boolean), JSON.stringify(avatars));
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
  check('越往上败损占缴获越重', ev.length === 8 && texts.every((t) => /胜\s\+[\d,]+ · 败\s−[\d,]+|力不能及/.test(t)), texts.map((t) => t.split('\n').pop()).join(' | '));
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
  await locked.getByRole('button', { name: '出征', exact: true }).click();
  await locked.getByText('九州征途').first().waitFor();
  const node = locked.getByRole('button', { name: /江东/ });
  check('宅邸 2 级时江东未开放', await node.isDisabled() && (await node.innerText()).includes('砖瓦宅后开放'));
  await locked.context().close();

  // 宅邸 3 级：诸葛亮（智谋 100）出战，打完一场，胜负与金币、水战胜场、任务一致
  const page = await open(save({ selectedLordId: 'zhugeliang', homeLevel: 3, ownedPartnerIds: ['huangyueying'], claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third'] }));
  await page.getByRole('button', { name: '出征', exact: true }).click();
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
  await page.locator('.home-v2').waitFor();
  if (win) {
    await openGoals(page);
    const quest = page.locator('.quest-item').filter({ hasText: '江东扬帆' }).first();
    check('胜后任务「江东扬帆」可领赏', await quest.isVisible().catch(() => false) && (await quest.getByRole('button', { name: '领赏' }).isEnabled().catch(() => false)));
  }
  await page.context().close();
});

await scenario('许都朝堂', async () => {
  const locked = await open(save({ homeLevel: 3 }));
  await locked.getByRole('button', { name: '出征', exact: true }).click();
  await locked.getByText('九州征途').first().waitFor();
  const node = locked.getByRole('button', { name: /许都/ });
  check('宅邸 3 级时许都未开放', await node.isDisabled() && (await node.innerText()).includes('府邸后开放'));
  await locked.context().close();

  // 刘备（声望 96）+ 糜夫人（良缘 · 声望 16×1.3）+ 4 级府邸
  const page = await open(save({ selectedLordId: 'liubei', homeLevel: 4, ownedPartnerIds: ['mifuren'], claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third'] }));
  await page.getByRole('button', { name: '出征', exact: true }).click();
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
  await page.locator('.home-v2').waitFor();
  await openGoals(page);
  check('主城显示分战场战绩', /官道与牌局 \d+ · 水战 \d+ · 朝议 \d+ · 靖边 \d+ · 负 \d+/.test(await page.locator('main').innerText()));
  await page.context().close();
});

await scenario('西蜀屯田', async () => {
  const locked = await open(save({ homeLevel: 2 }));
  await locked.getByRole('button', { name: '出征', exact: true }).click();
  await locked.getByText('九州征途').first().waitFor();
  const node = locked.getByRole('button', { name: /西蜀/ });
  check('宅邸 2 级时西蜀未开放', await node.isDisabled() && (await node.innerText()).includes('砖瓦宅后开放'));
  await locked.context().close();

  const page = await open(save({ homeLevel: 3, gold: 7000, ownedPartnerIds: [], claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third'] }));
  const n0 = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  await page.getByRole('button', { name: '出征', exact: true }).click();
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
  await page.locator('.home-v2').waitFor();
  const n1 = income(await page.getByRole('button', { name: /^处理政务/ }).innerText());
  check('屯田后政务收入按比例提高', n1 > n0, `${n0} → ${n1}`);
  await openGoals(page);
  check('任务「西蜀屯田」可领赏', await page.locator('.quest-item').filter({ hasText: '西蜀屯田' }).getByRole('button', { name: '领赏' }).isEnabled().catch(() => false));
  await page.context().close();
});

await scenario('北疆边患', async () => {
  // 宅邸 3 级：北疆未开放
  const locked = await open(save({ homeLevel: 3 }));
  await locked.getByRole('button', { name: '出征', exact: true }).click();
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
  await dismissChoice(start);
  await start.getByRole('button', { name: '出征', exact: true }).click();
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
  await calm.getByRole('button', { name: '出征', exact: true }).click();
  await calm.getByText('九州征途').first().waitFor();
  await calm.getByRole('button', { name: /北疆/ }).click();
  check('边境安宁时出关按钮禁用', await calm.getByRole('button', { name: /^出关迎战/ }).isDisabled());
  await calm.context().close();

  // 退守关内：不扣金、边患保留
  const retreat = await open(save({ homeLevel: 4, day: 11, gold: 20000, frontierRaid: { startDay: 10, startedAt: Date.now(), dueAt: Date.now() + 3600 * 1000 }, nextRaidDay: 10 }));
  await retreat.getByRole('button', { name: '出征', exact: true }).click();
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
  await fight.getByRole('button', { name: '出征', exact: true }).click();
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
  await adv.getByRole('button', { name: '出征', exact: true }).click();
  await adv.getByText('九州征途').first().waitFor();
  await adv.getByRole('button', { name: /官道/ }).click();
  await adv.locator('.tier-card').first().click();   // 最弱档，几乎必胜
  // 面板上显示的已是翻倍后的实得数
  const summaryText = await adv.locator('.venue-summary').innerText();
  const reward = Number(summaryText.match(/缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
  const bonusLoss = Number(summaryText.match(/败折损 ([\d,]+) 金/)[1].replace(/,/g, ''));
  check('出征面板标明练兵翻倍', summaryText.includes('练兵之策 ×2'), summaryText.slice(0, 80));
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
  await openGoals(fresh);
  check('开局称号为白身并提示下一称号', hud.includes('「白身」') && (await fresh.locator('.honor-hint').innerText()).includes('乡绅'));
  await fresh.context().close();
  const vet = await open(save({ homeLevel: 6, battleWins: 31, navalWins: 5, courtWins: 1, frontierWins: 0, farmLevel: 2, generation: 1, fiefs: { nanyang: 'farming', runan: 'farming', yingchuan: 'military' } }));
  const hud2 = await vet.locator('.home-hud').innerText();
  await openGoals(vet);
  const hint2 = await vet.locator('.honor-hint').innerText();
  check('显示档位最高的称号，并提示还有几个未集齐', hud2.includes('「一代枭雄」') && hint2.includes('另有 5 个称号待集齐'), hint2);
  await vet.context().close();
  // 第二代：开国元勋是家声，不盖住本代称号；提示指向更高的本代称号
  const heir = await open(save({ homeLevel: 3, battleWins: 2, generation: 2, legacyPoints: 2 }));
  const hud3 = await heir.locator('.home-hud').innerText();
  await openGoals(heir);
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
  check('主公页列出全部称号并标出已获得', rows >= 11 && earned >= 4 && (await page.locator('.lord-sheet').innerText()).includes('吕布'), `rows=${rows} earned=${earned}`);
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
  await target.click();
  await page.waitForTimeout(200);
  const selected = await page.locator('.player-hand .poker-card.is-selected').getAttribute('data-card-id');
  check('点上排的牌能选中正确的那张', selected === id, `${id} → ${selected}`);
  await page.context().close();
});

await scenario('战斗加速与押注上限', async () => {
  // 金 500：败损按余额封顶，付不起全额也照样能打
  const poor = await open(save({ gold: 500, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'], homeLevel: 4 }));
  await dismissChoice(poor);
  await poor.getByRole('button', { name: '出征', exact: true }).click();
  await poor.getByText('九州征途').first().waitFor();
  await poor.getByRole('button', { name: /官道/ }).click();
  const cap = poor.locator('.tier-card').filter({ hasText: /败\s−500(?!\d)/ });
  check('身家不够全额败损时按余额封顶且仍可选', (await cap.count()) >= 1 && (await cap.first().isEnabled()), `count=${await cap.count()}`);
  await poor.context().close();
  // 直接结算：几秒内出结果
  const page = await open(save({ gold: 5000, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'], homeLevel: 4 }));
  await page.getByRole('button', { name: '出征', exact: true }).click();
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
  await page.getByRole('button', { name: '伴侣', exact: true }).click();
  await page.getByText('伴侣招募').first().waitFor();
  const priceOf = async (name) => Number((await page.locator('.partner-card').filter({ hasText: name }).getByRole('button').innerText()).replace(/[^\d]/g, ''));
  const d = await priceOf('貂蝉'), c = await priceOf('蔡文姬'), z = await priceOf('甄姬');
  const tags = (await page.locator('.partner-card').filter({ hasText: '貂蝉' }).innerText()) + (await page.locator('.partner-card').filter({ hasText: '蔡文姬' }).innerText());
  check('伴侣按品级定价（传说 > 名姬 > 贤助）', d > z && z > c && tags.includes('传说') && tags.includes('贤助'), `${d}/${z}/${c}`);
  await page.context().close();
  // 出征后刷新：将士按显示的胜率替玩家打完，胜得缴获、败扣折损
  const fight = await open(save({ gold: 5000, homeLevel: 4, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await fight.getByRole('button', { name: '出征', exact: true }).click();
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
  await page.getByRole('button', { name: '出征', exact: true }).click();
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
  await p2.getByRole('button', { name: '出征', exact: true }).click();
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
  // 军令已满时选「募为乡勇」：不增加，纪事写明已满而不是 +1
  const full = await open(save({ day: 19, gold: 5000, homeLevel: 2, ownedPartnerIds: [], orders: 6 }));
  await full.getByRole('button', { name: /^处理政务/ }).click();
  await full.waitForTimeout(400);
  await full.locator('.choice-card__options button').nth(1).click();
  await full.waitForTimeout(300);
  s = await read(full);
  check('军令已满时募为乡勇纪事写明未增加', s.orders === 6 && s.eventLog[0]?.detail.includes('军令已满，未增加') && !s.eventLog[0]?.detail.includes('+1'), `orders=${s.orders} ${s.eventLog[0]?.detail}`);
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
  await armory.getByRole('button', { name: '兵器', exact: true }).click();
  await armory.getByRole('dialog', { name: '兵器库' }).waitFor();
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

await scenario('封地经略', async () => {
  const power = async (page) => Number((await page.locator('.home-hud__chips div').nth(1).innerText()).match(/\d+/)[0]);
  // 府邸 4 级：封地未开放
  const locked = await open(save({ homeLevel: 4, gold: 200000 }));
  check('侯府前主城不提示封地', !(await locked.locator('main').innerText()).includes('裂土封郡'));
  await locked.getByRole('button', { name: /^封地/ }).click();
  check('侯府前封地页只说明门槛', (await locked.locator('.fief-sheet').innerText()).includes('侯府后方可') && !(await locked.getByRole('button', { name: /开拓南阳郡/ }).isVisible().catch(() => false)));
  await locked.getByRole('button', { name: '关闭' }).click();
  await locked.context().close();

  // 侯府 + 16 万金：主城提示 → 选整军 → 开拓南阳郡；军令上限 7；任务可领
  const page = await open(save({ homeLevel: 5, gold: 160000, claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'estate-third', 'first-win', 'power-200', 'naval-first-win', 'court-first-win', 'farm-first'] }));
  const base = await open(save({ homeLevel: 5, gold: 160000 }));
  const n0 = income(await base.getByRole('button', { name: /^处理政务/ }).innerText());
  const p0 = await power(base);
  await base.context().close();
  check('侯府且金够时机会栏提示封郡', (await page.locator('.chance-bar').textContent()).includes('可开拓南阳郡'));
  await chance(page, /可开拓南阳郡/);
  await page.getByRole('radio', { name: /整军/ }).click();
  await page.getByRole('button', { name: /开拓南阳郡 · 行整军之策/ }).click();
  await page.waitForTimeout(400);
  let s = await read(page);
  check('开拓南阳郡扣 15 万并记整军方略', s.gold === 10000 && s.fiefs?.nanyang === 'military', JSON.stringify({ gold: s.gold, fiefs: s.fiefs }));
  check('下一郡显示差额', (await page.getByRole('button', { name: /差 240,000 金/ }).isVisible()));
  await page.getByRole('button', { name: '关闭' }).click();
  check('整军后军令上限 7', (await page.locator('.home-hud__chips').innerText()).includes('/7'));
  await openGoals(page);
  check('任务「初封一郡」可领赏', await page.locator('.quest-item').filter({ hasText: '初封一郡' }).getByRole('button', { name: '领赏' }).isEnabled().catch(() => false));
  await page.context().close();

  // 劝农：收入提高；教化：武力 +4
  const farming = await open(save({ homeLevel: 5, gold: 160000, fiefs: { nanyang: 'farming' } }));
  const n1 = income(await farming.getByRole('button', { name: /^处理政务/ }).innerText());
  check('劝农封地提高政务收入', n1 > n0, `${n0} → ${n1}`);
  await farming.context().close();
  const schooling = await open(save({ homeLevel: 5, gold: 160000, fiefs: { nanyang: 'schooling' } }));
  check('教化封地武力 +4', (await power(schooling)) === p0 + 4, `${p0} → ${await power(schooling)}`);
  await schooling.context().close();

  // 改方略：整军 → 劝农收一成费，超出上限的军令收回
  const change = await open(save({ homeLevel: 5, gold: 20000, orders: 7, fiefs: { nanyang: 'military' } }));
  await change.getByRole('button', { name: /^封地/ }).click();
  await change.getByRole('button', { name: /改方略 15,000 金/ }).click();
  await change.getByRole('button', { name: '改为劝农' }).click();
  await change.waitForTimeout(400);
  s = await read(change);
  check('改方略扣一成费并收回超额军令', s.gold === 5000 && s.fiefs.nanyang === 'farming' && s.orders === 6, JSON.stringify({ gold: s.gold, fiefs: s.fiefs, orders: s.orders }));
  await change.context().close();

  // 存档断档：没有南阳却有汝南 → 作废
  const broken = await open(save({ homeLevel: 5, fiefs: { runan: 'farming' } }));
  await broken.waitForTimeout(300);
  check('断档封地存档被清理', Object.keys((await read(broken)).fiefs ?? {}).length === 0);
  await broken.context().close();

  // 传位保留封地
  const heir = await open(save({ homeLevel: 6, gold: 250000, fiefs: { nanyang: 'farming', runan: 'military' } }));
  await heir.getByRole('button', { name: '设置与存档' }).click();
  await heir.getByText('当前存档').first().waitFor();
  check('传位面板写明封地传下', (await heir.locator('.succession-panel').innerText()).includes('封地随之传下'));
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

  // 六郡已满时不给选开疆
  const full = await open(save({ generation: 2, homeLevel: 6, fiefs: { nanyang: 'farming', runan: 'farming', yingchuan: 'farming', changsha: 'farming', bajun: 'farming', liaodong: 'farming' } }));
  check('六郡已满不出现开疆', !(await full.locator('.ambition-card').innerText()).includes('开疆'));
  await full.context().close();

  // 达成富国后传位：家谱记一笔达成，下一代开局多 10,000 金；家谱在主公页可见
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
  await heir.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await heir.getByRole('button', { name: '携美人，共创家业' }).click();
  await heir.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  s = await read(heir);
  check('第三代开局多得 10,000 金', s.generation === 3 && s.legacyPoints === 8 && s.gold === 1000 + 8 * 3000 + 10000, `gold=${s.gold} lp=${s.legacyPoints}`);
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
  // 条件未齐（家业点 19）不出终局卡
  const almost = await open(save({ homeLevel: 6, legacyPoints: 19, generation: 3, fiefs: six }));
  check('家业点未满不出终局卡', !(await almost.locator('main').innerText()).includes('展开卷轴'));
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
  check('国号魏军令上限 7', (await wei.locator('.home-hud__chips').innerText()).includes('/7'));
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
  const lineageCount = async (page) => {
    await page.getByRole('button', { name: '主公' }).click();
    const dialog = page.getByRole('dialog', { name: '主公' });
    const count = Number((await dialog.locator('.title-list').first().locator('.section-title strong').innerText()).split('/')[0]);
    const text = await dialog.innerText();
    await dialog.getByRole('button', { name: '关闭' }).click();
    return { count, text };
  };
  // 终局存档开新朝：家声数不减少，天下归心仍在
  const page = await open(save({ homeLevel: 6, legacyPoints: 20, generation: 3, gold: 50000, fiefs: six, chronicle: [{ generation: 1, lordId: 'lvbu', days: 40, gold: 250000, wins: 31, fiefs: 0, ambition: null, ambitionDone: false }, { generation: 2, lordId: 'caocao', days: 36, gold: 620000, wins: 28, fiefs: 1, ambition: 'wealth', ambitionDone: true }] }));
  const before = await lineageCount(page);
  await page.getByRole('button', { name: '展开卷轴 →' }).click();
  check('终局卷轴写明新朝是第 2 朝、魏按新朝口径 6 → 7', (await page.locator('.ending-sheet').innerText()).includes('第 2 朝') && (await page.getByRole('radio', { name: /魏/ }).innerText()).includes('6 → 7'));
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /开创新朝 · 国号魏/ }).click();
  await page.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: '确认选择' }).click();
  await page.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: '携美人，共创家业' }).click();
  await page.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  const after = await lineageCount(page);
  const s = await read(page);
  check('开新朝后家声数不减少', after.count >= before.count && before.count >= 5 && s.earnedTitles?.includes('unifier'), `${before.count} → ${after.count} ${JSON.stringify(s.earnedTitles)}`);
  await page.context().close();

  // 老存档（无 earnedTitles、有前朝）：补记天下归心
  const legacy = await open(save({ realms: { wei: 1, shu: 0, wu: 0 }, realm: 'wei', pastDynasties: [{ dynasty: 1, realm: null, generations: 3, days: 100, wins: 70, ambitions: 1 }] }));
  const old = await lineageCount(legacy);
  check('老存档有前朝即补记天下归心', /「天下归心」\s*已获得/.test(old.text) && old.count >= 6, old.text.match(/「天下归心」[^\n]*\n?[^\n]*/)?.[0]);
  await legacy.context().close();

  // 家业点满但只有 4 郡：不出志向卡，首页与传位面板改提示只差 2 郡
  const maxed = await open(save({ homeLevel: 6, legacyPoints: 20, generation: 3, gold: 50000, fiefs: { nanyang: 'farming', runan: 'farming', yingchuan: 'military', changsha: 'farming' } }));
  const main = await maxed.locator('main').innerText();
  check('家业点满未满郡：无志向卡且提示只差 2 郡', !(await maxed.locator('.ambition-card').isVisible().catch(() => false)) && main.includes('只差 2 郡') && !main.includes('志向未定'), main.match(/[^\n]*只差[^\n]*/)?.[0]);
  await maxed.getByRole('button', { name: '设置与存档' }).click();
  await maxed.getByText('当前存档').first().waitFor();
  const panel = await maxed.locator('.succession-panel').innerText();
  check('传位面板不提志向与 10,000 金，改提示只差 2 郡', panel.includes('只差 2 郡') && !panel.includes('志向') && !panel.includes('10,000'), panel.replace(/\n/g, ' '));
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
  // 开疆家风：封地九折
  const exp = await open(save({ generation: 3, homeLevel: 5, gold: 135000, chronicle: two('expansion') }));
  check('开疆家风九折后机会栏报折后价', (await exp.locator('.chance-bar').textContent()).includes('135,000 金'));
  await chance(exp, /可开拓南阳郡/);
  await exp.getByRole('button', { name: /^开拓南阳郡/ }).click();
  await exp.waitForTimeout(300);
  check('九折开拓扣 135,000', (await read(exp)).gold === 0 && (await read(exp)).fiefs?.nanyang === 'farming');
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
  await might.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await might.getByRole('button', { name: '携美人，共创家业' }).click();
  await might.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  check('强兵家风开局军令满', (await read(might)).orders === 6, `orders=${(await read(might)).orders}`);
  await might.context().close();
  // 带整军封地传位：第三代开局军令按含整军加成的上限满额（7/7）
  const mightFief = await open(save({ generation: 2, homeLevel: 6, gold: 250000, battleWins: 31, fiefs: { nanyang: 'military' }, ambition: { id: 'might', target: 30, baseFiefs: 0 }, chronicle: [two('might')[0]] }));
  await mightFief.getByRole('button', { name: '设置与存档' }).click();
  await mightFief.getByText('当前存档').first().waitFor();
  mightFief.on('dialog', (d) => d.accept());
  await mightFief.getByRole('button', { name: '传位给下一代' }).click();
  await mightFief.getByText('乱世择主').first().waitFor({ timeout: 8000 });
  await mightFief.getByRole('button', { name: '确认选择' }).click();
  await mightFief.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  await mightFief.getByRole('button', { name: '携美人，共创家业' }).click();
  await mightFief.getByRole('button', { name: /^处理政务/ }).waitFor({ timeout: 8000 });
  const mf = await read(mightFief);
  check('强兵家风带整军郡开局军令等于上限 7', mf.orders === 7 && (await mightFief.locator('.home-hud__chips').innerText()).includes('7/7'), `orders=${mf.orders}`);
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
  // 吴：江东档位显示缴获 ×1.2（无国号时同档对照）
  const tierText = async (page, region) => { await page.getByRole('button', { name: '出征', exact: true }).click(); await page.getByText('九州征途').first().waitFor(); await page.getByRole('button', { name: region }).click(); return (await page.locator('main').innerText()).match(/胜\s\+([\d,]+)/g) ?? []; };
  const plain = await open(save({ homeLevel: 4 }));
  const base = await tierText(plain, /江东/);
  await plain.context().close();
  const wu = await open(save({ homeLevel: 4, realms: { wei: 0, shu: 0, wu: 1 }, realm: 'wu' }));
  const boosted = await tierText(wu, /江东/);
  const num = (t) => Number(t.replace(/[^\d]/g, ''));
  check('国号吴江东缴获 ×1.2', base.length > 0 && num(boosted[0]) === Math.round(num(base[0]) * 1.2), `${base[0]} → ${boosted[0]}`);
  await wu.context().close();
  // 蜀：屯田九折
  const shu = await open(save({ homeLevel: 3, gold: 7000, realms: { wei: 0, shu: 1, wu: 0 }, realm: 'shu' }));
  await shu.getByRole('button', { name: '出征', exact: true }).click();
  await shu.getByText('九州征途').first().waitFor();
  await shu.getByRole('button', { name: /西蜀/ }).click();
  await shu.getByRole('button', { name: /投入 5,400 金/ }).click();
  await shu.waitForTimeout(300);
  check('国号蜀屯田九折扣款', (await read(shu)).gold === 1600 && (await read(shu)).farmLevel === 1, `gold=${(await read(shu)).gold}`);
  await shu.context().close();
  // 离线跨过第 8 日：小事按现钱入账，计入府中喜事
  const off = await open(save({ day: 7, ownedPartnerIds: ['diaochan'], lastSavedAt: Date.now() - 2 * 3600 * 1000 }));
  await off.waitForTimeout(500);
  const o = await read(off);
  check('离线小事按现钱结算', o.day === 9 && /1 桩/.test(o.eventLog[0]?.detail ?? '') && o.pendingChoice === null, o.eventLog[0]?.detail);
  await off.context().close();
});

await scenario('四十日试玩修复', async () => {
  // 新手期败损封顶三成：砖瓦宅、1,000 金
  const poor = await open(save({ homeLevel: 3, gold: 1000, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await dismissChoice(poor);
  await poor.getByRole('button', { name: '出征', exact: true }).click();
  await poor.getByText('九州征途').first().waitFor();
  await poor.getByRole('button', { name: /官道/ }).click();
  const losses = ((await poor.locator('main').innerText()).match(/败\s−([\d,]+)/g) ?? []).map((t) => Number(t.replace(/[^\d]/g, '')));
  check('新手期败损不超过现有金币三成', losses.length > 0 && losses.every((n) => n <= 300), losses.join(','));
  await poor.context().close();
  // 军令 0：主城出征按钮写明几日后回复；威震一郡显示进度
  // 前置任务都领过，「威震一郡」才排进面板前四条
  const zero = await open(save({ orders: 0, day: 11, claimedQuestIds: ['upgrade-wood', 'first-partner', 'first-weapon', 'first-win', 'estate-third'] }));
  check('军令为 0 时顶栏写明回复', (await zero.locator('.home-hud__chips').innerText()).includes('1 日后 +1'));
  await openGoals(zero);
  check('武力任务显示进度', /\d+\/180/.test(await zero.locator('.quest-item').filter({ hasText: '威震一郡' }).innerText()));
  check('顶栏日期标签为「日」', (await zero.locator('.home-hud__chips').innerText()).includes('\n日'));
  await zero.context().close();
  // 升府邸：纪事写明新开放，边患推迟三日
  const up = await open(save({ homeLevel: 3, gold: 20000, day: 18, nextRaidDay: 10 }));
  await up.getByRole('button', { name: /升级宅邸/ }).click();
  await up.waitForTimeout(3000);
  const u = await read(up);
  check('升府邸纪事写明新开放且边患推迟', u.homeLevel === 4 && (u.eventLog[0]?.detail ?? '').includes('新开放：许都朝堂') && u.nextRaidDay === 21, JSON.stringify({ d: u.eventLog[0]?.detail, n: u.nextRaidDay }));
  await up.context().close();
  // 钱够时机会栏提示兵器
  const rich = await open(save({ gold: 6000 }));
  check('钱够时机会栏提示更强兵器', (await rich.locator('.chance-bar').textContent()).includes('可购入'));
  await rich.context().close();
});

await scenario('朝代家声与侯府价', async () => {
  const page = await open(save({ homeLevel: 4, gold: 30000, realm: 'wu', realms: { wei: 1, shu: 1, wu: 1 }, pastDynasties: [{ dynasty: 1, realm: null, generations: 2, days: 80, wins: 40, ambitions: 1 }, { dynasty: 2, realm: 'wei', generations: 2, days: 70, wins: 30, ambitions: 0 }, { dynasty: 3, realm: 'shu', generations: 1, days: 50, wins: 20, ambitions: 0 }] }));
  check('侯府升级价 30,000', (await page.getByRole('button', { name: /升级宅邸/ }).innerText()).includes('30,000'));
  await page.getByRole('button', { name: '主公' }).click();
  const text = await page.getByRole('dialog', { name: '主公' }).innerText();
  check('朝代家声：再造山河、三朝元老、三分归一', ['再造山河', '三朝元老', '三分归一'].every((name) => text.includes(`「${name}」`)) && !/「三分归一」\s*魏、蜀、吴/.test(text), text.match(/「三分归一」[^\n]*\n?[^\n]*/)?.[0]);
  await page.context().close();
});

await scenario('整合复测修复', async () => {
  // 曹操持专属青釭剑：方天画戟只多 1 点，不该提示；屯田够钱时提示并直达西蜀
  const cao = await open(save({ selectedLordId: 'caocao', homeLevel: 3, gold: 6500, equippedWeaponId: 'qinggang', ownedWeaponIds: ['xuanjian', 'qinggang'] }));
  const bar = await cao.locator('.chance-bar').textContent();
  check('小幅提升的兵器不进机会栏', !bar.includes('可购入'), bar.replace(/\n/g, ' '));
  await chance(cao, /可升西蜀屯田/);
  await cao.getByText('九州征途').first().waitFor();
  check('屯田提示直达西蜀面板', await cao.getByRole('button', { name: /投入 6,000 金/ }).isVisible());
  await cao.context().close();
  // 侯府后机会栏显示下一目标与差额；称号「侯门显贵」
  const hou = await open(save({ homeLevel: 5, gold: 20000 }));
  check('侯府后显示下一目标差额', /下一目标 · 王城[\s\S]*还差 100,000 金/.test(await hou.locator('.chance-bar').textContent()));
  check('侯府称号侯门显贵', (await hou.locator('.home-hud').innerText()).includes('侯门显贵'));
  await hou.context().close();
  // 新手首战：官道推荐档胜率不低于 80%
  const fresh = await open(save({ tutorialDone: false, battleWins: 0, homeLevel: 2, gold: 1000 }));
  await fresh.getByRole('button', { name: '出征', exact: true }).click();
  await fresh.getByText('九州征途').first().waitFor();
  await fresh.getByRole('button', { name: /官道/ }).click();
  const rec = await fresh.locator('.tier-card').filter({ hasText: '推荐' }).first().innerText();
  check('新手首战推荐高胜率档', Number(rec.match(/胜率约 (\d+)%/)?.[1] ?? 0) >= 80, rec.replace(/\n/g, ' '));
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
  // 传位 chip 写明下一代收益，不再给「先封郡」建议
  const king = await open(save({ homeLevel: 6, gold: 250000, legacyPoints: 2, generation: 2, fiefs: {} }));
  const bar = await king.locator('.chance-bar').textContent();
  check('传位提示写明下一代收益', bar.includes('下一代收入 +20%') && bar.includes('开局 13,000 金') && !bar.includes('先封郡'), bar.replace(/\n/g, ' '));
  await king.context().close();
  // 传位后择主：继承了任务与封地，但不弹「清空进度」
  const heir = await open(save({ screen: 'lordSelect', lastScreen: 'lordSelect', selectedLordId: null, generation: 2, legacyPoints: 2, farmLevel: 3, claimedQuestIds: ['farm-first'], fiefs: { nanyang: 'farming' } }));
  let dialogs = 0;
  heir.on('dialog', (d) => { dialogs += 1; d.accept(); });
  await heir.getByRole('button', { name: '继续家业' }).click();
  await heir.getByRole('button', { name: '确认选择' }).click();
  await heir.getByText('良缘入府').first().waitFor({ timeout: 8000 });
  check('传位后择主不弹清空进度确认', dialogs === 0, `dialogs=${dialogs}`);
  await heir.context().close();
});

await scenario('后期档位与今日军功', async () => {
  // 第 12 日轮到官道（12 % 3 = 0）：地图标注，档位缴获 ×1.3；第 13 日换江东
  const tierRewards = async (page) => ((await page.locator('main').innerText()).match(/胜\s\+([\d,]+)/g) ?? []).map((t) => Number(t.replace(/[^\d]/g, '')));
  const d12 = await open(save({ day: 12, homeLevel: 4 }));
  await d12.getByRole('button', { name: '出征', exact: true }).click();
  await d12.getByText('九州征途').first().waitFor();
  check('今日军功标在官道', (await d12.getByRole('button', { name: /官道/ }).innerText()).includes('今日军功'));
  await d12.getByRole('button', { name: /官道/ }).click();
  const boosted = await tierRewards(d12);
  await d12.context().close();
  const d13 = await open(save({ day: 13, homeLevel: 4 }));
  await d13.getByRole('button', { name: '出征', exact: true }).click();
  await d13.getByText('九州征途').first().waitFor();
  check('第 13 日军功换到江东', (await d13.getByRole('button', { name: /江东/ }).innerText()).includes('今日军功'));
  await d13.getByRole('button', { name: /官道/ }).click();
  const plain = await tierRewards(d13);
  check('军功日官道缴获 ×1.3', plain.length > 0 && boosted[0] === Math.round(plain[0] * 1.3), `${plain[0]} → ${boosted[0]}`);
  check('官道顶端新增两档', (await d13.locator('main').innerText()).includes('僭号天子'));
  await d13.context().close();
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
  const enterFixed = async (page) => {
    await page.getByRole('button', { name: '出征', exact: true }).click();
    await page.getByRole('button', { name: /中级场/ }).click();
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
  check('地主炸弹后刷新扣款 = 认输金额', lordQuit === 3200 && g0 - g1 === lordQuit, `认输 ${lordQuit} Δ=${g0 - g1}`);
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
  check('农民刷新按半份扣（= 认输金额）', ab?.share === 0.5 && farmerQuit === Math.round(1600 * ab.multiplier * 0.5) && f0 - f1 === farmerQuit, `×${ab?.multiplier} share=${ab?.share} 认输 ${farmerQuit} Δ=${f0 - f1}`);
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
  check('认输记一负并折损 20% 缴获', (await read(page)).battleLosses === 1 && g0 - (await read(page)).gold === 1600, `Δ=${g0 - (await read(page)).gold}`);

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
  check('斗地主整局可打完且结算一致', ended && (win ? delta === 8000 * mult && after.battleWins === before.battleWins + 1 : delta === -Math.min(before.gold, 1600 * mult) && after.battleLosses === before.battleLosses + 1),
    `${win ? '胜' : '负'} ×${mult} Δgold=${delta}`);
  await page.context().close();
});

await scenario('主城入口与加成文案', async () => {
  const raid = { startDay: 10, startedAt: Date.now(), dueAt: Date.now() + 3600 * 1000 };
  // 边患告警「去迎战」直接选中北疆，主按钮是出关迎战；有练兵之策时预览按翻倍后金额
  const fr = await open(save({ homeLevel: 4, day: 11, gold: 20000, frontierRaid: raid, nextRaidDay: 10, nextBattleBonus: 2 }));
  await fr.getByRole('button', { name: '去迎战 →' }).click();
  await fr.getByText('九州征途').first().waitFor();
  check('去迎战选中北疆', (await fr.locator('.map-node.is-selected').innerText()).includes('北疆'));
  check('去迎战主按钮为出关迎战', await fr.getByRole('button', { name: /^出关迎战/ }).isEnabled() && !(await fr.getByRole('button', { name: /进入斗地主/ }).isVisible().catch(() => false)));
  const frText = await fr.locator('.venue-summary').innerText();
  check('边患预览含练兵之策翻倍', frText.includes('（练兵之策 ×2）'), frText.slice(0, 120));
  await fr.context().close();

  // 加成文案按真实来源列出：第 13 日江东今日军功、官道无加成；第 14 日许都今日军功 + 国号魏
  const summaryOf = async (page, region) => { await page.getByRole('button', { name: region }).click(); return page.locator('.venue-summary').innerText(); };
  const d13 = await open(save({ day: 13, homeLevel: 4, gold: 20000, equippedWeaponId: 'fangtian', ownedPartnerIds: ['diaochan', 'zhurong'] }));
  await d13.getByRole('button', { name: '出征', exact: true }).click();
  await d13.getByText('九州征途').first().waitFor();
  check('地图有今日军功说明', (await d13.locator('.map-term-note').innerText()).includes('+30%'));
  const land = await summaryOf(d13, /官道/);
  check('无加成时不写加成', /胜缴获 [\d,]+ 金，败/.test(land), land.slice(0, 120));
  const naval = await summaryOf(d13, /江东/);
  check('军功日只写今日军功', naval.includes('（今日军功 +30%）') && !naval.includes('练兵'), naval.slice(0, 160));
  await d13.locator('.tier-card').first().click();
  const shown = Number((await d13.locator('.venue-summary').innerText()).match(/胜缴获 ([\d,]+) 金/)[1].replace(/,/g, ''));
  const before = await read(d13);
  await d13.getByRole('button', { name: /^扬帆出战 ·/ }).click();
  await d13.getByRole('button', { name: '直接结算' }).click();
  await d13.getByText(/水战告捷|折戟江上/).first().waitFor({ timeout: 8000 });
  await d13.waitForTimeout(400);
  const after = await read(d13);
  const logText = await d13.locator('.battle-log').innerText();
  const wonNaval = (await d13.locator('h2').first().innerText()).includes('水战告捷');
  check('江东结算与预估一致且标今日军功', wonNaval ? after.gold - before.gold === shown && logText.includes('（今日军功 +30%）') && !logText.includes('国号') : after.battleLosses === before.battleLosses + 1, `${wonNaval ? '胜' : '负'} Δ=${after.gold - before.gold} shown=${shown}`);
  await d13.context().close();
  const wei = await open(save({ day: 14, homeLevel: 4, realms: { wei: 1, shu: 0, wu: 0 }, realm: 'wei' }));
  await wei.getByRole('button', { name: '出征', exact: true }).click();
  await wei.getByText('九州征途').first().waitFor();
  const court = await summaryOf(wei, /许都/);
  check('许都军功日 + 国号魏逐项列出', court.includes('（今日军功 +30%、国号 +20%）'), court.slice(0, 200));
  check('朝议说明声势', court.includes('声势'));
  await wei.context().close();

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

  // 引导第 3 步差钱：有军令就去出征赚钱（选中官道），没军令才过一天；钱够去兵器库
  const allQuests = ['upgrade-wood', 'first-partner', 'first-weapon', 'first-win', 'estate-third', 'power-200', 'naval-first-win', 'court-first-win', 'farm-first', 'frontier-first-win', 'succession', 'partner-event', 'fief-first', 'three-partners'];
  const step3 = (extra) => save({ tutorialDone: false, homeLevel: 2, gold: 760, day: 6, ownedPartnerIds: ['diaochan', 'zhurong'], claimedQuestIds: allQuests, ...extra });
  const g3 = await open(step3({ orders: 2 }));
  const panel = g3.locator('[aria-label="开局引导"]');
  await panel.waitFor();
  check('第 3 步差钱时主按钮去出征赚钱', (await panel.innerText()).includes('第 3 步') && (await g3.locator('.starter-do').innerText()) === '去出征赚钱 →', await g3.locator('.starter-do').innerText());
  check('第 3 步说明打一场能凑多少', /一场就够|场凑齐/.test(await panel.innerText()));
  await g3.locator('.starter-do').click();
  await g3.getByText('九州征途').first().waitFor();
  check('引导出征选中官道', (await g3.locator('.map-node.is-selected').innerText()).includes('官道') && (await g3.getByRole('button', { name: /^出征讨伐 · 耗 1 军令/ }).isVisible()));
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

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) {
  console.error('scenarios_failed');
  process.exit(1);
}
console.log('scenarios_ok');
