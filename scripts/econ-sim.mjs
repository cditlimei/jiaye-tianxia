// 经济节奏模拟：四个战场 + 屯田 + 兵器 + 封地。每个游玩日：N 次政务、每道军令打期望最高的战场（75% 胜）、邻郡反攻每 2 个游玩日一次（v2.2，替代北疆边患），花钱优先级 修城→宅邸→屯田→兵器→伴侣→封地
// v2.3 起默认先跑真实时间（MODE=realtime，见文件末 runRealtime）再跑旧的按游玩日模型（MODE=day 只跑旧模型）
// 用法: node scripts/econ-sim.mjs   环境变量 DAYS=240 POLICY=military|schooling RW=缴获倍率 CM=造价倍率 SIEGE=0 关反攻对照 REPAIR=0 不修城；新系统/调数值前先跑一遍
// v3.1 起（真实时间模型）：PACE=v2|v3 造价曲线（缺省 v2 = 老存档）INIT_LP=开局家业点 REALMS=魏,蜀,吴 历朝国号计数（带开国金、家声）
//   TITLES=0 关掉称号效果做对照（缺省 1，与游戏一致）SUCC=0|1|3 本朝传位次数（到王城后按递增价折点、不重置）MODE=dynasty 整朝串跑到统一（六郡 + 王城）
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'; import { createRequire } from 'node:module'; import { pathToFileURL, fileURLToPath } from 'node:url'; import { join, dirname } from 'node:path'; import { tmpdir } from 'node:os';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); const require = createRequire(join(ROOT, 'package.json')); const ts = require('typescript');
const D = mkdtempSync(join(tmpdir(), 'jiaye-econ-')); mkdirSync(D + '/data', { recursive: true }); mkdirSync(D + '/lib', { recursive: true });
const tr = (src, dst) => writeFileSync(dst, ts.transpileModule(readFileSync(src, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from '(\.\.?\/[^']+)'/g, "from '$1.mjs'"));
// 整个 data/ 与 lib/ 都转译，新增模块不用回来改清单（曾因清单写死、新模块缺失整条命令跑不起来）
const { readdirSync } = await import('node:fs');
const modules = ['types', ...['data', 'lib'].flatMap((dir) => readdirSync(join(ROOT, 'src', dir)).filter((name) => name.endsWith('.ts')).map((name) => `${dir}/${name.slice(0, -3)}`))];
for (const f of modules) tr(join(ROOT, `src/${f}.ts`), `${D}/${f}.mjs`);
// 真实时间调参对照（只改模拟用的转译副本，不改源码）：RT_FACTOR=收入系数 RT_ORDER_LATE=府邸起军令间隔（分） RT_ORDER_EARLY RT_CAPS=12,12,12,20,20,24
{
  const file = `${D}/lib/clock.mjs`; let src = readFileSync(file, 'utf8');
  if (process.env.RT_FACTOR) src = src.replace(/REALTIME_INCOME_FACTOR = [\d.]+/, `REALTIME_INCOME_FACTOR = ${Number(process.env.RT_FACTOR)}`);
  if (process.env.RT_ORDER_LATE) src = src.replace(/ORDER_MS_LATE = [^;]+;/, `ORDER_MS_LATE = ${Number(process.env.RT_ORDER_LATE)} * 60 * 1000;`);
  if (process.env.RT_ORDER_EARLY) src = src.replace(/ORDER_MS_EARLY = [^;]+;/, `ORDER_MS_EARLY = ${Number(process.env.RT_ORDER_EARLY)} * 60 * 1000;`);
  if (process.env.RT_CAPS) { const c = process.env.RT_CAPS.split(',').map(Number); src = src.replace(/TREASURY_CAP_DAYS = \{[^}]+\}/, `TREASURY_CAP_DAYS = { 1: ${c[0]}, 2: ${c[1]}, 3: ${c[2]}, 4: ${c[3]}, 5: ${c[4]}, 6: ${c[5]} }`); }
  writeFileSync(file, src);
}
// TITLES=0：称号效果总开关关掉（只改转译副本）
if (process.env.TITLES === '0') { const file = `${D}/data/titleEffects.mjs`; writeFileSync(file, readFileSync(file, 'utf8').replace(/TITLES_ENABLED = true/, 'TITLES_ENABLED = false')); }
// 调参对照（只改转译副本）：V3_SCALE=v3 郡价倍数（缺省 2）V3_ROYAL=v3 王城价（缺省 360000）
if (process.env.V3_SCALE) { const file = `${D}/lib/prices.mjs`; writeFileSync(file, readFileSync(file, 'utf8').replace(/PACE_V3_FIEF_SCALE = [\d.]+/, `PACE_V3_FIEF_SCALE = ${Number(process.env.V3_SCALE)}`)); }
if (process.env.V3_ROYAL) { const file = `${D}/data/gameData.mjs`; writeFileSync(file, readFileSync(file, 'utf8').replace(/ROYAL_COST_V3 = \d+/, `ROYAL_COST_V3 = ${Number(process.env.V3_ROYAL)}`)); }
// TITLE_OFF=hegemon,gentry：只关掉这几个称号的效果（逐个看称号对节奏的贡献）
if (process.env.TITLE_OFF) { const file = `${D}/data/titleEffects.mjs`; let src = readFileSync(file, 'utf8'); for (const id of process.env.TITLE_OFF.split(',')) src = src.replaceAll(`has('${id}')`, 'false'); writeFileSync(file, src); }
// 调参对照（只改转译副本）：FACTION_SCALE=shu:1.3,wu:1.2 势力造价曲线倍数；FACTION_ROYAL=shu:400000 势力王城价
for (const [envKey, field] of [['FACTION_SCALE', 'curveScale'], ['FACTION_ROYAL', 'royalCost']]) {
  if (!process.env[envKey]) continue;
  const file = `${D}/data/factions.mjs`; let src = readFileSync(file, 'utf8');
  for (const pair of process.env[envKey].split(',')) {
    const [id, value] = pair.split(':');
    src = src.replace(new RegExp(`(id: '${id}',[\\s\\S]*?${field}: )[\\d.]+`), `$1${Number(value)}`);
  }
  writeFileSync(file, src);
}
const PACE = process.env.PACE === 'v3' ? 'v3' : 'v2';
const INIT_LP = Number(process.env.INIT_LP ?? 0);
const REALMS = (() => { const [wei = 0, shu = 0, wu = 0] = (process.env.REALMS ?? '0,0,0').split(',').map(Number); return { wei, shu, wu }; })();
const SUCC = Number(process.env.SUCC ?? 0);
const g = await import(pathToFileURL(D + '/data/gameData.mjs').href), pr = await import(pathToFileURL(D + '/data/progression.mjs').href), b = await import(pathToFileURL(D + '/lib/battle.mjs').href), sg = await import(pathToFileURL(D + '/lib/siege.mjs').href), ff = await import(pathToFileURL(D + '/data/fiefs.mjs').href), vn = await import(pathToFileURL(D + '/data/venues.mjs').href);
// 唯一取价入口（v3.1）：郡价、押金、修城、犒赏、王城价、军令上限都从这里取，和游戏同一份代码
const px = await import(pathToFileURL(D + '/lib/prices.mjs').href), dy = await import(pathToFileURL(D + '/data/dynasty.mjs').href), te = await import(pathToFileURL(D + '/data/titleEffects.mjs').href), fa = await import(pathToFileURL(D + '/data/factions.mjs').href);
// v3.2 郡牌桌特权 → 斗地主单局净期望倍率（scripts/doudizhu-partner-sim.mjs PERKS=all GAMES=20000 实测，按对手牌艺）
// 谋士献策（颍川）、良马斥候（辽东）是信息类，笨玩家用不上，不计（econ 的空白：真人会用，蜀/魏实际会略快）
const PERK_EV_TABLE = {
  nanyang: { novice: 1.2, veteran: 1.2, master: 1.2 },
  jingzhou: { novice: 1.1, veteran: 1.1, master: 1.1 },
  runan: { novice: 1.059, veteran: 1.129, master: 1.138 },
  changsha: { novice: 1.249, veteran: 1.498, master: 1.718 },
  bajun: { novice: 1.637, veteran: 1.453, master: 1.427 }
};
// 旧的按游玩日模型只用造价曲线（不吃称号）
const PRICE_DAY = { paceCurve: PACE, chronicle: [], faction: 'qun', fiefs: {} };
// 斗地主每道军令按 venues.ts 的随战力缴获与净期望（笨玩家实测系数）；DDZ=0 关掉斗地主
const DDZ = process.env.DDZ !== '0';
// 官道/江东/许都 10-15 起收起：有斗地主时军令全用在斗地主与攻郡（AUTO=1 恢复旧的自动战对照）
const DDZ_ONLY = DDZ && process.env.AUTO !== '1';
const RW = Number(process.env.RW ?? 1), CM = Number(process.env.CM ?? 1);
// v2.1 伴侣上牌桌：随行技能抬高斗地主净期望，按最坏情况（三重上限 +15%，scripts/doudizhu-partner-sim.mjs 校准）乘上；PARTNER_EV=1 是没有伴侣技能的对照
const PARTNER_EV = Number(process.env.PARTNER_EV ?? 1.15);
// v2.2 邻郡反攻：一个游玩日按一天真实时间算（48 小时间隔 = 2 日、72 小时保护/半价收复 = 3 日、没目标 6 小时后再看 ≈ 次日）
const SIEGE = process.env.SIEGE !== '0', REPAIR = process.env.REPAIR !== '0';
const DAY_MS = 24 * 3600 * 1000;
// SIEGE_GAP_DAYS / BOUNTY_RATE 只给调参对照用，默认读 siege.ts 的常量
const SIEGE_GAP = Number(process.env.SIEGE_GAP_DAYS ?? Math.round(sg.SIEGE_INTERVAL_MS / DAY_MS)), PROTECT_DAYS = Math.round(sg.FIEF_PROTECT_MS / DAY_MS), RECLAIM_DAYS = Math.round(sg.RECLAIM_WINDOW_MS / DAY_MS);
// 守城胜率：城主坐庄时用笨玩家当地主胜率（doudizhu-role-sim 2 万局：对两个生手 67.2%、两个老手 42.0%）；不坐庄时按当农民（65.7% / 58.5%）
const DEFEND_WIN = sg.DEFENSE_FORCE_LANDLORD ? { novice: 0.672, veteran: 0.42, master: 0.42 } : { novice: 0.657, veteran: 0.585, master: 0.5 };
function run(lordId, clicksPerDay) {
  const lord = g.lords.find((l) => l.id === lordId);
  let gold = 1000, home = 1, farm = 0, day = 1, partners = [g.partners.find((p) => p.bestMatchLordId === lordId) ?? g.partners[0]], weapon = g.weapons[0], owned = ['xuanjian'], claimed = new Set();
  let conquestTries = 0; let orders = 3; const holdings = {}; let wins = { land: 0, naval: 0, court: 0, frontier: 0, ddz: 0 }, income = { battle: 0, work: 0, quest: 0, ddz: 0, bounty: 0 }, spent = 0;
  // 反攻：城防、得郡日、失郡日、下次反攻日
  const walls = {}, takenDay = {}, lostDay = {}; let nextSiege = 0; const siegeStat = { sieges: 0, held: 0, fell: 0, lost: 0, repaired: 0, reclaimed: 0 }; let repairSpent = 0;
  const ms = {}; const mark = (k, d) => { if (!ms[k]) ms[k] = d; };
  for (let d = 1; d <= Number(process.env.DAYS ?? 120); d++) {
    const H = g.findHomeLevel(home), F = g.findFarmLevel(farm);
    const intel = b.calculateIntelligence(lord, partners), cha = b.calculateCharisma(lord, partners);
    for (let c = 0; c < clicksPerDay; c++) {
      day++; const inc = b.totalDailyIncome(H.dailyIncome, F.incomePercent, 0, intel, F.flatIncome, ff.fiefIncomePercent(holdings)); if (day % 2 === 0 || (process.env.ORDER_EARLY && home < 4)) orders = Math.min(ff.orderCapFor(holdings), orders + 1);
      const ev = pr.getDailyEvent(day, inc)?.goldDelta ?? 0; gold += inc + ev; income.work += inc + ev;
    }
    const power = b.calculateTotalPower(lord, partners, weapon, H);
    const st = { fiefs: holdings, resolvedPartnerEvents: {}, generation: 1, legacyPoints: 0, homeLevel: home, farmLevel: farm, ownedPartnerIds: partners.map((p) => p.id), equippedWeaponId: weapon.id, battleWins: wins.land + wins.naval + wins.court + wins.frontier, navalWins: wins.naval, courtWins: wins.court, frontierWins: wins.frontier };
    for (const q of pr.quests) if (!claimed.has(q.id) && q.isComplete(st, { totalPower: power })) { claimed.add(q.id); gold += q.rewardGold; income.quest += q.rewardGold; }
    // 军令有限：每道军令打期望收益最高的开放战场（推荐档 75% 胜，败损 20%）
    const arenas = [['land', b.matchEnemy(power)]];
    if (home >= 3) arenas.push(['naval', b.matchNavalEnemy(b.calculateNavalPower(lord, partners, H))]);
    if (home >= 4) arenas.push(['court', b.matchCourtEnemy(b.calculateCourtPower(lord, partners, H))]);
    const venue = DDZ ? [...vn.VENUES].reverse().find((v) => power >= v.requiredPower) : null;
    const ddzEv = venue ? vn.venueReward(venue, vn.venueRewardScale({ land: power, naval: b.calculateNavalPower(lord, partners, H), court: b.calculateCourtPower(lord, partners, H) }, home)) * vn.DDZ_NET_VALUE[venue.aiSkill] * PARTNER_EV : 0;
    const autoEv = (e) => 0.75 * e.rewardGold - 0.25 * e.rewardGold * b.battleLossRate(0.75);
    arenas.sort((x, y) => y[1].rewardGold - x[1].rewardGold);
    // 攻郡（10-15 起）：侯府后有军令、军资够就攻最便宜的相邻郡；押开拓价一半，胜率按守将牌艺（笨玩家实测）
    const CONQ_WIN = { novice: 0.65, veteran: 0.5, master: 0.54 };
    while (DDZ && orders > 0 && home >= 5) {
      const target = ff.nextFief(holdings, 'qun'); if (!target) break;
      const reclaim = lostDay[target.id] !== undefined && d - lostDay[target.id] < RECLAIM_DAYS;
      const stake = Math.round(px.fiefCostOf({ ...PRICE_DAY, fiefs: holdings }, target) * (reclaim ? sg.RECLAIM_STAKE_RATE : ff.CONQUEST_STAKE_RATE)); if (gold < stake) break;
      orders--; gold -= stake; spent += stake; conquestTries++;
      if (Math.random() < CONQ_WIN[target.skill]) {
        holdings[target.id] = process.env.POLICY ?? 'farming'; walls[target.id] = sg.FIEF_WALLS; takenDay[target.id] = d;
        if (lostDay[target.id] !== undefined) { siegeStat.reclaimed++; delete lostDay[target.id]; }
        if (!nextSiege) nextSiege = d + SIEGE_GAP;
        mark('fief' + ff.ownedFiefCount(holdings), d);
      }
    }
    while (orders > 0 && venue && (DDZ_ONLY || ddzEv >= autoEv(arenas[0][1]))) { orders--; const ev = Math.round(ddzEv * (0.4 + 1.2 * Math.random())); gold = Math.max(0, gold + ev); income.ddz += Math.max(0, ev); wins.ddz++; mark('ddz_' + venue.id, d); }
    while (orders > 0) { orders--; const [k, e] = arenas[0]; if (Math.random() < 0.75) { gold += Math.round(e.rewardGold * RW); income.battle += Math.round(e.rewardGold * RW); wins[k]++; } else { gold -= Math.min(gold, Math.round(e.rewardGold * b.battleLossRate(0.75))); } }
    // 邻郡反攻：侯府后、有郡、到期就起，当天应战（不耗军令、不扣金）；只打末端郡，保护期内的不打
    if (SIEGE && home >= 5 && ff.ownedFiefCount(holdings) > 0 && nextSiege && d >= nextSiege) {
      const target = sg.exposedFiefs(holdings, 'jingzhou').filter((f) => d - takenDay[f.id] >= PROTECT_DAYS).sort((x, y) => walls[x.id] - walls[y.id] || takenDay[y.id] - takenDay[x.id])[0];
      if (!target) nextSiege = d + 1;
      else {
        siegeStat.sieges++; nextSiege = d + SIEGE_GAP;
        if (Math.random() < DEFEND_WIN[sg.siegeSkill(target, holdings[target.id])]) { const bounty = process.env.BOUNTY_RATE ? Math.round(px.fiefCostOf(PRICE_DAY, target) * Number(process.env.BOUNTY_RATE)) : px.siegeBountyOf(PRICE_DAY, target); gold += bounty; income.bounty += bounty; walls[target.id] = sg.FIEF_WALLS; wins.frontier++; siegeStat.held++; }
        else if (--walls[target.id] <= 0) { delete holdings[target.id]; delete walls[target.id]; delete takenDay[target.id]; lostDay[target.id] = d; orders = Math.min(orders, ff.orderCapFor(holdings)); siegeStat.lost++; if (ff.ownedFiefCount(holdings) === 0) nextSiege = 0; }
        else siegeStat.fell++;
      }
    }
    // 花钱
    for (;;) {
      // 城防告急先修（再失手就丢郡，收复押金比修城贵得多）
      const cracked = REPAIR ? ff.fiefs.find((f) => holdings[f.id] && walls[f.id] < sg.FIEF_WALLS && gold >= sg.wallRepairCost(px.fiefListPrice(PRICE_DAY, f, PACE))) : null;
      if (cracked) { const c = sg.wallRepairCost(px.fiefListPrice(PRICE_DAY, cracked)); gold -= c; spent += c; repairSpent += c; walls[cracked.id] = sg.FIEF_WALLS; siegeStat.repaired++; continue; }
      const nh = g.homeLevels.find((h) => h.level === home + 1); const nhCost = nh ? g.homeUpgradeCost(nh.level, PACE) * CM : 0; if (nh && gold >= nhCost) { gold -= nhCost; spent += nhCost; home++; mark('home' + home, d); continue; }
      const nf = home >= 3 ? g.farmLevels.find((x) => x.level === farm + 1) : null; if (nf && gold >= nf.cost * CM) { gold -= nf.cost * CM; spent += nf.cost * CM; farm++; mark('farm' + farm, d); continue; }
      const bw = g.weapons.filter((w) => !owned.includes(w.id) && gold >= w.price).sort((x, y) => b.weaponBonusForLord(y, lordId) - b.weaponBonusForLord(x, lordId))[0];
      if (bw && b.weaponBonusForLord(bw, lordId) > b.weaponBonusForLord(weapon, lordId)) { gold -= bw.price; spent += bw.price; owned.push(bw.id); weapon = bw; mark('weapon_' + bw.rarity, d); continue; }
      const cand = g.partners.find((p) => !partners.includes(p)); const cost = cand ? b.effectiveRecruitCost(Math.round(cand.recruitCost * (1 + Number(process.env.PARTNER_STEP ?? 0) * (partners.length - 1))), cha) : Infinity; if (cand && gold >= cost) { gold -= cost; spent += cost; partners.push(cand); mark('partners' + partners.length, d); continue; }
      // DDZ=0（旧版对照）仍按开拓价直接买郡
      const nfief = !DDZ && home >= 5 ? ff.nextFief(holdings, 'qun') : null; const nfCost = nfief ? px.fiefCostOf({ ...PRICE_DAY, fiefs: holdings }, nfief) : 0; if (nfief && gold >= nfCost) { gold -= nfCost; spent += nfCost; holdings[nfief.id] = process.env.POLICY ?? 'farming'; mark('fief' + ff.ownedFiefCount(holdings), d); continue; }
      break;
    }
    if (home === 6 && farm === 5 && partners.length === 10) { mark('ALL', d); }
  }
  return { ms, gold, income, spent, wins, conquestTries, siegeStat, repairSpent };
}
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const MODE = process.env.MODE ?? 'both';
if (MODE !== 'day') await runRealtime();
if (MODE !== 'realtime' && MODE !== 'dynasty') for (const lordId of ['caocao']) for (const clicks of [5, 15]) {
  const R = []; for (let i = 0; i < 100; i++) R.push(run(lordId, clicks));
  const k = (key) => { const v = R.map((r) => r.ms[key]).filter(Boolean); return v.length === R.length ? med(v) : v.length ? `${med(v)}(${v.length}%)` : '-'; };
  const inc = R.map((r) => r.income); const tot = inc.map((i) => i.battle + i.work + i.quest + i.ddz + i.bounty);
  const share = (f) => Math.round(100 * med(inc.map((i, j) => i[f] / tot[j])));
  const shareF = (f) => (100 * med(inc.map((i, j) => i[f] / tot[j]))).toFixed(2);
  const avg = (f) => (R.reduce((sum, r) => sum + r.siegeStat[f], 0) / R.length).toFixed(1);
  console.log(`PARTNER_EV=${PARTNER_EV} RW=${RW} CM=${CM} 政务${String(clicks).padStart(2)}次/日 | 府邸4 第${k('home4')}日 | 侯府5 第${k('home5')}日 | 王城6 第${k('home6')}日 | 屯田5 第${k('farm5')}日 | 全满 第${k('ALL')}日 | 伴侣10 第${k('partners10')}日 | 封地1/3/6 第${k('fief1')}/${k('fief3')}/${k('fief6')}日 | ${process.env.DAYS ?? 120}日余金 ${Math.round(med(R.map((r) => r.gold)) / 1000)}k | 收入占比 政务${share('work')}% 斗地主${share('ddz')}% 自动战${share('battle')}% | 中/高级场 第${k('ddz_middle')}/${k('ddz_high')}日 | 攻郡 ${med(R.map((r) => r.conquestTries))} 次${SIEGE ? ` | 反攻 ${avg('sieges')} 次：守住 ${avg('held')} · 告急 ${avg('fell')} · 失郡 ${avg('lost')} · 修城 ${avg('repaired')} · 收复 ${avg('reclaimed')}（平均每局）| 犒赏占收入 ${shareF('bounty')}%，扣修城后净 ${(100 * med(R.map((r, j) => (r.income.bounty - r.repairSpent) / tot[j]))).toFixed(2)}%` : ' | 反攻关'}`);
}

