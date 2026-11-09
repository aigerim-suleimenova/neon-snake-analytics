import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { sampleLevels, sampleOverview, unfinishedOnlyLevel } from '../api/sampleStats';
import { toDashboardView } from '../view/toDashboardView';
import { LevelTable } from './LevelTable';

const view = toDashboardView(sampleOverview, [...sampleLevels, unfinishedOnlyLevel]);

/** Text of every cell of the body rows, header cell included. */
const bodyRows = () =>
  within(screen.getAllByRole('rowgroup')[1])
    .queryAllByRole('row')
    .map((row) => [...within(row).queryAllByRole('rowheader'), ...within(row).queryAllByRole('cell')].map((cell) => cell.textContent));

describe('LevelTable', () => {
  it('has the ten columns', () => {
    render(<LevelTable status="ready" rows={view.table} />);

    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Level',
      'Runs',
      'Complete',
      'Fail',
      'Quit',
      'Unfinished',
      'Completion',
      'Avg duration',
      'Most fails at',
      'Top failure reason'
    ]);
    expect(screen.getByRole('region', { name: 'Per-level detail' })).toBeInTheDocument();
  });

  it('shows one row per level, including a level with only unfinished runs', () => {
    render(<LevelTable status="ready" rows={view.table} />);
    const rows = bodyRows();

    expect(rows).toHaveLength(7);
    expect(rows[0]).toEqual(['L1', '530', '438', '52', '22', '18', '85.5%', '00:42', '0–19%', 'Wall · 31']);
    expect(rows[6]).toEqual(['L7', '9', '0', '0', '0', '9', '—', '—', '—', '—']);
    expect(screen.getByRole('rowheader', { name: 'L1' })).toBeInTheDocument();
  });

  it('does not make rows keyboard stops', () => {
    render(<LevelTable status="ready" rows={view.table} />);

    for (const row of screen.getAllByRole('row')) expect(row).not.toHaveAttribute('tabindex');
  });

  it('shows placeholder rows while loading', () => {
    render(<LevelTable status="loading" />);

    expect(screen.getAllByRole('columnheader')).toHaveLength(10);
    expect(bodyRows()).toEqual([]);
  });

  it.each(['No levels played yet', 'Data unavailable'])('shows the message "%s" in one row', (message) => {
    render(<LevelTable status="message" message={message} />);

    expect(bodyRows()).toEqual([[message]]);
  });
});
