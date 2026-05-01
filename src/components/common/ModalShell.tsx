import type { ReactNode } from 'react';
import { GameButton } from './GameButton';

interface ModalShellProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
}

export function ModalShell({ title, children, onClose }: ModalShellProps) {
  return (
    <div className="modal-backdrop">
      <section className="modal-shell" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-shell__header">
          <h2>{title}</h2>
          <GameButton variant="ghost" onClick={onClose} aria-label="关闭">
            关闭
          </GameButton>
        </header>
        {children}
      </section>
    </div>
  );
}

