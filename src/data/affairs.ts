// 处理政务时的「今日政务」回报：只是文字，告诉玩家这一天忙了什么、钱从哪来，不改数值
// 按宅邸档次分三组：茅草屋/木屋操持家计，砖瓦宅/府邸治理一方，侯府/王城经略一郡
export interface Affair {
  title: string;
  detail: string;
}

const HOMESTEAD: Affair[] = [
  { title: '开垦菜畦', detail: '屋后荒地翻成菜畦，换得几担菜蔬。' },
  { title: '上山砍柴', detail: '一早进山打柴，挑到集上换了钱。' },
  { title: '代写家书', detail: '替乡邻写信记账，收了些笔墨钱。' },
  { title: '修补屋顶', detail: '雨前补好茅顶，省下一笔修缮钱。' },
  { title: '赶集售粮', detail: '把余粮挑去县集，卖了个好价。' },
  { title: '帮工收麦', detail: '给邻村大户帮工收麦，结了工钱。' },
  { title: '编织草履', detail: '夜里编了一捆草履，托货郎代卖。' },
  { title: '放牧耕牛', detail: '替里正放牛一日，得了几个钱。' }
];

const ESTATE: Affair[] = [
  { title: '审理田讼', detail: '两户争田界，当堂断清，乡里称服。' },
  { title: '清点仓廪', detail: '盘点仓中粮秣，查出旧账余粮。' },
  { title: '接见乡老', detail: '与乡老议定春耕，佃户安心下田。' },
  { title: '督修水渠', detail: '督工疏通水渠，下游田亩得以灌溉。' },
  { title: '收取租赋', detail: '佃户按时交租，府库入账。' },
  { title: '整顿市集', detail: '约束牙行压价，商贩多来府前交易。' },
  { title: '招抚流民', detail: '安置几户流民垦荒，来年添租。' },
  { title: '训练家丁', detail: '操练家丁护庄，盗匪不敢近前。' }
];

const DOMAIN: Affair[] = [
  { title: '批阅郡县文书', detail: '各县呈报钱粮，逐一批复下发。' },
  { title: '接见各郡使者', detail: '诸郡使者来贺，带来贡赋与消息。' },
  { title: '议定赋税', detail: '与幕僚议定新赋，商旅不减、府库渐丰。' },
  { title: '校阅部曲', detail: '校场点兵，赏罚分明，士气大振。' },
  { title: '开设学馆', detail: '延请名士讲学，寒门子弟来投。' },
  { title: '巡视屯田', detail: '巡视屯田营，督促秋收入仓。' },
  { title: '平抑粮价', detail: '开仓平粜，粮价回落，百姓称颂。' },
  { title: '修缮城防', detail: '加固城垣箭楼，边民安居。' }
];

export function affairPoolFor(homeLevel: number) {
  if (homeLevel <= 2) return HOMESTEAD;
  if (homeLevel <= 4) return ESTATE;
  return DOMAIN;
}

/** 按日子轮换，连续几天不重样；同一天刷新看到的是同一件 */
export function affairFor(day: number, homeLevel: number): Affair {
  const pool = affairPoolFor(homeLevel);
  return pool[(day * 5) % pool.length];
}

// ===== 府中三件事：每天报上来钱粮 / 军务 / 治理各一件，玩家挑一件去办 =====
// 钱粮拿足额政务收入；军务、治理只拿一半，但本代武力或智谋声望 +1（各封顶 15，练满后按钱粮足额给）
// 上限 15 是 econ 定的：只办钱粮王城第 20 个游玩日，先练满第 15 日；上限 30 会快到第 13 日
export type AffairKind = 'treasury' | 'military' | 'civil';

export interface AffairOption extends Affair {
  kind: AffairKind;
}

export const AFFAIR_TRAINING_CAP = 15;
export const AFFAIR_SIDE_GOLD_RATE = 0.5;

export const AFFAIR_KIND_LABEL: Record<AffairKind, string> = {
  treasury: '钱粮',
  military: '军务',
  civil: '治理'
};

type KindPools = Record<AffairKind, Affair[]>;

