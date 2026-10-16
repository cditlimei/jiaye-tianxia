/**
 * 伴侣技能强度校准：笨玩家（永远出最小可出牌、按牌力叫地主）带某位伴侣打 N 局，
 * 与同一副牌（同种子）不带伴侣比较单局净期望，输出倍率。合格线：三重不超过 +15%（超了降 partnerSkills.ts 的 values）。
 * 信息类技能（貂蝉、大乔、蔡文姬、步练师）笨玩家用不上，不在这里算，靠实玩判断。
 * 用法: node scripts/doudizhu-partner-sim.mjs            全部数值类技能 × 三级 × 三档场次
 *       SKILL=zhurong LV=3 SKILLS_AI=veteran GAMES=20000 node scripts/doudizhu-partner-sim.mjs
 * v3.2 郡的牌桌特权校准（给 econ 的势力节奏用）：PERKS=all node scripts/doudizhu-partner-sim.mjs
 *       逐个特权（不带伴侣）算单局净期望倍率：帝乡沃土/荆襄九郡（缴获 +20%/+10%，输付按缴获同比）、门生故吏（失手减半）、
 *       兵源充沛（农民赢拿全份）、盐铁之利（赢牌倍数至少 ×2）；谋士献策、良马斥候是信息类，笨玩家用不上，记 1.0
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'package.json'));
const ts = require('typescript');
const D = mkdtempSync(join(tmpdir(), 'jiaye-partner-'));
for (const dir of ['data', 'lib']) mkdirSync(join(D, dir), { recursive: true });
const tr = (src, dst) => writeFileSync(dst, ts.transpileModule(readFileSync(src, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from '(\.\.?\/[^']+)'/g, "from '$1.mjs'"));
const modules = ['types', ...['data', 'lib'].flatMap((dir) => readdirSync(join(ROOT, 'src', dir)).filter((n) => n.endsWith('.ts')).map((n) => `${dir}/${n.slice(0, -3)}`))];
for (const f of modules) tr(join(ROOT, `src/${f}.ts`), `${D}/${f}.mjs`);
const ddz = await import(pathToFileURL(`${D}/lib/doudizhu.mjs`).href);
const ps = await import(pathToFileURL(`${D}/data/partnerSkills.mjs`).href);

const GAMES = Number(process.env.GAMES ?? 20000);
const NUMERIC = ['zhenji', 'huangyueying', 'xiaoqiao', 'sunshangxiang', 'mifuren', 'zhurong'];
const SKILL_LIST = process.env.SKILL ? process.env.SKILL.split(',') : NUMERIC;
const LEVELS = process.env.LV ? process.env.LV.split(',').map(Number) : [1, 2, 3];
const AI_SKILLS = (process.env.SKILLS_AI ?? 'novice,veteran,master').split(',');
const MAX = 8;
const LOSS_RATE = 0.2;
const next = (p) => (p + 1) % 3;
// 赤壁的笨玩家策略：默认能加倍就加倍；XQ_POLICY=landlord 只在当地主时加倍（三重也不当农民加倍），XQ_T=牌力门槛
const XQ_T = Number(process.env.XQ_T ?? 0);
const XQ_POLICY = process.env.XQ_POLICY ?? 'always';
// 加倍后失手的付款倍数（相对平时两成）；默认取 partnerSkills 的 XIAOQIAO_LOSS_RATE
const XQ_D = Number(process.env.XQ_D ?? ps.XIAOQIAO_LOSS_RATE * 2);
const SSX = process.env.SSX ? process.env.SSX.split(',').map(Number) : null;
const LONG = new Set(['straight', 'pair-straight', 'airplane', 'airplane-one', 'airplane-pair']);

/** 与 DouDizhuGame.aiWantsLandlord 同一估牌力 */
function handScore(hand) {
  const counts = new Map();
  for (const c of hand) counts.set(c.value, (counts.get(c.value) ?? 0) + 1);
  const bombs = [...counts.values()].filter((n) => n === 4).length;
  return (counts.get(17) ? 3 : 0) + (counts.get(16) ? 2 : 0) + (counts.get(15) ?? 0) * 2 + (counts.get(14) ?? 0) + bombs * 4;
}
const wants = (hand, skill, contested) => handScore(hand) >= (skill === 'master' ? 7 : skill === 'novice' ? 9 : 8) + (contested ? 2 : 0);

