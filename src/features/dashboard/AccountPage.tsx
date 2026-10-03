/**
 * The account: the name a user publishes under, and their picture.
 *
 * **The nickname is what the publish dialog offers.** A snapshot is shared
 * under a publisher name typed into that dialog, and the dialog used to
 * pre-fill whatever was typed last — a guess at what the user is called.
 * Saying it once here makes it the answer; the dialog still lets one
 * publication go out under another name.
 *
 * **The picture is resized here, before it is sent.** The server stores it
 * in its database and refuses anything over `AVATAR_MAX_BYTES`; a photograph
 * off a phone is twenty times that. It is drawn a few dozen pixels wide, so
 * `AVATAR_SIZE` square is already more than is shown.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Text } from '@sudobility/components';
import { PendingButton } from '@/components/controls/PendingButton';
import {
  useDeleteAvatar,
  useProfile,
  useUpdateProfile,
  useUploadAvatar,
} from '@sudobility/music_client';
import { AVATAR_MAX_BYTES, NICKNAME_MAX_LENGTH } from '@sudobility/music_types';
import { useAuth } from '@/app/AuthContext';
import { getAppServices } from '@/config/initialize';

/** The side of the square a picture is reduced to, in pixels. */
const AVATAR_SIZE = 256;

export type PreparedAvatar = { file: Blob; filename: string };

/**
 * A picture, cropped square from its centre and reduced to `AVATAR_SIZE`.
 *
 * JPEG, stepping the quality down until it fits: a photograph at this size is
 * a few tens of kilobytes, so the first step almost always does.
 */
async function prepareAvatar(source: File): Promise<PreparedAvatar> {
  const bitmap = await createImageBitmap(source);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2d canvas');
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();
  for (const quality of [0.9, 0.75, 0.6, 0.45]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (blob && blob.size <= AVATAR_MAX_BYTES) return { file: blob, filename: 'avatar.jpg' };
  }
  throw new Error('Too large');
}

export type AccountPageProps = {
  /** How a chosen file becomes what is uploaded. A test stands in for the canvas. */
  prepare?: (source: File) => Promise<PreparedAvatar>;
};

export function AccountPage({ prepare = prepareAvatar }: AccountPageProps) {
  const { t } = useTranslation();
  const { user, hookContext } = useAuth();
  const profile = useProfile(hookContext);
  const update = useUpdateProfile(hookContext);
  const upload = useUploadAvatar(hookContext);
  const remove = useDeleteAvatar(hookContext);

  const saved = profile.data?.nickname ?? '';
  const [nickname, setNickname] = useState(saved);
  // What the server holds, once it says: the field starts empty while the
  // profile loads, and must not stay empty when the answer is a name.
  useEffect(() => setNickname(saved), [saved]);

  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const trimmed = nickname.trim();
  /** Reading and shrinking a chosen picture, before its upload starts. */
  const [preparing, setPreparing] = useState(false);
  const busy = update.isPending || upload.isPending || remove.isPending || preparing;
  const avatarId = profile.data?.avatarId ?? null;

  const saveNickname = () => {
    if (busy) return;
    setProblem(null);
    update.mutate(
      { nickname: trimmed === '' ? null : trimmed },
      { onError: () => setProblem(t('account.saveFailed')) },
    );
  };

  const choosePicture = async (event: ChangeEvent<HTMLInputElement>) => {
    const source = event.target.files?.[0];
    // Cleared, so choosing the same file again is still a change.
    event.target.value = '';
    if (!source) return;
    setProblem(null);
    let prepared: PreparedAvatar;
    setPreparing(true);
    try {
      prepared = await prepare(source);
    } catch {
      setProblem(t('account.pictureUnsupported'));
      return;
    } finally {
      setPreparing(false);
    }
    upload.mutate(prepared, { onError: () => setProblem(t('account.saveFailed')) });
  };

  return (
    <div className="flex max-w-xl flex-col gap-8">
      {user?.email ? (
        <Text as="p" color="muted">
          {t('account.signedInAs', { email: user.email })}
        </Text>
      ) : null}

      <section className="flex flex-col gap-2">
        <label htmlFor="account-nickname" className="text-sm font-medium text-foreground">
          {t('account.nickname')}
        </label>
        <div className="flex gap-2">
          <Input
            id="account-nickname"
            value={nickname}
            maxLength={NICKNAME_MAX_LENGTH}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setNickname(event.target.value)}
            disabled={profile.isLoading}
          />
          <PendingButton
            type="button"
            onClick={saveNickname}
            disabled={busy || profile.isLoading || trimmed === saved}
            pending={update.isPending}
            pendingLabel={t('common.saving')}
          >
            {t('common.save')}
          </PendingButton>
        </div>
        <Text as="p" size="sm" color="muted">
          {t('account.nicknameHint')}
        </Text>
      </section>

      <section className="flex flex-col gap-3">
        <Text as="p" weight="medium">
          {t('account.picture')}
        </Text>
        <div className="flex items-center gap-4">
          {avatarId ? (
            <img
              src={getAppServices().musicClient.avatarUrl(avatarId)}
              alt={t('account.picture')}
              width={72}
              height={72}
              className="h-[72px] w-[72px] rounded-full object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="h-[72px] w-[72px] rounded-full border border-border bg-muted"
            />
          )}
          <div className="flex flex-wrap gap-2">
            {/*
              The platform's own file chooser, behind a button that looks like
              the rest of the page. Hidden from sight only: it keeps its label,
              so it is still what a screen reader finds.
            */}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label={t('account.choosePicture')}
              className="sr-only"
              disabled={busy}
              onChange={(event) => void choosePicture(event)}
            />
            <PendingButton
              type="button"
              variant="outline"
              disabled={busy}
              pending={preparing || upload.isPending}
              pendingLabel={t('common.uploading')}
              onClick={() => fileInput.current?.click()}
              // The input above carries the name; this is the same control
              // to somebody not looking at it.
              aria-hidden="true"
              tabIndex={-1}
            >
              {t('account.choosePicture')}
            </PendingButton>
            {avatarId ? (
              <PendingButton
                type="button"
                variant="outline"
                disabled={busy}
                pending={remove.isPending}
                pendingLabel={t('common.removing')}
                onClick={() => {
                  setProblem(null);
                  remove.mutate(undefined, {
                    onError: () => setProblem(t('account.saveFailed')),
                  });
                }}
              >
                {t('account.removePicture')}
              </PendingButton>
            ) : null}
          </div>
        </div>
        <Text as="p" size="sm" color="muted">
          {t('account.pictureHint')}
        </Text>
      </section>

      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
