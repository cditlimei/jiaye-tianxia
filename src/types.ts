export type Screen = 'title' | 'lordSelect' | 'home' | 'battle';

export interface GameState {
  screen: Screen;
  selectedLordId: string | null;
  gold: number;
  homeLevel: number;
  equippedWeaponId: string;
  ownedPartnerIds: string[];
  day: number;
  battleWins: number;
  battleLosses: number;
  soundEnabled: boolean;
  lastScreen: Screen;
}

export type BattleOutcome = 'win' | 'loss' | 'retreat';

