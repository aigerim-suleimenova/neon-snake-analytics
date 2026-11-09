import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { sampleLevels, sampleOverview, unfinishedOnlyLevel } from '../api/sampleStats';
import { toDashboardView } from '../view/toDashboardView';
import { ChartCard } from './ChartCard';
import { CompletionChart } from './CompletionChart';
import { StackedBarChart } from './StackedBarChart';

const view = toDashboardView(sampleOverview, [...sampleLevels, unfinishedOnlyLevel]);

const card = (body: Parameters<typeof ChartCard>[0]['body']) =>
  render(<ChartCard title="Completion rate by level" subtitle="Difficulty curve" source="GET /api/stats/levels · completionRate" body={body} />);

describe('ChartCard', () => {
  it('shows the title, subtitle, source and the graph', () => {
    card({ status: 'ready', chart: <p>the graph</p> });

    expect(screen.getByRole('heading', { level: 2, name: 'Completion rate by level' })).toBeInTheDocument();
    expect(screen.getByText('Difficulty curve')).toBeInTheDocument();
    expect(screen.getByText('GET /api/stats/levels · completionRate')).toBeInTheDocument();
    expect(screen.getByText('the graph')).toBeInTheDocument();
  });

  it('shows a placeholder instead of the graph while loading', () => {
    card({ status: 'loading' });

    expect(screen.getByRole('heading', { name: 'Completion rate by level' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it.each(['No level data yet', 'Data unavailable'])('shows the message "%s"', (message) => {
    card({ status: 'message', message });

    expect(screen.getByText(message)).toBeInTheDocument();
  });
});

describe('CompletionChart', () => {
  it('names one bar per level with its rate', () => {
    render(<CompletionChart rows={view.completion} />);
    const bars = within(screen.getByRole('list', { name: 'Completion rate by level' })).getAllByRole('listitem');

    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual([
      'Level 1: 85.5% completion',
      'Level 2: 77.4% completion',
      'Level 3: 63.5% completion',
      'Level 4: 49.3% completion',
      'Level 5: 27.4% completion',
      'Level 6: 0.0% completion',
      'Level 7: no finished runs'
    ]);
  });

  it('prints 0.0% for a real zero and — for a level without finished runs', () => {
    render(<CompletionChart rows={view.completion} />);
    const bars = screen.getAllByRole('listitem');

    expect(bars[5]).toHaveTextContent('0.0%');
    expect(bars[6]).toHaveTextContent('—');
    expect(screen.getByText('L7')).toBeInTheDocument();
  });
});

describe('StackedBarChart', () => {
  it('describes every bar with the level, total and counts per reason', () => {
    render(<StackedBarChart label="Failed runs by reason" chart={view.reasons} palette="reason" />);
    const bars = within(screen.getByRole('list', { name: 'Failed runs by reason' })).getAllByRole('listitem');

    expect(bars[3]).toHaveAccessibleName('Level 4: 126 failed runs. Wall 22, Self collision 28, Obstacle 71, Ended by platform 5.');
    expect(bars[3]).toHaveTextContent('126');
    expect(bars[6]).toHaveAccessibleName('Level 7: 0 failed runs. Wall 0, Self collision 0, Obstacle 0, Ended by platform 0.');
  });

  it('shows the count of each segment on hover', () => {
    render(<StackedBarChart label="Failed runs by reason" chart={view.reasons} palette="reason" />);

    expect(screen.getAllByTitle('Obstacle: 71')).toHaveLength(1);
  });

  it('shows the legend in the fixed order and states the shared scale', () => {
    render(<StackedBarChart label="Failed runs by progress" chart={view.progress} palette="progress" />);
    const legend = within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem');

    expect(legend.map((item) => item.textContent)).toEqual(['0–19%', '20–39%', '40–59%', '60–79%', '80–99%']);
    expect(screen.getByText('Bar length: failed runs, same scale for every level')).toBeInTheDocument();
  });
});
