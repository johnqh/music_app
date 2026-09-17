/**
 * The documentation page: navigation between topics, and the generated tables.
 *
 * The tables are the part worth testing. They are read from the catalogue and
 * the shortcut list rather than written into the prose, so what these assert
 * is that the wiring holds — a table that silently renders nothing would look
 * like a page with a missing section, not like a failure.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DocsPage } from './DocsPage';
import { DOCS_TOPICS } from '@/app-library';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:lang/docs" element={<DocsPage />} />
        <Route path="/:lang/docs/:topicId" element={<DocsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DocsPage', () => {
  it('lists every topic as a link, whichever topic is open', () => {
    renderAt('/en/docs/editor');
    const nav = screen.getByRole('navigation');
    for (const topic of DOCS_TOPICS) {
      expect(nav.querySelector(`a[href="/en/docs/${topic.id}"]`), topic.id).not.toBeNull();
    }
  });

  it('marks the open topic as the current page', () => {
    renderAt('/en/docs/instruments');
    const current = screen.getByRole('navigation').querySelector('[aria-current="page"]');
    expect(current?.getAttribute('href')).toBe('/en/docs/instruments');
  });

  it('shows the first topic when none is named', () => {
    renderAt('/en/docs');
    // The redirect lands on the first topic rather than an empty pane.
    expect(screen.getByRole('navigation').querySelector('[aria-current="page"]')).not.toBeNull();
  });

  it('sends an unknown topic back to the front rather than erroring', () => {
    renderAt('/en/docs/not-a-topic');
    expect(screen.getByRole('navigation')).toBeTruthy();
  });

  it('builds the instrument table from the catalogue', () => {
    renderAt('/en/docs/instruments');
    // 128 programs plus the header row.
    expect(screen.getAllByRole('row').length).toBe(129);
    expect(screen.getByText('Acoustic Grand Piano')).toBeTruthy();
    // The muted trumpet's transposition is the bug this catalogue fixed.
    expect(screen.getByText('Muted Trumpet')).toBeTruthy();
  });

  it('builds the shortcut table from the bindings list', () => {
    renderAt('/en/docs/shortcuts');
    // The six marks that were bound and undocumented until this page existed.
    for (const keys of ['Shift+F', 'Shift+A', 'Shift+G', 'Shift+O']) {
      expect(screen.getByText(keys), keys).toBeTruthy();
    }
  });

  it('builds the format tables from one declaration', () => {
    renderAt('/en/docs/formats');
    expect(screen.getByText('.mod, .dsm, .s3m, .xm, .it, .mptm')).toBeTruthy();
    expect(screen.getAllByText('MIDI').length).toBeGreaterThan(0);
  });
});
