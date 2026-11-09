import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FakeStatsApi } from './api/FakeStatsApi';
import { emptyOverview, sampleLevels, sampleOverview } from './api/sampleStats';
import { StatsUnavailableError } from './api/StatsApi';
import { App } from './App';

const clock = { now: () => new Date(2026, 9, 1, 12, 4) };
const CHART_TITLES = ['Completion rate by level', 'Failed runs by progress', 'Failed runs by reason'];

const renderApp = (api: FakeStatsApi) => render(<App api={api} clock={clock} />);

/** Value shown under an overview label. */
const kpi = (label: string) => within(screen.getByText(label).parentElement as HTMLElement).getAllByRole('definition')[0].textContent;

const tableBodyRows = () => within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row');

describe('App', () => {
  it('shows the loading state until both statistics arrive', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    api.hold();
    renderApp(api);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(kpi('Sessions')).toBe('');
    expect(screen.queryByRole('list', { name: 'Completion rate by level' })).not.toBeInTheDocument();

    act(() => api.release());
    expect(await screen.findByText('Updated 12:04')).toBeInTheDocument();
  });

  it('shows the overview, the three graphs and the table', async () => {
    renderApp(new FakeStatsApi(sampleOverview, sampleLevels));

    expect(await screen.findByText('Updated 12:04')).toBeInTheDocument();
    expect(kpi('Sessions')).toBe('1,284');
    expect(kpi('Completion rate')).toBe('60.7%');
    for (const title of CHART_TITLES) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByRole('list', { name: title })).toBeInTheDocument();
    }
    expect(tableBodyRows()).toHaveLength(6);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the data visible while refreshing', async () => {
    const api = new FakeStatsApi(sampleOverview, sampleLevels);
    renderApp(api);
    await screen.findByText('Updated 12:04');

    api.hold();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    expect(kpi('Sessions')).toBe('1,284');
    expect(tableBodyRows()).toHaveLength(6);

    act(() => api.release());
    expect(await screen.findByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(api.calls).toEqual({ overview: 2, levels: 2 });
  });

  it('shows the empty state without gameplay', async () => {
    renderApp(new FakeStatsApi(emptyOverview, []));

    expect(await screen.findByText('No gameplay recorded yet. Play a level in the game, then click Refresh.')).toBeInTheDocument();
    expect(kpi('Total runs')).toBe('0');
    expect(kpi('Completion rate')).toBe('—');
    expect(screen.getAllByText('No level data yet')).toHaveLength(3);
    expect(screen.getByText('No levels played yet')).toBeInTheDocument();
  });

  it('shows the error state when one request fails, and retries back to the data', async () => {
    const api = new FakeStatsApi(sampleOverview, new StatsUnavailableError('/api/stats/levels answered 503'));
    renderApp(api);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Analytics backend is unreachable');
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(kpi('Sessions')).toBe('—');
    expect(screen.getAllByText('Unavailable')).toHaveLength(6);
    expect(screen.getAllByText('Data unavailable')).toHaveLength(4);

    api.levels = sampleLevels;
    api.hold();
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDisabled();
    expect(screen.getByText('Offline')).toBeInTheDocument();

    act(() => api.release());
    expect(await screen.findByText('Updated 12:04')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(kpi('Sessions')).toBe('1,284');
  });
});