function deal(rand) {
  const d = ddz.createDoudizhuDeal(rand);
  const kitty = new Set(d.landlordCards.map((c) => c.id));
  return { hands: { 0: d.hands[0].filter((c) => !kitty.has(c.id)), 1: d.hands[1], 2: d.hands[2] }, kitty: d.landlordCards };
}

/** 一局：返回以场次缴获为 1 的净收益，以及技能触发信息 */
function playGame(seed, aiSkill, escort, perks = []) {
  const rand = ddz.seededRandom(seed);
  const id = escort?.id ?? null;
  const lv = escort?.level ?? 0;
  const sk = id ? ps.partnerSkills[id] : null;
  let usesLeft = sk ? sk.uses[lv - 1] : 0;
  let t = deal(rand);
  let redeals = 0;
  // —— 叫地主 ——
  for (let guard = 0; guard < 50; guard += 1) {
    // 洛神：自己表态前，牌力差就重发
    while (id === 'zhenji' && usesLeft > 0 && handScore(t.hands[0]) < 4) { t = deal(rand); usesLeft -= 1; redeals += 1; }
    // 木牛流马：拿最小的一张换底牌（二重起先翻开 values 张、取其中最大的，比最小的大才换）
    if (id === 'huangyueying') {
      for (let k = 0; k < usesLeft; k += 1) {
        const hand = ddz.sortCards(t.hands[0]);
        const smallest = hand[0];
        const flips = sk.values[lv - 1];
        const order = [0, 1, 2].sort(() => rand() - 0.5);
        const j = flips === 0 ? order[0] : order.slice(0, flips).reduce((b, i) => (t.kitty[i].value > t.kitty[b].value ? i : b), order[0]);
        if (flips > 0 && t.kitty[j].value <= smallest.value) continue;
        const got = t.kitty[j];
        t.kitty = t.kitty.map((c, i) => (i === j ? smallest : c));
        t.hands[0] = ddz.sortCards([...hand.slice(1), got]);
      }
      usesLeft = 0;
    }
    let mult = 1, candidate = null, firstCaller = null;
    const order = [0, 1, 2];
    for (const p of order) {
      const contested = candidate !== null;
      const w = p === 0 ? wants(t.hands[0], 'veteran', contested) : wants(t.hands[p], aiSkill, contested);
      if (w) { if (contested) mult = Math.min(MAX, mult * 2); candidate = p; if (firstCaller === null) firstCaller = p; }
    }
    if (candidate === null) { t = deal(rand); continue; }
    if (firstCaller !== null && firstCaller !== candidate) {
      const w = firstCaller === 0 ? wants(t.hands[0], 'veteran', true) : wants(t.hands[firstCaller], aiSkill, true);
      if (w) { mult = Math.min(MAX, mult * 2); candidate = firstCaller; }
    }
    return play(t, candidate, mult, rand, aiSkill, id, lv, sk, redeals, perks);
  }
  throw new Error('bid_loop');
}

