import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Notice } from './Notice';

describe('Notice', () => {
  it('shows an info message without an action', () => {
    render(<Notice tone="info" message="No gameplay recorded yet. Play a level in the game, then click Refresh." />);

    expect(screen.getByRole('status')).toHaveTextContent('No gameplay recorded yet. Play a level in the game, then click Refresh.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('announces an error with its title, message and action', async () => {
    const onClick = vi.fn();
    render(
      <Notice
        tone="error"
        title="Analytics backend is unreachable"
        message="Check that the backend and Firestore emulator are running, then retry."
        action={{ label: 'Retry', disabled: false, onClick }}
      />
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Analytics backend is unreachable');
    expect(alert).toHaveTextContent('Check that the backend and Firestore emulator are running, then retry.');

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disables the action while it runs', () => {
    render(<Notice tone="error" title="Analytics backend is unreachable" message="…" action={{ label: 'Retrying…', disabled: true, onClick: vi.fn() }} />);

    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
  });
});
