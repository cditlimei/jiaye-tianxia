import { useState } from 'react';
import type { GameState } from '../types';
import { LEGACY_GOLD_PER_POINT, LEGACY_MAX_POINTS, legacyIncomeMultiplier, legacyPointsFor, SUCCESSION_HOME_LEVEL } from '../lib/battle';
import { GameButton } from './common/GameButton';
import { ModalShell } from './common/ModalShell';

interface SettingsModalProps {
  state: GameState;
  onClose: () => void;
  onToggleSound: () => void;
  onCopySave: () => Promise<{ ok: boolean; message: string; payload: string | null }>;
  onImportSave: (payload: string) => { ok: boolean; message: string };
  canInstall: boolean;
  onInstall: () => void;
  onReturnTitle: () => void;
  onReset: () => void;
  onSucceed: () => void;
}

export function SettingsModal({
  state,
  onClose,
  onToggleSound,
  onCopySave,
  onImportSave,
  canInstall,
  onInstall,
  onReturnTitle,
  onReset,
  onSucceed
}: SettingsModalProps) {
  const gainedPoints = legacyPointsFor(state.gold);
  const canSucceed = state.homeLevel >= SUCCESSION_HOME_LEVEL && gainedPoints >= 1 && state.legacyPoints < LEGACY_MAX_POINTS;
  const successionHint = state.homeLevel < SUCCESSION_HOME_LEVEL
    ? `宅邸升至王城（${SUCCESSION_HOME_LEVEL} 级）后可传位。`
    : state.legacyPoints >= LEGACY_MAX_POINTS
      ? '家业点已达上限，传位不再增加加成。'
      : gainedPoints < 1
        ? `至少需 ${LEGACY_GOLD_PER_POINT.toLocaleString()} 金才能换到 1 点家业点。`
        : `现在传位可得 ${gainedPoints} 点家业点，累计 ${Math.min(LEGACY_MAX_POINTS, state.legacyPoints + gainedPoints)} 点，下一代收入 +${Math.round((legacyIncomeMultiplier(Math.min(LEGACY_MAX_POINTS, state.legacyPoints + gainedPoints)) - 1) * 100)}%。`;
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const pasteSave = async () => {
    const clipboardText = await navigator.clipboard?.readText().catch(() => '');
    if (clipboardText) {
      setImportText(clipboardText);
      setImportStatus({ ok: true, message: '已读取剪贴板。' });
    } else {
      setImportStatus({ ok: false, message: '无法读取剪贴板，请手动粘贴。' });
    }
  };

  const copySave = async () => {
    const result = await onCopySave();
    if (result.payload) {
      setImportText(result.payload);
    }
    setImportStatus({ ok: result.ok, message: result.message });
  };

  const importSave = () => {
    const result = onImportSave(importText.trim());
    setImportStatus(result);
    if (result.ok) {
      setImportText('');
    }
  };

  return (
    <ModalShell title="设置" onClose={onClose}>
      <div className="settings-panel">
        <section>
          <span>当前存档</span>
          <strong>第 {state.day} 天 · {state.gold.toLocaleString()} 金</strong>
          <p>胜 {state.battleWins}（讨伐 {state.battleWins - state.navalWins - state.courtWins - state.frontierWins} · 水战 {state.navalWins} · 朝议 {state.courtWins} · 靖边 {state.frontierWins}）· 负 {state.battleLosses}</p>
        </section>
        <section className="succession-panel">
          <span>传位 · 第 {state.generation} 代</span>
          <strong>家业点 {state.legacyPoints}/{LEGACY_MAX_POINTS} · 收入 +{Math.round((legacyIncomeMultiplier(state.legacyPoints) - 1) * 100)}%</strong>
          <p>把全部金币换成家业点（每 {LEGACY_GOLD_PER_POINT.toLocaleString()} 金 1 点），每点让处理政务与屯田收入永久 +5%。主公、伴侣、兵器、宅邸、屯田与任务从头再来。</p>
          <p className={canSucceed ? 'is-ok' : ''}>{successionHint}</p>
          <GameButton variant={canSucceed ? 'primary' : 'ghost'} disabled={!canSucceed} onClick={onSucceed}>
            传位给下一代
          </GameButton>
        </section>
        <section className="save-import-panel">
          <span>备份恢复</span>
          <textarea
            aria-label="粘贴存档 JSON"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder="粘贴复制出的存档 JSON"
          />
          {importStatus && <p className={importStatus.ok ? 'is-ok' : 'is-error'}>{importStatus.message}</p>}
          <div className="save-import-actions">
            <GameButton variant="ghost" onClick={pasteSave}>
              粘贴存档
            </GameButton>
            <GameButton variant="secondary" onClick={importSave} disabled={!importText.trim()}>
              导入存档
            </GameButton>
          </div>
        </section>
        <div className="settings-actions">
          <GameButton variant="secondary" onClick={onToggleSound}>
            {state.soundEnabled ? '关闭声音' : '开启声音'}
          </GameButton>
          <GameButton variant="secondary" onClick={copySave}>
            复制存档
          </GameButton>
          {canInstall && (
            <GameButton variant="secondary" onClick={onInstall}>
              安装应用
            </GameButton>
          )}
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
