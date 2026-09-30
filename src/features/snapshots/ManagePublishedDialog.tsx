/**
 * Renaming what the public sees.
 *
 * There is no PATCH on a snapshot and there deliberately never will be — a
 * snapshot's music never changes. The *title* it is published under is not its
 * music, though, and re-publishing is the server's own way of setting it: the
 * publish route keeps the first `publicId`, so a link already shared stays
 * valid across a rename.
 *
 * Only published snapshots appear. A row is a draft, committed on Save, so a
 * half-typed title never reaches a public page.
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FormModal, Input } from '@sudobility/components';
import { AS_TYPED_INPUT_CLASS } from '@/components/controls/input-classes';
import type { SnapshotSummary } from '@sudobility/music_types';

export type ManagePublishedDialogProps = {
  open: boolean;
  snapshots: readonly SnapshotSummary[];
  onRename: (snapshotId: string, publicName: string) => void;
  onClose: () => void;
};

export function ManagePublishedDialog({
  open,
  snapshots,
  onRename,
  onClose,
}: ManagePublishedDialogProps) {
  const { t } = useTranslation();
  const published = snapshots.filter((s) => s.publicId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Reopening shows what the server holds, not what was typed and abandoned.
  useEffect(() => {
    if (open) setDrafts({});
  }, [open]);

  const titleOf = (snapshot: SnapshotSummary): string =>
    drafts[snapshot.id] ?? snapshot.publicName ?? snapshot.name;

  return (
    <FormModal
      open={open}
      title={t('snapshot.managePublishedTitle')}
      onClose={onClose}
      size="small"
      closeAriaLabel={t('common.closeDialog')}
      actions={[
        { label: t('common.cancel'), onClick: onClose, variant: 'ghost' },
        {
          label: t('common.save'),
          variant: 'primary',
          onClick: () => {
            for (const snapshot of published) {
              const next = titleOf(snapshot).trim();
              // Only what actually changed, and never to nothing: a blank
              // title would leave the page with no name at all.
              if (next.length === 0 || next === (snapshot.publicName ?? snapshot.name)) continue;
              onRename(snapshot.id, next);
            }
            onClose();
          },
        },
      ]}
    >
      <div className="flex flex-col gap-4">
        {published.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('snapshot.nonePublished')}</p>
        ) : (
          published.map((snapshot) => (
            <label key={snapshot.id} className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {t('snapshot.publicNameFor', { name: snapshot.name })}
              </span>
              <Input
                aria-label={t('snapshot.publicNameFor', { name: snapshot.name })}
                value={titleOf(snapshot)}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setDrafts((prev) => ({ ...prev, [snapshot.id]: e.target.value }))
                }
                className={AS_TYPED_INPUT_CLASS}
              />
            </label>
          ))
        )}
      </div>
    </FormModal>
  );
}