const CHOICE_POOLS: KindPools[] = [
  // 茅草屋 / 木屋：操持家计
  {
    treasury: [
      { title: '赶集售粮', detail: '把余粮挑去县集，卖个好价。' },
      { title: '上山砍柴', detail: '一早进山打柴，挑到集上换钱。' },
      { title: '编织草履', detail: '夜里编一捆草履，托货郎代卖。' },
      { title: '帮工收麦', detail: '给邻村大户帮工收麦，结工钱。' }
    ],
    military: [
      { title: '晨起练刀', detail: '院中劈砍千下，臂力渐长。' },
      { title: '随猎户进山', detail: '跟猎户追鹿一日，弓马更熟。' },
      { title: '与乡勇比武', detail: '和村中后生较量拳脚。' },
      { title: '扛石负重', detail: '在河滩搬石，练一身筋骨。' }
    ],
    civil: [
      { title: '代写家书', detail: '替乡邻写信，顺带结交人情。' },
      { title: '调解邻里', detail: '两家为鸡鸭吵架，你出面劝和。' },
      { title: '夜读兵书', detail: '挑灯读完一卷，略有心得。' },
      { title: '拜访里正', detail: '向里正请教乡中旧事。' }
    ]
  },
  // 砖瓦宅 / 府邸：治理一方
  {
    treasury: [
      { title: '清点仓廪', detail: '盘点仓中粮秣，查出旧账余粮。' },
      { title: '收取租赋', detail: '佃户按时交租，府库入账。' },
      { title: '整顿市集', detail: '约束牙行压价，商贩多来交易。' },
      { title: '开设盐铺', detail: '在镇上开一间盐铺，日有进项。' }
    ],
    military: [
      { title: '校场点兵', detail: '操练家丁，阵列渐整。' },
      { title: '巡视庄防', detail: '加固庄墙，盗匪不敢近前。' },
      { title: '演练骑射', detail: '亲率家丁驰马射靶。' },
      { title: '整修兵器', detail: '请铁匠重淬刀枪。' }
    ],
    civil: [
      { title: '审理田讼', detail: '两户争田界，当堂断清，乡里称服。' },
      { title: '接见乡老', detail: '与乡老议定春耕，佃户安心下田。' },
      { title: '督修水渠', detail: '疏通水渠，下游田亩得以灌溉。' },
      { title: '招抚流民', detail: '安置几户流民垦荒，四方称善。' }
    ]
  },
  // 侯府 / 王城：经略一郡
  {
    treasury: [
      { title: '议定赋税', detail: '与幕僚议定新赋，府库渐丰。' },
      { title: '巡视屯田', detail: '督促秋收入仓。' },
      { title: '开通商路', detail: '修栈道通西蜀，商旅往来。' },
      { title: '接收贡赋', detail: '诸郡使者送来贡赋。' }
    ],
    military: [
      { title: '校阅部曲', detail: '校场点兵，赏罚分明，士气大振。' },
      { title: '修缮城防', detail: '加固城垣箭楼，边民安居。' },
      { title: '演练阵法', detail: '与诸将推演八阵。' },
      { title: '亲率巡边', detail: '轻骑巡视边郡烽燧。' }
    ],
    civil: [
      { title: '批阅郡县文书', detail: '各县呈报逐一批复，吏治清明。' },
      { title: '开设学馆', detail: '延请名士讲学，寒门子弟来投。' },
      { title: '平抑粮价', detail: '开仓平粜，百姓称颂。' },
      { title: '礼贤下士', detail: '亲访隐士，求治国之策。' }
    ]
  }
];

function choicePoolFor(homeLevel: number) {
  if (homeLevel <= 2) return CHOICE_POOLS[0];
  if (homeLevel <= 4) return CHOICE_POOLS[1];
  return CHOICE_POOLS[2];
}

/** 这一日报上来的三件事（同一日刷新看到的相同；三类按日子错开轮换） */
export function affairChoicesFor(day: number, homeLevel: number): AffairOption[] {
  const pool = choicePoolFor(homeLevel);
  return (['treasury', 'military', 'civil'] as const).map((kind, index) => {
    const list = pool[kind];
    return { ...list[(day + index * 3) % list.length], kind };
  });
}

export interface AffairTraining {
  strength: number;
  civil: number;
}

/** 办这件事实际拿多少金、练不练属性 */
export function affairOutcome(kind: AffairKind, baseGold: number, training: AffairTraining) {
  const trains = (kind === 'military' && training.strength < AFFAIR_TRAINING_CAP) || (kind === 'civil' && training.civil < AFFAIR_TRAINING_CAP);
  return { gold: trains ? Math.round(baseGold * AFFAIR_SIDE_GOLD_RATE) : baseGold, trains };
}