// ===== v2.3 真实时间模型（MODE=realtime）=====
// 按真实小时推进，直接调 src/lib/clock.ts 的 stepDay / advanceOrders / collectTreasury（府库上限、半价溢出、48 日封顶、军令按分钟回都与游戏同一份代码）。
// 玩家按 LOGINS 表每天上线 N 次：先定夺待决事件（拿现钱，心事选第一项）→ 收取府库（积满 4 日且智谋没练满时办「治理」，否则钱粮）
// → 领任务 → 守城（反攻到期就守）→ 攻郡 → 剩下军令全打斗地主 → 花钱（修城→宅邸→屯田→兵器→伴侣）。
// 环境变量：LOGINS=1,2,3,6（每天上线次数，可多选）REAL_DAYS=30 RUNS=100 TRAIN=0 不练属性
async function runRealtime() {
  const ck = await import(pathToFileURL(D + '/lib/clock.mjs').href), st = await import(pathToFileURL(D + '/lib/storage.mjs').href), pe = await import(pathToFileURL(D + '/data/partnerEvents.mjs').href), me = await import(pathToFileURL(D + '/data/minorEvents.mjs').href);
  const DYNASTY = process.env.MODE === 'dynasty';
  const HOUR = 3600e3, REAL_DAYS = Number(process.env.REAL_DAYS ?? (DYNASTY ? 60 : 30)), RUNS = Number(process.env.RUNS ?? 100), TRAIN = process.env.TRAIN !== '0';
  // 上线时刻（点钟）：1 次晚上 21 点；3 次早中晚；6 次白天每 2~4 小时
  const SCHEDULE = { 1: [21], 2: [12, 21], 3: [8, 13, 21], 4: [8, 12, 17, 21], 6: [8, 10, 12, 14, 18, 22] };
  const CONQ_WIN = { novice: 0.65, veteran: 0.5, master: 0.54 };
  const PROTECT_H = sg.FIEF_PROTECT_MS / HOUR, RECLAIM_H = sg.RECLAIM_WINDOW_MS / HOUR, SIEGE_GAP_H = sg.SIEGE_INTERVAL_MS / HOUR;
  const lordId = process.env.LORD ?? 'caocao';
  const lord = g.lords.find((l) => l.id === lordId);
  // v3.2 势力：FACTION=qun|wei|shu|wu（逗号分隔 = DYNASTIES 串跑时各朝依次取）ANCESTRAL=魏,蜀,吴 冻结的前朝国号遗泽 BEQUESTS=treasury,veterans,homeland,keeper 本朝遗泽
  //   PREV_LP=上一朝家业点（府库遗泽按它折金，缺省 10）OLD_COMP=1 老档一次性开国金补发 DYNASTIES=k 串跑 k 朝（MODE=dynasty）PERKS=0 关掉郡特权系数
  const FACTION_SEQ = (process.env.FACTION ?? 'qun').split(',');
  const ANCESTRAL = (() => { const [wei = 0, shu = 0, wu = 0] = (process.env.ANCESTRAL ?? '0,0,0').split(',').map(Number); return { wei, shu, wu }; })();
  const BEQ = (process.env.BEQUESTS ?? '').split(',').filter(Boolean);
  const PREV_LP = Number(process.env.PREV_LP ?? 10);
  const DYN_COUNT = Math.max(1, Number(process.env.DYNASTIES ?? 1));
  // 郡牌桌特权对斗地主单局净期望的倍率（scripts/doudizhu-partner-sim.mjs PERKS=all，笨玩家 2 万局实测；信息类特权笨玩家用不上记 1）
  const PERK_EV = process.env.PERKS === '0' ? {} : PERK_EV_TABLE;
  const perkScale = (st, aiSkill) => sg.activePerkIds(st).reduce((m, id) => m * (PERK_EV[id]?.[aiSkill] ?? 1), 1);
  // REALMS：历朝国号（第 N 朝开局）—— 按朝数补记家声（天下归心、再造山河、三朝元老、三分归一）；v3.2 起开国金固定 2 万、国号效果按 ANCESTRAL + 本朝一份
  const dynasties = REALMS.wei + REALMS.shu + REALMS.wu;
  const earnedFor = (count, realms) => [...(count > 0 ? ['unifier', 'restorer'] : []), ...(count > 1 ? ['three-dynasties'] : []), ...(realms.wei && realms.shu && realms.wu ? ['three-realms'] : [])];
  function run(logins, cfg = {}) {
    const factionId = cfg.faction ?? FACTION_SEQ[0];
    const faction = fa.FACTIONS[factionId];
    const realms = cfg.realms ?? REALMS;
    const count = realms.wei + realms.shu + realms.wu;
    const bequests = cfg.bequests ?? BEQ;
    const startPartner = (g.partners.find((p) => p.bestMatchLordId === lordId) ?? g.partners[0]).id;
    // 留贤：多带一位伴侣（不算心事加成，偏保守）
    const keptPartner = bequests.includes('keeper') ? g.partners.find((p) => p.id !== startPartner).id : null;
    let s = { ...st.defaultGameState, screen: 'home', selectedLordId: lordId, ownedPartnerIds: [startPartner, ...(keptPartner ? [keptPartner] : [])], clockAt: 0, orderClockAt: 0, foundedAt: 0, eventLog: [], paceCurve: PACE, legacyPoints: INIT_LP, realms, pastDynasties: Array.from({ length: count }, (_v, i) => ({ dynasty: i + 1, realm: null, generations: 1, days: 1, wins: 0, ambitions: 0 })), earnedTitles: earnedFor(count, realms), faction: factionId, seat: faction.seat, realm: faction.realm, ancestralRealms: cfg.ancestral ?? ANCESTRAL, bequests };
    // 开国金：新档 1,000；第二朝起 1,000 + 2 万 + 府库遗泽（上一朝家业点 × 1 万，封顶 20 万）+ 老档补发
    const treasury = bequests.includes('treasury') ? fa.treasuryBequestGold(cfg.prevLp ?? PREV_LP) : 0;
    s = { ...s, gold: s.gold + (count > 0 ? dy.DYNASTY_START_GOLD + treasury : 0) + (process.env.OLD_COMP === '1' ? Math.max(0, count - 1) * dy.DYNASTY_START_GOLD : 0) };
    // 天下归心 / 遗泽旧部：每朝开局军令满
    if (te.titleBonuses(s).dynastyFullOrders || bequests.includes('veterans')) s = { ...s, orders: px.orderCapOf(s) };
    const owned = ['xuanjian']; const claimed = new Set();
    const walls = {}, takenAt = {}, lostAt = {}; let nextSiege = 0; const siegeStat = { sieges: 0, held: 0, lost: 0 };
    const income = { work: 0, fold: 0, ddz: 0, quest: 0, bounty: 0, event: 0 }; let foldPending = 0; const ms = {}; const mark = (k, h) => { if (ms[k] === undefined) ms[k] = +(h / 24).toFixed(1); };
    let games = 0, overflowDays = 0, cappedLogins = 0, collects = 0, successions = 0, lastSucc = -1e9, succGold = 0;
    const gamesByDay = new Array(REAL_DAYS).fill(0);
    outer: for (let day = 0; day < REAL_DAYS; day++) for (const hourOfDay of SCHEDULE[logins]) {
      const h = day * 24 + hourOfDay; const now = h * HOUR;
      // 府库里的钱分两笔记：政务收入（work）与自动折现进库的府中事件（fold：乡望、被顶掉/自动结算的二选一与小事）
      const adv = ck.advanceClock(s, now); foldPending += adv.tally.eventGold;
      s = ck.advanceOrders(adv.state, now);
      // 待决事件：二选一拿现钱，小事拿现钱，心事选第一项（加成照给）
      if (s.pendingChoice) {
        const p = s.pendingChoice;
        if (p.eventId.startsWith('partner:')) {
          const key = p.eventId.slice(8); const ev = pe.findPartnerEvent(key); const pid = pe.partnerIdOfKey(key); const boost = ev?.options[0].boost ?? {};
          const cur = s.partnerBoosts[pid] ?? {};
          s = { ...s, resolvedPartnerEvents: { ...s.resolvedPartnerEvents, [key]: 'a' }, partnerBoosts: { ...s.partnerBoosts, [pid]: { strength: (cur.strength ?? 0) + (boost.strength ?? 0) || undefined, intelligence: (cur.intelligence ?? 0) + (boost.intelligence ?? 0) || undefined, charisma: (cur.charisma ?? 0) + (boost.charisma ?? 0) || undefined } } };
        } else {
          const gold = p.eventId.startsWith('minor:') ? me.minorGoldValue(p.dailyIncome) : pr.choiceGoldValue(pr.getChoiceEvent(p.day, p.dailyIncome), p.dailyIncome);
          s = { ...s, gold: s.gold + gold }; income.event += gold;
        }
        s = { ...s, pendingChoice: null };
      }
      // 收取府库
      const cap = ck.treasuryCapDays(s.homeLevel);
      if (s.treasury.days > cap) { overflowDays += s.treasury.days - cap; cappedLogins++; }
      if (s.treasury.days > 0 || s.treasury.gold > 0) {
        const kind = TRAIN && s.treasury.days >= ck.TRAIN_MIN_DAYS && s.affairTraining.civil < 15 ? 'civil' : 'treasury';
        const before = s.gold; s = ck.collectTreasury(s, kind); const got = s.gold - before; const fold = Math.min(got, foldPending); income.fold += fold; income.work += got - fold; foldPending = 0; collects++;
      }
      const partners = g.partners.filter((p) => s.ownedPartnerIds.includes(p.id)).map((p) => pe.mergePartnerBoost(p, s.partnerBoosts[p.id]));
      const weapon = g.weapons.find((w) => w.id === s.equippedWeaponId);
      const H = g.findHomeLevel(s.homeLevel);
      const extra = px.statBonusOf(s);
      const power = b.calculateTotalPower(lord, partners, weapon, H, extra + s.affairTraining.strength);
      const qs = { fiefs: s.fiefs, resolvedPartnerEvents: s.resolvedPartnerEvents, generation: s.generation, legacyPoints: s.legacyPoints, homeLevel: s.homeLevel, farmLevel: s.farmLevel, ownedPartnerIds: s.ownedPartnerIds, equippedWeaponId: s.equippedWeaponId, battleWins: s.battleWins, navalWins: 0, courtWins: 0, frontierWins: s.frontierWins };
      for (const q of pr.quests) if (!claimed.has(q.id) && q.isComplete(qs, { totalPower: power })) { claimed.add(q.id); s = { ...s, gold: s.gold + q.rewardGold }; income.quest += q.rewardGold; }
      // 邻郡反攻：上线时到期就守（守城不耗军令）
      if (s.homeLevel >= 5 && ff.ownedFiefCount(s.fiefs) > 0 && nextSiege && h >= nextSiege) {
        const target = sg.exposedFiefs(s.fiefs, s.seat).filter((f) => h - takenAt[f.id] >= PROTECT_H).sort((x, y) => walls[x.id] - walls[y.id] || takenAt[y.id] - takenAt[x.id])[0];
        if (!target) nextSiege = h + 6;
        else {
          siegeStat.sieges++; nextSiege = h + SIEGE_GAP_H;
          if (Math.random() < DEFEND_WIN[sg.siegeSkill(target, s.fiefs[target.id])]) { const bounty = px.siegeBountyOf(s, target); s = { ...s, gold: s.gold + bounty, frontierWins: s.frontierWins + 1, battleWins: s.battleWins + 1 }; income.bounty += bounty; walls[target.id] = sg.FIEF_WALLS; siegeStat.held++; }
          else if (--walls[target.id] <= 0) { const fiefs = { ...s.fiefs }; delete fiefs[target.id]; delete walls[target.id]; lostAt[target.id] = h; s = { ...s, fiefs, orders: Math.min(s.orders, px.orderCapOf({ ...s, fiefs })) }; siegeStat.lost++; if (ff.ownedFiefCount(fiefs) === 0) nextSiege = 0; }
        }
      }
      // 攻郡：押金走 conquestStakeOf（造价曲线、侯门显贵、国号魏、再造山河的收复价）
      while (s.orders > 0 && s.homeLevel >= 5) {
        const target = ff.nextFief(s.fiefs, s.faction); if (!target) break;
        const lostFiefs = Object.fromEntries(Object.entries(lostAt).filter(([id]) => !s.fiefs[id]).map(([id, at]) => [id, at * HOUR]));
        const stake = px.conquestStakeOf({ ...s, lostFiefs }, target, now); if (s.gold < stake) break;
        s = { ...s, orders: s.orders - 1, gold: s.gold - stake }; gamesByDay[day]++; games++;
        if (Math.random() < CONQ_WIN[target.skill]) { s = { ...s, fiefs: { ...s.fiefs, [target.id]: process.env.POLICY ?? 'farming' }, battleWins: s.battleWins + 1 }; s = { ...s, peakFiefs: Math.max(s.peakFiefs, ff.ownedFiefCount(s.fiefs)) }; walls[target.id] = sg.FIEF_WALLS; takenAt[target.id] = h; delete lostAt[target.id]; if (!nextSiege) nextSiege = h + SIEGE_GAP_H; mark('fief' + ff.ownedFiefCount(s.fiefs), h); }
      }
      // 斗地主：国号吴、百战之将与缴获同一乘点
      const venue = [...vn.VENUES].reverse().find((v) => power >= v.requiredPower);
      const ddzEv = vn.venueReward(venue, vn.venueRewardScale({ land: power, naval: b.calculateNavalPower(lord, partners, H), court: b.calculateCourtPower(lord, partners, H) }, s.homeLevel)) * vn.DDZ_NET_VALUE[venue.aiSkill] * PARTNER_EV * dy.realmRewardScale(dy.effectiveRealms(s), 'doudizhu') * px.titleDdzScale(s) * perkScale({ fiefs: s.fiefs, fiefWalls: walls, faction: s.faction }, venue.aiSkill);
      while (s.orders > 0) { const ev = Math.round(ddzEv * (0.4 + 1.2 * Math.random())); s = { ...s, orders: s.orders - 1, gold: Math.max(0, s.gold + ev), battleWins: s.battleWins + 1 }; income.ddz += Math.max(0, ev); games++; gamesByDay[day]++; }
      // 花钱
      for (;;) {
        const cracked = ff.fiefs.find((f) => s.fiefs[f.id] && walls[f.id] < sg.FIEF_WALLS && s.gold >= px.wallRepairCostOf(s, f));
        if (cracked) { s = { ...s, gold: s.gold - px.wallRepairCostOf(s, cracked) }; walls[cracked.id] = sg.FIEF_WALLS; continue; }
        const nh = g.homeLevels.find((x) => x.level === s.homeLevel + 1); const nhCost = nh ? px.homeUpgradeCostOf(s, nh.level) : 0; if (nh && s.gold >= nhCost) { s = { ...s, gold: s.gold - nhCost, homeLevel: nh.level }; mark('home' + nh.level, h); continue; }
        const nf = s.homeLevel >= 3 ? g.farmLevels.find((x) => x.level === s.farmLevel + 1) : null; const nfCost = nf ? dy.realmFarmCost(dy.effectiveRealms(s), nf.cost) : 0; if (nf && s.gold >= nfCost) { s = { ...s, gold: s.gold - nfCost, farmLevel: nf.level }; mark('farm' + nf.level, h); continue; }
        const bw = g.weapons.filter((w) => !owned.includes(w.id) && s.gold >= w.price).sort((x, y) => b.weaponBonusForLord(y, lordId) - b.weaponBonusForLord(x, lordId))[0];
        if (bw && b.weaponBonusForLord(bw, lordId) > b.weaponBonusForLord(weapon, lordId)) { s = { ...s, gold: s.gold - bw.price, equippedWeaponId: bw.id }; owned.push(bw.id); continue; }
        const cand = g.partners.find((p) => !s.ownedPartnerIds.includes(p.id)); const cost = cand ? b.effectiveRecruitCost(cand.recruitCost, b.calculateCharisma(lord, partners, extra + s.affairTraining.civil)) : Infinity;
        if (cand && s.gold >= cost) { s = { ...s, gold: s.gold - cost, ownedPartnerIds: [...s.ownedPartnerIds, cand.id] }; mark('partners' + s.ownedPartnerIds.length, h); continue; }
        break;
      }
      // 传位（SUCC 次/朝）：到王城、能折到 1 点、离上次传位满 1 天，就按递增价把能折的都折了（不重置宅邸封地，只清政务练出的属性）
      if (successions < SUCC && s.homeLevel >= 6 && h - lastSucc >= 24 && !dy.isEndingReached(s)) {
        const gained = b.legacyPointsGainable(s.gold, s.legacyPoints, 1);
        if (gained >= 1) {
          const spend = b.legacyPointsSpend(s.legacyPoints, gained, 1);
          s = { ...s, gold: s.gold - spend, legacyPoints: s.legacyPoints + gained, generation: s.generation + 1, affairTraining: { strength: 0, civil: 0 } };
          successions++; lastSucc = h; succGold += spend; mark('succ' + successions, h);
        }
      }
      if (dy.isEndingReached(s)) { mark('unify', h); if (DYNASTY) break outer; }
    }
    return { ms, s, income, games, gamesByDay, overflowDays, cappedLogins, collects, siegeStat, successions, succGold };
  }
  const pct = (arr, q) => { const v = [...arr].sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(q * v.length))] : NaN; };
  const priceState = { paceCurve: PACE, faction: FACTION_SEQ[0] };
  console.log(`真实时间（v2.3）：1 小时 = 1 日，府库上限 ${[1, 2, 3, 4, 5, 6].map((l) => ck.treasuryCapDays(l)).join('/')} 日（超出半价、封顶 ${ck.TREASURY_HARD_CAP_DAYS}），军令 ${ck.ORDER_MS_EARLY / 60000}/${ck.ORDER_MS_LATE / 60000} 分一道、上限 ${ff.orderCapFor({})}，收入系数 ${ck.REALTIME_INCOME_FACTOR}，伴侣技能 ×${PARTNER_EV}，${REAL_DAYS} 真实天 × ${RUNS} 局 | PACE=${PACE} 势力 ${FACTION_SEQ.join('→')} 王城 ${px.homeUpgradeCostOf(priceState, 6).toLocaleString()} 郡价 ${px.factionCurve(priceState).map((c) => c / 10000).join('/')} 万（${fa.FACTIONS[FACTION_SEQ[0]].ladder.join('→')}） | TITLES=${te.TITLES_ENABLED ? 1 : 0} SUCC=${SUCC} INIT_LP=${INIT_LP} REALMS=${REALMS.wei},${REALMS.shu},${REALMS.wu} ANCESTRAL=${ANCESTRAL.wei},${ANCESTRAL.shu},${ANCESTRAL.wu} BEQUESTS=${BEQ.join(',') || '-'} 郡特权系数 ${process.env.PERKS === '0' ? '关' : '开'}${DYNASTY ? ` | MODE=dynasty 跑到统一即停${DYN_COUNT > 1 ? ` · 串跑 ${DYN_COUNT} 朝` : ''}` : ''}`);
  // DYNASTIES=k：从 FACTION 第一项起整朝串跑 k 朝，每朝统一后按开新朝规则重来（国号计数 +1、家声补记、遗泽 BEQUESTS 从第二朝起、府库按上一朝家业点）
  if (DYNASTY && DYN_COUNT > 1) {
    for (const logins of (process.env.LOGINS ?? '1,3,6').split(',').map(Number)) {
      const per = Array.from({ length: DYN_COUNT }, () => []);
      for (let i = 0; i < RUNS; i++) {
        let realms = { ...REALMS }; let prevLp = INIT_LP;
        for (let d = 0; d < DYN_COUNT; d++) {
          const faction = FACTION_SEQ[Math.min(d, FACTION_SEQ.length - 1)];
          if (d > 0 && fa.FACTIONS[faction].realm) realms = { ...realms, [fa.FACTIONS[faction].realm]: realms[fa.FACTIONS[faction].realm] + 1 };
          const r = run(logins, { faction, realms, bequests: d > 0 ? BEQ : [], prevLp });
          per[d].push(r.ms.unify ?? REAL_DAYS + 1);
          prevLp = r.s.legacyPoints;
        }
      }
      const p50 = per.map((v) => pct(v, 0.5));
      console.log(`串跑 上线 ${logins} 次/天 | 各朝统一 P50 ${p50.join(' / ')} 天 | 相对第 1 朝 ${p50.map((v) => `${v >= p50[0] ? '+' : ''}${Math.round((v / p50[0] - 1) * 100)}%`).join(' / ')}`);
    }
    return;
  }
  for (const logins of (process.env.LOGINS ?? '1,2,3,6').split(',').map(Number)) {
    const R = []; for (let i = 0; i < RUNS; i++) R.push(run(logins));
    const k = (key) => { const v = R.map((r) => r.ms[key]).filter((x) => x !== undefined); return v.length === R.length ? med(v) : v.length ? `${med(v)}(${v.length}%)` : '-'; };
    const tot = R.map((r) => r.income.work + r.income.fold + r.income.ddz + r.income.quest + r.income.bounty + r.income.event);
    const shSum = (fs) => Math.round(100 * med(R.map((r, j) => fs.reduce((a, f) => a + r.income[f], 0) / tot[j])));
    const sh = (f) => Math.round(100 * med(R.map((r, j) => r.income[f] / tot[j])));
    const six = R.filter((r) => r.ms.fief6 !== undefined).length;
    const in40 = R.filter((r) => r.ms.fief6 !== undefined && r.ms.fief6 <= 40).length;
    const unify = R.map((r) => r.ms.unify).filter((x) => x !== undefined);
    const gamesPerDay = med(R.map((r) => r.games / (DYNASTY && r.ms.unify ? Math.max(1, r.ms.unify) : REAL_DAYS))).toFixed(1);
    const lateGames = med(R.map((r) => r.gamesByDay.slice(-10).reduce((a, x) => a + x, 0) / 10)).toFixed(1);
    console.log(`上线 ${logins} 次/天 | 府邸 ${k('home4')} 侯府 ${k('home5')} 王城 ${k('home6')} 天 | 封地 1/3/6 郡 ${k('fief1')}/${k('fief3')}/${k('fief6')} 天 · ${REAL_DAYS} 天六郡 ${Math.round((100 * six) / RUNS)}%${REAL_DAYS >= 40 ? `（40 天内 ${Math.round((100 * in40) / RUNS)}%）` : ''} | 统一 P25/P50/P75 ${unify.length ? `${pct(unify, 0.25)}/${pct(unify, 0.5)}/${pct(unify, 0.75)}` : '-'} 天（${Math.round((100 * unify.length) / RUNS)}%） | 传位 ${med(R.map((r) => r.successions))} 次、家业点 ${med(R.map((r) => r.s.legacyPoints))} | 期末存金 ${Math.round(med(R.map((r) => r.s.gold)) / 1000)}k | 牌局 ${gamesPerDay} 局/天（后 10 天 ${lateGames}） | 收入占比 纯政务${sh('work')}% 府中折现${sh('fold')}% 手动事件${sh('event')}% 斗地主${sh('ddz')}% 任务${sh('quest')}%（政务+折现 ${shSum(['work', 'fold'])}%，政务+全部事件 ${shSum(['work', 'fold', 'event'])}%） | 府库溢出 ${med(R.map((r) => r.overflowDays))} 日、满额回来 ${med(R.map((r) => r.cappedLogins))} 次 | 第 ${med(R.map((r) => r.s.day))} 日`);
  }
}
