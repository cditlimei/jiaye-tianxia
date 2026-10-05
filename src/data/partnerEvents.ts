import type { Partner } from './gameData';

export type PartnerBoost = Partial<Pick<Partner['bonus'], 'strength' | 'intelligence' | 'charisma'>>;

export interface PartnerEventOption {
  id: 'a' | 'b';
  label: string;
  detail: string;
  boost: PartnerBoost;
}

export interface PartnerEvent {
  partnerId: string;
  title: string;
  prompt: string;
  options: [PartnerEventOption, PartnerEventOption];
}

export const PARTNER_BOOST_AMOUNT = 6;
/** 伴侣心事每 10 日轮一位（第 5、15、25……日）；与门客献策同日时让位给府中事件 */
export const PARTNER_EVENT_CYCLE_DAYS = 10;
export const PARTNER_EVENT_OFFSET_DAY = 5;

const B = PARTNER_BOOST_AMOUNT;

// 每位伴侣一段心事：两个选项都是正向加成，差别在方向
export const partnerEvents: PartnerEvent[] = [
  {
    partnerId: 'zhenji', title: '洛水之思', prompt: '甄姬临水赋诗，问主公：此诗当传于世，还是留作府中内政之鉴？',
    options: [
      { id: 'a', label: '传诗于世', detail: '洛神赋名动天下，声望 +6。', boost: { charisma: B } },
      { id: 'b', label: '留鉴内政', detail: '以诗寓政，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'sunshangxiang', title: '弓马之约', prompt: '孙尚香要在府前立靶练箭，侍女们吓得不敢出门。',
    options: [
      { id: 'a', label: '陪她练箭', detail: '主公亲自搭弓，武力 +6。', boost: { strength: B } },
      { id: 'b', label: '请她授艺', detail: '府中侍卫皆成射手，声望 +6。', boost: { charisma: B } }
    ]
  },
  {
    partnerId: 'daqiao', title: '江东来信', prompt: '大乔收到江东旧友的书信，问主公可否回信通好。',
    options: [
      { id: 'a', label: '修书通好', detail: '江东诸族念旧情，声望 +6。', boost: { charisma: B } },
      { id: 'b', label: '只谈家事', detail: '不涉外事，专心内政，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'xiaoqiao', title: '琴声夜话', prompt: '小乔新谱一曲，想在府中设宴请宾客共赏。',
    options: [
      { id: 'a', label: '设宴共赏', detail: '宾客尽欢，声望 +6。', boost: { charisma: B } },
      { id: 'b', label: '独奏与君', detail: '曲中有兵法之意，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'huangyueying', title: '木牛流马', prompt: '黄月英造出一架木牛，问主公用在田间，还是送往军中。',
    options: [
      { id: 'a', label: '送往军中', detail: '辎重自行，武力 +6。', boost: { strength: B } },
      { id: 'b', label: '用于田间', detail: '省工省力，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'diaochan', title: '月下独酌', prompt: '貂蝉月下独酌，说起旧事，问主公愿听她的歌舞，还是她的往事。',
    options: [
      { id: 'a', label: '听她歌舞', detail: '一舞倾城，声望 +6。', boost: { charisma: B } },
      { id: 'b', label: '听她往事', detail: '连环之计尽在言中，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'caiwenji', title: '胡笳十八拍', prompt: '蔡文姬整理旧籍，问主公是续修史书，还是教府中子弟读书。',
    options: [
      { id: 'a', label: '续修史书', detail: '文名远播，声望 +6。', boost: { charisma: B } },
      { id: 'b', label: '教授子弟', detail: '府中人人知书，智谋 +6。', boost: { intelligence: B } }
    ]
  },
  {
    partnerId: 'mifuren', title: '仓廪之议', prompt: '糜夫人提议把娘家的商队并入府中，问主公要钱粮还是要人手。',
    options: [
      { id: 'a', label: '要人手', detail: '商队护卫编入府兵，武力 +6。', boost: { strength: B } },
      { id: 'b', label: '要钱粮', detail: '商路通达，声望 +6。', boost: { charisma: B } }
    ]
  },
  {
    partnerId: 'zhurong', title: '南中火把', prompt: '祝融要带南中旧部来府中比武，怕伤了府中体面。',
    options: [
      { id: 'a', label: '放手比武', detail: '以武会友，武力 +6。', boost: { strength: B } },
      { id: 'b', label: '改为校阅', detail: '礼法齐备，声望 +6。', boost: { charisma: B } }
    ]
  },
  {
    partnerId: 'bulianshi', title: '后宅之柄', prompt: '步练师想替主公打理后宅账目，问主公放权几分。',
    options: [
      { id: 'a', label: '全权托付', detail: '账目井然，智谋 +6。', boost: { intelligence: B } },
      { id: 'b', label: '共理家事', detail: '夫妇同心传为佳话，声望 +6。', boost: { charisma: B } }
    ]
  }
];

export function findPartnerEvent(partnerId: string) {
  return partnerEvents.find((event) => event.partnerId === partnerId) ?? null;
}

export function isPartnerEventDay(day: number) {
  return day % PARTNER_EVENT_CYCLE_DAYS === PARTNER_EVENT_OFFSET_DAY;
}

/** 下一位该出心事的伴侣：按招募顺序，取还没解决过心事的第一位 */
export function nextPartnerForEvent(ownedPartnerIds: string[], resolved: Record<string, string>) {
  return ownedPartnerIds.find((id) => !resolved[id] && findPartnerEvent(id)) ?? null;
}

export function mergePartnerBoost(partner: Partner, boost: PartnerBoost | undefined): Partner {
  if (!boost) return partner;
  return {
    ...partner,
    bonus: {
      strength: (partner.bonus.strength ?? 0) + (boost.strength ?? 0) || undefined,
      intelligence: (partner.bonus.intelligence ?? 0) + (boost.intelligence ?? 0) || undefined,
      charisma: (partner.bonus.charisma ?? 0) + (boost.charisma ?? 0) || undefined
    }
  };
}
