import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { emptyOverview, sampleLevels, sampleOverview } from '../api/sampleStats';
import { toDashboardView } from '../view/toDashboardView';
import { KpiGrid } from './KpiGrid';

const LABELS = ['Sessions', 'Total runs', 'Finished runs', 'Unfinished runs', 'Completion rate', 'Runs per session'];

/** The value and explanation shown under each label, in order. */
const cards = () =>
  LABELS.map((label) => {
    const card = screen.getByText(label).parentElement as HTMLElement;
    return within(card)
      .getAllByRole('definition')
      .map((dd) => dd.textContent);
  });

describe('KpiGrid', () => {
  it('shows the six values with their explanations', () => {
    render(<KpiGrid status="ready" kpis={toDashboardView(sampleOverview, sampleLevels).kpis} />);

    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument();
    expect(cards()).toEqual([
      ['1,284', 'game page visits'],
      ['2,472', 'all level attempts'],
      ['2,332', 'ended: complete, fail or quit'],
      ['140', 'no end yet: playing or tab closed'],
      ['60.7%', 'complete ÷ finished runs'],
      ['1.93', 'attempts per visit']
    ]);
  });

  it('shows zero counts and — for the rates without gameplay', () => {
    render(<KpiGrid status="ready" kpis={toDashboardView(emptyOverview, []).kpis} />);

    expect(cards().map(([value]) => value)).toEqual(['0', '0', '0', '0', '—', '—']);
  });

  it('shows the labels with placeholders while loading', () => {
    render(<KpiGrid status="loading" />);

    expect(cards()).toEqual([
      ['', 'game page visits'],
      ['', 'all level attempts'],
      ['', 'ended: complete, fail or quit'],
      ['', 'no end yet: playing or tab closed'],
      ['', 'complete ÷ finished runs'],
      ['', 'attempts per visit']
    ]);
  });

  it('shows — and "Unavailable" when the backend is unreachable', () => {
    render(<KpiGrid status="unavailable" />);

    expect(cards()).toEqual(LABELS.map(() => ['—', 'Unavailable']));
  });
});