function play(t, landlord, mult0, rand, aiSkill, id, lv, sk, redeals, perks = []) {
  // 郡特权（与 BattleScreen / DouDizhuGame 同一公式）：缴获乘数连同失手付款一起按缴获同比放大（venueLoss = venueGold × 两成）
  const has = (perk) => perks.includes(perk);
  const rewardScale = (has('nanyang') ? 1.2 : 1) * (has('jingzhou') ? 1.1 : 1);
  const hands = { ...t.hands, [landlord]: ddz.sortCards([...t.hands[landlord], ...t.kitty]) };
  // 赤壁：能加倍就加倍（笨玩家不看牌）
  // 与 finishBidding 一致：叫抢已到封顶 8 不弹加倍
  const canDouble = id === 'xiaoqiao' && (landlord === 0 || lv >= 2) && mult0 < MAX && (XQ_T === 0 || handScore(hands[0]) >= XQ_T) && (XQ_POLICY !== 'landlord' || landlord === 0);
  const doubled = canDouble ? 2 : 1;
  let mult = mult0, myBombs = 0, longs = 0, bigBombs = 0;
  const plays = { 0: 0, 1: 0, 2: 0 };
  let current = landlord, passes = 0, last = null, winner = null;
  for (let turn = 0; turn < 800 && winner === null; turn += 1) {
    const player = current;
    const target = last && last.player !== player ? last.combo : null;
    let cards;
    if (player === 0) cards = ddz.findFirstPlayable(hands[0], target);
    else {
      const others = [0, 1, 2].filter((i) => i !== player);
      const isLandlord = player === landlord;
      const teammate = isLandlord ? null : others.find((i) => i !== landlord);
      const teammateLeads = Boolean(last && teammate !== null && last.player === teammate);
      const pressure = isLandlord ? Math.min(...others.map((i) => hands[i].length)) : hands[landlord].length;
      cards = ddz.chooseAiPlay(hands[player], target, 'balanced', { landlordCards: pressure, teammateLeads, teammateCards: teammate !== null ? hands[teammate].length : undefined, skill: aiSkill, unseen: others.flatMap((i) => hands[i]), rand });
    }
    const combo = cards ? ddz.evaluateCards(cards) : null;
    if (cards && combo && ddz.canBeat(combo, target)) {
      const ids = new Set(cards.map((c) => c.id));
      hands[player] = hands[player].filter((c) => !ids.has(c.id));
      const isBomb = combo.type === 'bomb' || combo.type === 'rocket';
      if (isBomb) {
        const quad = player === 0 && id === 'sunshangxiang';
        if (player === 0) myBombs += 1;
        if (quad) bigBombs += 1;
        mult = Math.min(MAX, mult * (quad ? (SSX ? SSX[lv - 1] : sk.values[lv - 1]) : 2));
      }
      if (player === 0 && LONG.has(combo.type) && cards.length >= 5) longs += 1;
      plays[player] += 1;
      last = { player, combo }; passes = 0;
      if (hands[player].length === 0) winner = player;
    } else {
      passes += 1;
      if (passes >= 2) { passes = 0; last = null; }
    }
    current = next(player);
  }
  if (winner === null) throw new Error('max_turns');
  const farmers = [0, 1, 2].filter((i) => i !== landlord);
  const spring = (winner === landlord && farmers.every((i) => plays[i] === 0)) || (winner !== landlord && plays[landlord] <= 1);
  const win = landlord === 0 ? winner === 0 : winner !== landlord;
  const share = landlord === 0 ? 1 : 0.5;
  const base = Math.min(MAX, mult * (spring ? 2 : 1));
  if (win) {
    const fire = id === 'zhurong' ? 1 + Math.min(sk.values[lv - 1], longs * ps.ZHURONG_STEP) : 1;
    const winMult = Math.min(MAX, base * doubled);
    const winShare = has('changsha') ? 1 : share;
    return { net: (has('bajun') ? Math.max(2, winMult) : winMult) * winShare * fire * rewardScale, win, refund: false, longs, bigBombs, redeals };
  }
  // 与 DouDizhuGame 同一公式：失手加付按「加倍实际多赢了多少」（xiaoqiaoLossFactor），封顶吃掉的部分不加付
  const lossMult = base;
  const lossRate = doubled > 1 ? (process.env.XQ_D ? 1 + (XQ_D * (lv >= 3 ? 0.75 : 1) - 1) * (Math.min(MAX, base * 2) / base - 1) : ps.xiaoqiaoLossFactor(lv, Math.min(MAX, base * 2) / base)) : 1;
  const cut = id === 'mifuren' ? Math.max(ps.MIFUREN_MIN_PAY, 1 - sk.values[lv - 1]) : 1;
  const refund = id === 'mifuren' && lossMult >= ps.MIFUREN_REFUND_MULTIPLIER;
  return { net: -LOSS_RATE * lossMult * lossRate * share * cut * rewardScale * (has('runan') ? 0.5 : 1), win, refund, longs, bigBombs, redeals };
}

