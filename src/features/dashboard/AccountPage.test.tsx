/**
 * The dashboard's Account page: a nickname and a picture.
 *
 * What is pinned is what reaches the server — a trimmed name, null for a
 * name taken away, a picture already resized — and that the page says so when
 * it does not get there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserProfile } from '@sudobility/music_types';

const mocks = vi.hoisted(() => ({
  profile: { nickname: 'Ada', avatarId: null } as UserProfile,
  update: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  fails: false,
}));

function mutation(spy: (variables: unknown) => void) {
  return {
    isPending: false,
    mutate: (variables: unknown, options?: { onError?: () => void }) => {
      spy(variables);
      if (mocks.fails) options?.onError?.();
    },
  };
}

vi.mock('@sudobility/music_client', () => ({
  useProfile: () => ({ data: mocks.profile, isLoading: false }),
  useUpdateProfile: () => mutation(mocks.update),
  useUploadAvatar: () => mutation(mocks.upload),
  useDeleteAvatar: () => mutation(mocks.remove),
}));
vi.mock('@/app/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'ada@example.com' }, hookContext: {} }),
}));
vi.mock('@/config/initialize', () => ({
  getAppServices: () => ({
    musicClient: { avatarUrl: (id: string) => `https://api.test/avatars/${id}` },
  }),
}));

const { AccountPage } = await import('./AccountPage');

const prepared = { file: new Blob(['x'], { type: 'image/jpeg' }), filename: 'avatar.jpg' };

beforeEach(() => {
  mocks.profile = { nickname: 'Ada', avatarId: null };
  mocks.update.mockReset();
  mocks.upload.mockReset();
  mocks.remove.mockReset();
  mocks.fails = false;
});

describe('AccountPage', () => {
  it('shows the nickname the server holds, and who is signed in', () => {
    render(<AccountPage />);
    expect(screen.getByLabelText('Nickname')).toHaveValue('Ada');
    expect(screen.getByText('Signed in as ada@example.com')).toBeTruthy();
  });

  it('has nothing to save until the name changes', async () => {
    const user = userEvent.setup();
    render(<AccountPage />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText('Nickname'), ' L');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('saves the name without the spaces around it', async () => {
    const user = userEvent.setup();
    render(<AccountPage />);
    const field = screen.getByLabelText('Nickname');
    await user.clear(field);
    await user.type(field, '  Ada Lovelace  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(mocks.update).toHaveBeenCalledWith({ nickname: 'Ada Lovelace' });
  });

  it('takes the name away when the field is emptied', async () => {
    // Null, not an empty string: the server refuses a name of nothing, and
    // the publish dialog goes back to offering the last name used.
    const user = userEvent.setup();
    render(<AccountPage />);
    await user.clear(screen.getByLabelText('Nickname'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(mocks.update).toHaveBeenCalledWith({ nickname: null });
  });

  it('uploads the picture as it was prepared, not as it was chosen', async () => {
    const user = userEvent.setup();
    const prepare = vi.fn().mockResolvedValue(prepared);
    render(<AccountPage prepare={prepare} />);
    const chosen = new File(['a very large photograph'], 'holiday.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Choose picture'), chosen);
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith(prepared));
    expect(prepare).toHaveBeenCalledWith(chosen);
  });

  it('says so when a file cannot be made into a picture, and uploads nothing', async () => {
    const user = userEvent.setup();
    const prepare = vi.fn().mockRejectedValue(new Error('not an image'));
    render(<AccountPage prepare={prepare} />);
    await user.upload(
      screen.getByLabelText('Choose picture'),
      new File(['x'], 'notes.png', { type: 'image/png' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That file could not be used as a picture.',
    );
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('shows the picture and offers to remove it, once there is one', async () => {
    const user = userEvent.setup();
    mocks.profile = { nickname: 'Ada', avatarId: 'abc123' };
    render(<AccountPage />);
    expect(screen.getByRole('img', { name: 'Profile picture' })).toHaveAttribute(
      'src',
      'https://api.test/avatars/abc123',
    );
    await user.click(screen.getByRole('button', { name: 'Remove picture' }));
    expect(mocks.remove).toHaveBeenCalled();
  });

  it('offers no removal where there is nothing to remove', () => {
    render(<AccountPage />);
    expect(screen.queryByRole('button', { name: 'Remove picture' })).toBeNull();
  });

  it('says so when the server refuses', async () => {
    const user = userEvent.setup();
    mocks.fails = true;
    render(<AccountPage />);
    await user.type(screen.getByLabelText('Nickname'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save your profile.');
  });
});
