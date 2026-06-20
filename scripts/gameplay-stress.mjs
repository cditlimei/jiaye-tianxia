import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

const DEFAULT_GAMES = 1000;
const DEFAULT_MAX_P95_MS = 8;
const DEFAULT_MAX_TURNS = 500;

if (isMainThread) {
  const options = readOptions();
  const startedAt = performance.now();
  const workers = splitWork(options.games, options.concurrency).map((games, index) => runWorker({
    games,
    index,
    maxTurns: options.maxTurns
  }));
  const results = await Promise.all(workers);
  const elapsedMs = performance.now() - startedAt;
  const merged = mergeResults(results);
  const p95Ms = percentile(merged.durations, 0.95);
  const p99Ms = percentile(merged.durations, 0.99);
  const maxMs = Math.max(...merged.durations);
  const avgTurns = merged.turns.reduce((sum, turns) => sum + turns, 0) / merged.turns.length;
  const gamesPerSecond = (options.games / elapsedMs) * 1000;

  console.log(JSON.stringify({
    status: merged.failures.length === 0 && p95Ms <= options.maxP95Ms ? 'ok' : 'risk',
    games: options.games,
    concurrency: options.concurrency,
    elapsedMs: round(elapsedMs),
    gamesPerSecond: round(gamesPerSecond),
    p95Ms: round(p95Ms),
    p99Ms: round(p99Ms),
    maxMs: round(maxMs),
    avgTurns: round(avgTurns),
    winners: merged.winners,
    failures: merged.failures.slice(0, 5)
  }, null, 2));

  if (merged.failures.length > 0) {
    process.exitCode = 1;
  } else if (p95Ms > options.maxP95Ms) {
    console.error(`gameplay_stress_p95_too_slow expected<=${options.maxP95Ms}ms actual=${round(p95Ms)}ms`);
    process.exitCode = 1;
  }
} else {
  const doudizhu = await loadDoudizhuModule(workerData.index);
  const durations = [];
  const turns = [];
  const winners = { landlord: 0, farmer: 0 };
  const failures = [];

  for (let gameIndex = 0; gameIndex < workerData.games; gameIndex += 1) {
    const startedAt = performance.now();
    try {
      const result = simulateGame(doudizhu, workerData.maxTurns);
      durations.push(performance.now() - startedAt);
      turns.push(result.turns);
      if (result.winner === 0) {
        winners.landlord += 1;
      } else {
        winners.farmer += 1;
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  parentPort.postMessage({ durations, turns, winners, failures });
}

function readOptions() {
  const games = readNumberArg('--games', DEFAULT_GAMES);
  const concurrency = Math.max(1, Math.min(readNumberArg('--concurrency', Math.min(4, availableParallelism())), games));
  const maxP95Ms = readNumberArg('--max-p95-ms', DEFAULT_MAX_P95_MS);
  const maxTurns = readNumberArg('--max-turns', DEFAULT_MAX_TURNS);
  return { games, concurrency, maxP95Ms, maxTurns };
}

function readNumberArg(name, fallback) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  const value = inline ? inline.slice(name.length + 1) : process.argv[process.argv.indexOf(name) + 1];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function splitWork(total, concurrency) {
  const base = Math.floor(total / concurrency);
  const remainder = total % concurrency;
  return Array.from({ length: concurrency }, (_item, index) => base + (index < remainder ? 1 : 0)).filter(Boolean);
}

function runWorker(payload) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: payload });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker_exit_${code}`));
    });
  });
}

async function loadDoudizhuModule(index) {
  const source = readFileSync('src/lib/doudizhu.ts', 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const modulePath = path.join(tmpdir(), `jiaye-doudizhu-stress-${Date.now()}-${index}.mjs`);
  writeFileSync(modulePath, compiled);
  return import(pathToFileURL(modulePath).href);
}

function simulateGame(doudizhu, maxTurns) {
  const deal = doudizhu.createDoudizhuDeal();
  let table = {
    hands: deal.hands,
    currentPlayer: 0,
    consecutivePasses: 0,
    lastPlay: null,
    winner: null
  };

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    table = resolveTurn(doudizhu, table);
    if (table.winner !== null) {
      return { winner: table.winner, turns: turn };
    }
  }

  throw new Error('gameplay_stress_max_turns_exceeded');
}

function resolveTurn(doudizhu, table) {
  const player = table.currentPlayer;
  const target = table.lastPlay && table.lastPlay.player !== player ? table.lastPlay.combo : null;
  const cards = doudizhu.findFirstPlayable(table.hands[player], target);
  const combo = cards ? doudizhu.evaluateCards(cards) : null;

  if (cards && combo && doudizhu.canBeat(combo, target)) {
    return applyPlay(table, player, cards, combo);
  }

  return applyPass(table, player);
}

function applyPlay(table, player, cards, combo) {
  const playedIds = new Set(cards.map((card) => card.id));
  const hand = table.hands[player].filter((card) => !playedIds.has(card.id));
  return {
    ...table,
    hands: { ...table.hands, [player]: hand },
    currentPlayer: nextPlayer(player),
    consecutivePasses: 0,
    lastPlay: { player, cards, combo },
    winner: hand.length === 0 ? player : null
  };
}

function applyPass(table, player) {
  const passes = table.consecutivePasses + 1;
  const roundCleared = passes >= 2;
  return {
    ...table,
    currentPlayer: nextPlayer(player),
    consecutivePasses: roundCleared ? 0 : passes,
    lastPlay: roundCleared ? null : table.lastPlay
  };
}

function nextPlayer(player) {
  return (player + 1) % 3;
}

function mergeResults(results) {
  return results.reduce((merged, result) => ({
    durations: [...merged.durations, ...result.durations],
    turns: [...merged.turns, ...result.turns],
    winners: {
      landlord: merged.winners.landlord + result.winners.landlord,
      farmer: merged.winners.farmer + result.winners.farmer
    },
    failures: [...merged.failures, ...result.failures]
  }), {
    durations: [],
    turns: [],
    winners: { landlord: 0, farmer: 0 },
    failures: []
  });
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index] ?? 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
