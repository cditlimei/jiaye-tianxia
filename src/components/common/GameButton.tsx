import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface GameButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  block?: boolean;
}

export function GameButton({ children, variant = 'primary', block = false, className = '', ...props }: GameButtonProps) {
  return (
    <button className={`game-button game-button--${variant} ${block ? 'game-button--block' : ''} ${className}`} {...props}>
      <span>{children}</span>
    </button>
  );
}

