import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '@/app/App';

describe('App', () => {
  it('renders the ScoreSmith title in the app bar', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'ScoreSmith' })).toBeInTheDocument();
  });
});
