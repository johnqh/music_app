import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EditorStoreApi } from '@/app-library';
import { VoiceRecordButton } from './VoiceRecordButton';

vi.mock('@sudobility/music_editing', () => ({
  dispatchTracked: vi.fn(),
  transcribedScoreCommand: vi.fn(),
}));
vi.mock('@sudobility/music_types', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sudobility/music_types')>()),
  getMusicPosition: () => ({ tick: 0 }),
}));

describe('VoiceRecordButton', () => {
  it('opens the capture settings dialog from the toolbar button', async () => {
    const user = userEvent.setup();
    const store = {
      getState: () => ({ score: {}, pushToast: vi.fn() }),
    } as unknown as EditorStoreApi;

    render(<VoiceRecordButton store={store} className="" iconClassName="" />);

    await user.click(screen.getByRole('button', { name: 'Record voice' }));

    expect(screen.getByRole('dialog', { name: 'Record and transcribe audio' })).toBeTruthy();
    expect(screen.getByLabelText('Record from')).toBeTruthy();
    expect(screen.getByLabelText('Input device')).toBeTruthy();
    expect(screen.getByLabelText('Transcribe')).toBeTruthy();
  });
});
