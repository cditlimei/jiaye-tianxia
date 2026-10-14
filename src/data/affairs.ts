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