function run(aiSkill, escort, perks = []) {
  let sum = 0, wins = 0, refunds = 0, longs = 0, bigBombs = 0, redeals = 0;
  for (let i = 0; i < GAMES; i += 1) {
    const r = playGame(1000003 * (i + 1), aiSkill, escort, perks);
    sum += r.net; wins += r.win ? 1 : 0; refunds += r.refund ? 1 : 0; longs += r.longs; bigBombs += r.bigBombs; redeals += r.redeals;
  }
  return { ev: sum / GAMES, win: wins / GAMES, refundRate: refunds / GAMES, longs: longs / GAMES, bigBombs: bigBombs / GAMES, redeals: redeals / GAMES };
}

if (process.env.PERKS) {
  const PERK_LIST = process.env.PERKS === 'all' ? ['nanyang', 'jingzhou', 'runan', 'changsha', 'bajun'] : process.env.PERKS.split(',');
  for (const aiSkill of AI_SKILLS) {
    const base = run(aiSkill, null);
    console.log(`[${aiSkill}] 无特权 净期望 ${base.ev.toFixed(4)} 胜率 ${(base.win * 100).toFixed(1)}%（${GAMES} 局）`);
    for (const perk of PERK_LIST) {
      const r = run(aiSkill, null, perk.split('+'));
      console.log(`  特权 ${perk.padEnd(16)} 净期望 ${r.ev.toFixed(4)} 倍率 ${(r.ev / base.ev).toFixed(3)}`);
    }
  }
  process.exit(0);
}

const rows = [];
for (const aiSkill of AI_SKILLS) {
  const base = run(aiSkill, null);
  console.log(`[${aiSkill}] 无伴侣 净期望 ${base.ev.toFixed(4)} 胜率 ${(base.win * 100).toFixed(1)}%（${GAMES} 局）`);
  for (const id of SKILL_LIST) {
    for (const level of LEVELS) {
      const r = run(aiSkill, { id, level });
      // 糜夫人返还军令 = 多打一局，按无伴侣一局的净期望折算
      const ev = r.ev + r.refundRate * base.ev;
      const ratio = ev / base.ev;
      const extra = id === 'mifuren' ? ` 返还军令 ${(r.refundRate * 100).toFixed(1)}%/局` : id === 'zhurong' ? ` 长牌 ${r.longs.toFixed(2)} 手/局` : id === 'sunshangxiang' ? ` ×4 炸弹 ${r.bigBombs.toFixed(3)} 个/局` : id === 'zhenji' ? ` 重发 ${r.redeals.toFixed(2)} 次/局` : '';
      const flag = level === 3 && ratio > 1.15 ? '  ← 超过 +15%' : '';
      console.log(`  ${id.padEnd(14)} Lv${level} 净期望 ${ev.toFixed(4)} 倍率 ${ratio.toFixed(3)}（${ratio >= 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(1)}%） 胜率 ${(r.win * 100).toFixed(1)}%${extra}${flag}`);
      rows.push({ aiSkill, id, level, ratio });
    }
  }
}
const worst = rows.filter((r) => r.level === 3).sort((a, b) => b.ratio - a.ratio)[0];
if (worst) console.log(`三重最高：${worst.id} @ ${worst.aiSkill} ${((worst.ratio - 1) * 100).toFixed(1)}%${worst.ratio > 1.15 ? '（超过合格线 +15%）' : '（合格线内）'}`);
