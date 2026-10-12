/**
 * 农民牌艺标定：笨地主（永远出最小可出牌）对三档农民各跑 N 局，看地主胜率梯度。
 * 用法: node scripts/doudizhu-skill-sim.mjs [局数]   调 chooseAiPlay 前后都跑一遍
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const GAMES = Number(process.argv[2] ?? 3000);
const compiled = ts.transpileModule(readFileSync('src/lib/doudizhu.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const modulePath = path.join(tmpdir(), `jiaye-doudizhu-skill-${Date.now()}.mjs`);
writeFileSync(modulePath, compiled);
const ddz = await import(pathToFileURL(modulePath).href);
const next = (p) => (p + 1) % 3;

function play(skill, styles) {
  const deal = ddz.createDoudizhuDeal();
  let table = { hands: deal.hands, currentPlayer: 0, consecutivePasses: 0, lastPlay: null, winner: null };
  for (let turn = 0; turn < 600; turn += 1) {
    const player = table.currentPlayer;
    const target = table.lastPlay && table.lastPlay.player !== player ? table.lastPlay.combo : null;
    const teammateLeads = Boolean(table.lastPlay && table.lastPlay.player !== player && table.lastPlay.player !== 0);
    const cards = player === 0
      ? ddz.findFirstPlayable(table.hands[0], target)
      : ddz.chooseAiPlay(table.hands[player], target, styles[player], { landlordCards: table.hands[0].length, teammateLeads, skill });
    const combo = cards ? ddz.evaluateCards(cards) : null;
    if (cards && combo && ddz.canBeat(combo, target)) {
      const ids = new Set(cards.map((c) => c.id));
      const hand = table.hands[player].filter((c) => !ids.has(c.id));
      table = { ...table, hands: { ...table.hands, [player]: hand }, currentPlayer: next(player), consecutivePasses: 0, lastPlay: { player, cards, combo }, winner: hand.length === 0 ? player : null };
      if (table.winner !== null) return table.winner;
    } else {
      const passes = table.consecutivePasses + 1;
      table = { ...table, currentPlayer: next(player), consecutivePasses: passes >= 2 ? 0 : passes, lastPlay: passes >= 2 ? null : table.lastPlay };
    }
  }
  throw new Error('max_turns');
}

const STYLE_SETS = { 激进: ['aggressive', 'aggressive'], 均衡: ['balanced', 'balanced'], 稳健: ['cautious', 'cautious'], 混合: ['aggressive', 'cautious'] };
for (const skill of (process.env.SKILLS ?? 'novice,veteran,master').split(',')) {
  const row = [];
  for (const [label, [s1, s2]] of Object.entries(STYLE_SETS)) {
    let landlord = 0;
    for (let i = 0; i < GAMES; i += 1) if (play(skill, { 1: s1, 2: s2 }) === 0) landlord += 1;
    row.push(`${label} ${(100 * landlord / GAMES).toFixed(1)}%`);
  }
  console.log(`${ddz.AI_SKILL_LABEL[skill]}(${skill}) 笨地主胜率 | ${row.join(' | ')}`);
}
