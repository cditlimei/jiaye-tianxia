import type { GameState } from '../types';
import { GameButton } from './common/GameButton';
import { ModalShell } from './common/ModalShell';

interface SettingsModalProps {
  state: GameState;
  onClose: () => void;
  onToggleSound: () => void;
  onCopySave: () => void;
  onReturnTitle: () => void;
  onReset: () => void;
}

export function SettingsModal({ state, onClose, onToggleSound, onCopySave, onReturnTitle, onReset }: SettingsModalProps) {
  return (
    <ModalShell title="设置" onClose={onClose}>
      <div className="settings-panel">
        <section>
          <span>当前存档</span>
          <strong>第 {state.day} 天 · {state.gold.toLocaleString()} 金</strong>
          <p>胜 {state.battleWins} · 负 {state.battleLosses}</p>
        </section>
        <div className="settings-actions">
          <GameButton variant="secondary" onClick={onToggleSound}>
            {state.soundEnabled ? '关闭声音' : '开启声音'}
          </GameButton>
          <GameButton variant="secondary" onClick={onCopySave}>
            复制存档
          </GameButton>
          <GameButton variant="ghost" onClick={onReturnTitle}>
            返回标题
          </GameButton>
          <GameButton variant="danger" onClick={onReset}>
            重置存档
          </GameButton>
        </div>
      </div>
    </ModalShell>
  );
}
