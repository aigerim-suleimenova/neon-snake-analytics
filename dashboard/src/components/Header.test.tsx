import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Header, type HeaderProps } from './Header';

const renderHeader = (props: Partial<HeaderProps> = {}) => {
  const onRefresh = vi.fn();
  render(<Header statusText="Updated 12:04" isRefreshing={false} canRefresh onRefresh={onRefresh} {...props} />);
  return { onRefresh };
};

describe('Header', () => {
  it('shows the title and the status text', () => {
    renderHeader();

    expect(screen.getByRole('heading', { level: 1, name: 'Gameplay performance' })).toBeInTheDocument();
    expect(screen.getByText('Updated 12:04')).toBeInTheDocument();
  });

  it.each(['Loading…', 'Offline'])('shows the status "%s"', (statusText) => {
    renderHeader({ statusText, canRefresh: false });

    expect(screen.getByText(statusText)).toBeInTheDocument();
  });

  it('refreshes on click', async () => {
    const { onRefresh } = renderHeader();

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('shows "Refreshing…" and is disabled while refreshing', async () => {
    const { onRefresh } = renderHeader({ isRefreshing: true, canRefresh: false });
    const button = screen.getByRole('button', { name: 'Refreshing…' });

    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('is disabled during the first load', () => {
    renderHeader({ statusText: 'Loading…', canRefresh: false });

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
});
