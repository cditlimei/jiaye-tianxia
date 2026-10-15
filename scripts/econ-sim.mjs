// 经济节奏模拟：四个战场 + 屯田 + 兵器 + 封地。每个游玩日：N 次政务、每道军令打期望最高的战场（75% 胜）、边患到期必打，花钱优先级 宅邸→屯田→兵器→伴侣→封地
// 用法: node scripts/econ-sim.mjs   环境变量 DAYS=240 POLICY=military|schooling RW=缴获倍率 CM=造价倍率；新系统/调数值前先跑一遍
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'; import { createRequire } from 'node:module'; import { pathToFileURL, fileURLToPath } from 'node:url'; import { join, dirname } from 'node:path'; import { tmpdir } from 'node:os';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); const require = createRequire(join(ROOT, 'package.json')); const ts = require('typescript');
const D = mkdtempSync(join(tmpdir(), 'jiaye-econ-')); mkdirSync(D + '/data', { recursive: true }); mkdirSync(D + '/lib', { recursive: true });
const tr = (src, dst) => writeFileSync(dst, ts.transpileModule(readFileSync(src, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from '(\.\.?\/[^']+)'/g, "from '$1.mjs'"));
// 整个 data/ 与 lib/ 都转译，新增模块不用回来改清单（曾因清单写死、新模块缺失整条命令跑不起来）
const { readdirSync } = await import('node:fs');
const modules = ['types', ...['data', 'lib'].flatMap((dir) => readdirSync(join(ROOT, 'src', dir)).filter((name) => name.endsWith('.ts')).map((name) => `${dir}/${name.slice(0, -3)}`))];
for (const f of modules) tr(join(ROOT, `src/${f}.ts`), `${D}/${f}.mjs`);
const g = await import(pathToFileURL(D + '/data/gameData.mjs').href), pr = await import(pathToFileURL(D + '/data/progression.mjs').href), b = await import(pathToFileURL(D + '/lib/battle.mjs').href), fr = await import(pathToFileURL(D + '/lib/frontier.mjs').href), ff = await import(pathToFileURL(D + '/data/fiefs.mjs').href), vn = await import(pathToFileURL(D + '/data/venues.mjs').href);
// 斗地主每道军令按 venues.ts 的随战力缴获与净期望（笨玩家实测系数）；DDZ=0 关掉斗地主
const DDZ = process.env.DDZ !== '0';
const RW = Number(process.env.RW ?? 1), CM = Number(process.env.CM ?? 1);
function run(lordId, clicksPerDay) {
  const lord = g.lords.find((l) => l.id === lordId);
  let gold = 1000, home = 1, farm = 0, day = 1, partners = [g.partners.find((p) => p.bestMatchLordId === lordId) ?? g.partners[0]], weapon = g.weapons[0], owned = ['xuanjian'], claimed = new Set();
  let orders = 3; const holdings = {}; let raid = null, nextRaid = 10, wins = { land: 0, naval: 0, court: 0, frontier: 0, ddz: 0 }, lostRaids = 0, income = { battle: 0, work: 0, quest: 0, ddz: 0 }, spent = 0;
  const ms = {}; const mark = (k, d) => { if (!ms[k]) ms[k] = d; };
  for (let d = 1; d <= Number(process.env.DAYS ?? 120); d++) {
    const H = g.findHomeLevel(home), F = g.findFarmLevel(farm);
    const intel = b.calculateIntelligence(lord, partners), cha = b.calculateCharisma(lord, partners);
    for (let c = 0; c < clicksPerDay; c++) {
      day++; const inc = b.totalDailyIncome(H.dailyIncome, F.incomePercent, 0, intel, F.flatIncome, ff.fiefIncomePercent(holdings)); if (day % 2 === 0 || (process.env.ORDER_EARLY && home < 4)) orders = Math.min(ff.orderCapFor(holdings), orders + 1);
      const ev = pr.getDailyEvent(day, inc)?.goldDelta ?? 0; gold += inc + ev; income.work += inc + ev;
      const f = fr.advanceFrontier({ gold, homeLevel: home, frontierRaid: raid, nextRaidDay: nextRaid }, day);
      if (f.goldDelta < 0) { lostRaids++; } gold += f.goldDelta; raid = f.frontierRaid; nextRaid = f.nextRaidDay;
    }
    const power = b.calculateTotalPower(lord, partners, weapon, H);
    const st = { fiefs: holdings, resolvedPartnerEvents: {}, generation: 1, legacyPoints: 0, homeLevel: home, farmLevel: farm, ownedPartnerIds: partners.map((p) => p.id), equippedWeaponId: weapon.id, battleWins: wins.land + wins.naval + wins.court + wins.frontier, navalWins: wins.naval, courtWins: wins.court, frontierWins: wins.frontier };
    for (const q of pr.quests) if (!claimed.has(q.id) && q.isComplete(st, { totalPower: power })) { claimed.add(q.id); gold += q.rewardGold; income.quest += q.rewardGold; }
    // 军令有限：每道军令打期望收益最高的开放战场（推荐档 75% 胜，败损 20%）
    const arenas = [['land', b.matchEnemy(power)]];
    if (home >= 3) arenas.push(['naval', b.matchNavalEnemy(b.calculateNavalPower(lord, partners, H))]);
    if (home >= 4) arenas.push(['court', b.matchCourtEnemy(b.calculateCourtPower(lord, partners, H))]);
    const venue = DDZ ? [...vn.VENUES].reverse().find((v) => power >= v.requiredPower) : null;
    const ddzEv = venue ? vn.venueReward(venue, vn.venueRewardScale({ land: power, naval: b.calculateNavalPower(lord, partners, H), court: b.calculateCourtPower(lord, partners, H) }, home)) * vn.DDZ_NET_VALUE[venue.aiSkill] : 0;
    const autoEv = (e) => 0.75 * e.rewardGold - 0.25 * e.rewardGold * b.battleLossRate(0.75);
    arenas.sort((x, y) => y[1].rewardGold - x[1].rewardGold);
    while (orders > 0 && venue && ddzEv >= autoEv(arenas[0][1])) { orders--; const ev = Math.round(ddzEv * (0.4 + 1.2 * Math.random())); gold = Math.max(0, gold + ev); income.ddz += Math.max(0, ev); wins.ddz++; mark('ddz_' + venue.id, d); }
    while (orders > 0) { orders--; const [k, e] = arenas[0]; if (Math.random() < 0.75) { gold += Math.round(e.rewardGold * RW); income.battle += Math.round(e.rewardGold * RW); wins[k]++; } else { gold -= Math.min(gold, Math.round(e.rewardGold * b.battleLossRate(0.75))); } }
    if (raid) { const e = b.matchFrontierEnemy(power); if (Math.random() < 0.75) { gold += e.rewardGold; income.battle += e.rewardGold; wins.frontier++; } else { gold -= fr.raidPenalty(gold); } raid = null; nextRaid = day + 10; }
    // 花钱
    for (;;) {
      const nh = g.homeLevels.find((h) => h.level === home + 1); if (nh && gold >= nh.upgradeCost * CM) { gold -= nh.upgradeCost * CM; spent += nh.upgradeCost * CM; home++; mark('home' + home, d); continue; }
      const nf = home >= 3 ? g.farmLevels.find((x) => x.level === farm + 1) : null; if (nf && gold >= nf.cost * CM) { gold -= nf.cost * CM; spent += nf.cost * CM; farm++; mark('farm' + farm, d); continue; }
      const bw = g.weapons.filter((w) => !owned.includes(w.id) && gold >= w.price).sort((x, y) => b.weaponBonusForLord(y, lordId) - b.weaponBonusForLord(x, lordId))[0];
      if (bw && b.weaponBonusForLord(bw, lordId) > b.weaponBonusForLord(weapon, lordId)) { gold -= bw.price; spent += bw.price; owned.push(bw.id); weapon = bw; mark('weapon_' + bw.rarity, d); continue; }
      const cand = g.partners.find((p) => !partners.includes(p)); const cost = cand ? b.effectiveRecruitCost(Math.round(cand.recruitCost * (1 + Number(process.env.PARTNER_STEP ?? 0) * (partners.length - 1))), cha) : Infinity; if (cand && gold >= cost) { gold -= cost; spent += cost; partners.push(cand); mark('partners' + partners.length, d); continue; }
      const nfief = home >= 5 ? ff.nextFief(holdings) : null; if (nfief && gold >= nfief.cost) { gold -= nfief.cost; spent += nfief.cost; holdings[nfief.id] = process.env.POLICY ?? 'farming'; mark('fief' + ff.ownedFiefCount(holdings), d); continue; }
      break;
    }
    if (home === 6 && farm === 5 && partners.length === 10) { mark('ALL', d); }
  }
  return { ms, gold, income, spent, lostRaids, wins };
}
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
for (const lordId of ['caocao']) for (const clicks of [5, 15]) {
  const R = []; for (let i = 0; i < 100; i++) R.push(run(lordId, clicks));
  const k = (key) => { const v = R.map((r) => r.ms[key]).filter(Boolean); return v.length === R.length ? med(v) : v.length ? `${med(v)}(${v.length}%)` : '-'; };
  const inc = R.map((r) => r.income); const tot = inc.map((i) => i.battle + i.work + i.quest + i.ddz);
  const share = (f) => Math.round(100 * med(inc.map((i, j) => i[f] / tot[j])));
  console.log(`RW=${RW} CM=${CM} 政务${String(clicks).padStart(2)}次/日 | 府邸4 第${k('home4')}日 | 侯府5 第${k('home5')}日 | 王城6 第${k('home6')}日 | 屯田5 第${k('farm5')}日 | 全满 第${k('ALL')}日 | 伴侣10 第${k('partners10')}日 | 封地1/3/6 第${k('fief1')}/${k('fief3')}/${k('fief6')}日 | ${process.env.DAYS ?? 120}日余金 ${Math.round(med(R.map((r) => r.gold)) / 1000)}k | 收入占比 政务${share('work')}% 斗地主${share('ddz')}% 自动战${share('battle')}% | 中/高级场 第${k('ddz_middle')}/${k('ddz_high')}日`);
}
