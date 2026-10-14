// 牌面矢量图：花色、J/Q/K 徽记、大小王小丑帽
// 花色不用文字符号 ♥♦——iOS 上常被渲染成 emoji，大小、颜色都不受控

const SUIT_PATHS: Record<string, string> = {
  '♠': 'M12 2C9 6 3 9.5 3 14a4.5 4.5 0 0 0 7.6 3.2c-.3 1.9-1 3.3-2.6 4.8h8c-1.6-1.5-2.3-2.9-2.6-4.8A4.5 4.5 0 0 0 21 14c0-4.5-6-8-9-12z',
  '♥': 'M12 21.5C6.5 17 2.5 13.4 2.5 8.8A5 5 0 0 1 12 6.2a5 5 0 0 1 9.5 2.6c0 4.6-4 8.2-9.5 12.7z',
  '♣': 'M12 2.5a4.3 4.3 0 0 0-3.6 6.7A4.3 4.3 0 1 0 10.7 17c-.3 1.9-1 3.2-2.7 5h8c-1.7-1.8-2.4-3.1-2.7-5a4.3 4.3 0 1 0 2.3-7.8A4.3 4.3 0 0 0 12 2.5z',
  '♦': 'M12 1.5 20 12l-8 10.5L4 12z'
};

export function SuitIcon({ suit, className }: { suit: string; className?: string }) {
  const path = SUIT_PATHS[suit];
  if (!path) return null;
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

/** J/Q/K：金框里放一枚徽记（K 王冠、Q 花冠、J 佩剑），颜色随花色红黑 */
export function CourtArt({ rank, className }: { rank: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 52" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="court-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6dc8c" />
          <stop offset="1" stopColor="#b9862e" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="48" rx="5" fill="none" stroke="url(#court-gold)" strokeWidth="2.2" />
      <rect x="5.5" y="5.5" width="29" height="41" rx="3" fill="currentColor" opacity="0.07" />
      {rank === 'K' && (
        <g fill="url(#court-gold)" stroke="#8a5d14" strokeWidth="0.8">
          <path d="M8 34 6 16l8 7 6-11 6 11 8-7-2 18z" />
          <rect x="8" y="35" width="24" height="5" rx="1.5" />
          <circle cx="20" cy="27" r="2.6" fill="currentColor" stroke="none" />
        </g>
      )}
      {rank === 'Q' && (
        <g fill="url(#court-gold)" stroke="#8a5d14" strokeWidth="0.8">
          <path d="M9 36c1-6 2-11 3-15l4 5 4-9 4 9 4-5c1 4 2 9 3 15z" />
          <circle cx="12" cy="20" r="2" />
          <circle cx="20" cy="15.5" r="2.2" />
          <circle cx="28" cy="20" r="2" />
          <path d="M20 26c-2.2 0-3.6 2-3.6 4s1.4 3 3.6 4.4c2.2-1.4 3.6-2.4 3.6-4.4s-1.4-4-3.6-4z" fill="currentColor" stroke="none" />
        </g>
      )}
      {rank === 'J' && (
        <g stroke="#8a5d14" strokeWidth="0.8">
          <path d="M20 9 23 13v20h-6V13z" fill="#e9edf2" />
          <path d="M20 11v21" stroke="#9aa3ad" />
          <rect x="11" y="33" width="18" height="3.6" rx="1.6" fill="url(#court-gold)" />
          <rect x="18" y="36.5" width="4" height="6" fill="currentColor" stroke="none" />
          <circle cx="20" cy="44" r="2.4" fill="url(#court-gold)" />
        </g>
      )}
    </svg>
  );
}

/** 大小王：小丑帽三只铃铛；大王彩色，小王黑灰 */
export function JokerArt({ big, className }: { big: boolean; className?: string }) {
  const [a, b, c] = big ? ['#d8262f', '#f0b429', '#2f6fd6'] : ['#2b2b33', '#7b7f88', '#4a4d55'];
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <path d="M6 30C7 20 10 13 15 9c-1 6 1 11 5 14 4-3 6-8 5-14 5 4 8 11 9 21z" fill={b} />
      <path d="M6 30C5 22 3 17 1 14c5 1 9 5 11 10z" fill={a} />
      <path d="M34 30c1-8 3-13 5-16-5 1-9 5-11 10z" fill={c} />
      <path d="M20 23c-4-3-6-8-5-14l5 4 5-4c1 6-1 11-5 14z" fill={big ? '#7b2bbf' : '#5c5f66'} />
      <rect x="5" y="29" width="30" height="5" rx="2.4" fill={big ? '#f6dc8c' : '#c9ccd1'} stroke={big ? '#b9862e' : '#8d9097'} strokeWidth="0.8" />
      <circle cx="1.8" cy="13.5" r="2" fill="#f6dc8c" />
      <circle cx="15" cy="8.5" r="2" fill="#f6dc8c" />
      <circle cx="25" cy="8.5" r="2" fill="#f6dc8c" />
      <circle cx="38.2" cy="13.5" r="2" fill="#f6dc8c" />
    </svg>
  );
}
