import { useState } from 'react';
import type { GameState } from '../types';
import { GameButton } from './common/GameButton';
import { ModalShell } from './common/ModalShell';

interface SettingsModalProps {
  state: GameState;
  onClose: () => void;
  onToggleSound: () => void;
  onCopySave: () => void;
  onImportSave: (payload: string) => { ok: boolean; message: string };
  canInstall: boolean;
  onInstall: () => void;
  onReturnTitle: () => void;
  onReset: () => void;
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
  onReset
}: SettingsModalProps) {
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
          <p>胜 {state.battleWins} · 负 {state.battleLosses}</p>
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
          <GameButton variant="secondary" onClick={onCopySave}>
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
