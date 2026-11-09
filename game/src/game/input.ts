import type { Direction } from './types';

export type InputAction =
  | { type: 'move'; direction: Direction }
  | { type: 'pause' }
  | { type: 'confirm' };

const keyDirections: Partial<Record<string, Direction>> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right'
};

export const mapKeyboardInput = (event: KeyboardEvent): InputAction | null => {
  const direction = keyDirections[event.code];
  if (direction) return { type: 'move', direction };
  if (event.code === 'KeyP' || event.code === 'Escape') return { type: 'pause' };
  if (event.code === 'Enter' || event.code === 'Space') return { type: 'confirm' };
  return null;
};

export const getSwipeDirection = (deltaX: number, deltaY: number): Direction | null => {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 24) return null;
  if (Math.abs(deltaX) > Math.abs(deltaY)) return deltaX > 0 ? 'right' : 'left';
  return deltaY > 0 ? 'down' : 'up';
};
