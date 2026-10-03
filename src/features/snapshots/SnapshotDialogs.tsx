/**
 * The two snapshot dialogs.
 *
 * Creating is cheap and safe. Opening is destructive to the live project, so
 * it carries a warning *and* a one-click way to keep the work first — the
 * destructive path always has a non-destructive escape.
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FormModal, Input } from '@sudobility/components';
import { AS_TYPED_INPUT_CLASS } from '@/components/controls/input-classes';
import { LIVE_NODE_ID } from '@/app-library';
import type { TreeNode } from '@/app-library';
import { publishNamesProblem, suggestedPublicName } from '@sudobility/music_client';

export type CreateSnapshotDialogProps = {
  open: boolean;
  /** How many snapshots the project already has, for the default name. */
  snapshotCount: number;
  /** Half of the suggested public title; the snapshot name is the other half. */
  projectName: string;
  /** The name this user last published under, pre-filled when publishing. */
  defaultPublisherName?: string;
  onCreate: (name: string, publisherName?: string, publicName?: string) => void;
  onClose: () => void;
  /** True while the snapshot is being created: Create spins, the dialog stays open. */
  creating?: boolean;
};

export function CreateSnapshotDialog({
  open,
  snapshotCount,
  projectName,
  defaultPublisherName,
  onCreate,
  onClose,
  creating = false,
}: CreateSnapshotDialogProps) {
  const { t } = useTranslation();
  // Global creation order, not per-branch: "Version 4" off "Version 2" reads
  // better than "Version 2.1.1".
  const suggested = t('snapshot.defaultName', { number: snapshotCount + 1 });
  const [name, setName] = useState(suggested);
  const [publish, setPublish] = useState(false);
  const [publisherName, setPublisherName] = useState(defaultPublisherName ?? '');
  // Linked until touched: the suggestion follows the snapshot name while it is
  // still a suggestion, and stops the moment somebody writes their own title.
  // Storing the *override* rather than the value is what makes that one state
  // instead of a value plus a flag that can disagree with it.
  const [publicNameOverride, setPublicNameOverride] = useState<string | null>(null);
  const [copyrightConfirmed, setCopyrightConfirmed] = useState(false);

  // Re-suggest whenever the dialog reopens; the count has usually moved.
  useEffect(() => {
    if (open) {
      setName(suggested);
      setPublish(false);
      setPublisherName(defaultPublisherName ?? '');
      setPublicNameOverride(null);
      setCopyrightConfirmed(false);
    }
  }, [open, suggested, defaultPublisherName]);

  const trimmed = name.trim();
  // music_client's rule, which the native sheet shares: project then snapshot
  // name, a blank half dropped.
  const publicName = publicNameOverride ?? suggestedPublicName(projectName, trimmed);

  return (
    <FormModal
      open={open}
      title={t('snapshot.createTitle')}
      onClose={onClose}
      size="small"
      closeAriaLabel={t('common.closeDialog')}
      saving={creating}
      actions={[
        { label: t('common.cancel'), onClick: onClose, variant: 'ghost', disabled: creating },
        {
          label: t('snapshot.createTitle'),
          variant: 'primary',
          loading: creating,
          loadingLabel: t('common.creating'),
          // Guarded rather than disabled: a disabled button gives no reason.
          onClick: () => {
            if (creating || trimmed.length === 0) return;
            const publisher = publisherName.trim();
            const title = publicName.trim();
            // Publishing without a name would put an unattributable row on a
            // public page, and without a title an unnamed one — the same rule
            // the snapshot hook refuses on, checked here so the dialog stays
            // open instead of closing on a request that was never sent.
            if (publish && publishNamesProblem({ publisherName: publisher, publicName: title }))
              return;
            // The promise is the point of asking: publishing is what puts the
            // work in front of people who cannot check who wrote it.
            if (publish && !copyrightConfirmed) return;
            onCreate(trimmed, publish ? publisher : undefined, publish ? title : undefined);
          },
        },
      ]}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('snapshot.createHint')}</p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t('snapshot.name')}</span>
          <Input
            aria-label={t('snapshot.name')}
            value={name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            className={AS_TYPED_INPUT_CLASS}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            aria-label={t('snapshot.publish')}
            checked={publish}
            onChange={(e) => setPublish(e.target.checked)}
          />
          <span className="text-muted-foreground">{t('snapshot.publishHint')}</span>
        </label>

        {publish && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t('snapshot.publicName')}</span>
              <Input
                aria-label={t('snapshot.publicName')}
                value={publicName}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setPublicNameOverride(e.target.value)
                }
                className={AS_TYPED_INPUT_CLASS}
              />
              <span className="text-xs text-muted-foreground">{t('snapshot.publicNameHint')}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t('snapshot.publisherName')}</span>
              <Input
                aria-label={t('snapshot.publisherName')}
                value={publisherName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setPublisherName(e.target.value)}
                className={AS_TYPED_INPUT_CLASS}
              />
              <span className="text-xs text-muted-foreground">{t('snapshot.publisherHint')}</span>
            </label>

            <p className="text-sm text-warning">{t('snapshot.copyrightWarning')}</p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-label={t('snapshot.copyrightConfirm')}
                checked={copyrightConfirmed}
                onChange={(e) => setCopyrightConfirmed(e.target.checked)}
              />
              <span className="text-muted-foreground">{t('snapshot.copyrightConfirm')}</span>
            </label>
          </>
        )}
      </div>
    </FormModal>
  );
}

export type OpenSnapshotDialogProps = {
  open: boolean;
  nodes: readonly TreeNode[];
  onOpen: (snapshotId: string) => void;
  onSnapshotFirst: () => void;
  onClose: () => void;
  /** True while the snapshot is being opened: Open spins, the dialog stays open. */
  opening?: boolean;
};

/** Pixels per generation and per lane in the flowchart. */
const DEPTH_STEP = 84;
const LANE_STEP = 120;

export function OpenSnapshotDialog({
  open,
  nodes,
  onOpen,
  onSnapshotFirst,
  onClose,
  opening = false,
}: OpenSnapshotDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <FormModal
      open={open}
      title={t('snapshot.openTitle')}
      onClose={onClose}
      size="large"
      closeAriaLabel={t('common.closeDialog')}
      saving={opening}
      actions={[
        {
          label: t('snapshot.snapshotFirst'),
          onClick: onSnapshotFirst,
          variant: 'ghost',
          disabled: opening,
        },
        { label: t('common.cancel'), onClick: onClose, variant: 'ghost', disabled: opening },
        {
          label: t('snapshot.open'),
          variant: 'primary',
          loading: opening,
          loadingLabel: t('common.opening'),
          onClick: () => {
            if (!opening && selected && selected !== LIVE_NODE_ID) onOpen(selected);
          },
        },
      ]}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-warning">{t('snapshot.openWarning')}</p>

        <div className="relative min-h-[200px] overflow-auto rounded border border-border p-3">
          {/* Edges first, so nodes draw over them. */}
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
            data-testid="snapshot-edges"
          >
            {nodes.map((node) => {
              const parent = node.parentId ? byId.get(node.parentId) : undefined;
              if (!parent) return null;
              return (
                <line
                  key={`${parent.id}->${node.id}`}
                  x1={parent.lane * LANE_STEP + 60}
                  y1={parent.depth * DEPTH_STEP + 20}
                  x2={node.lane * LANE_STEP + 60}
                  y2={node.depth * DEPTH_STEP + 20}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={1}
                />
              );
            })}
          </svg>

          {nodes.map((node) =>
            node.isLive ? (
              // Drawn, never clickable: "open where you already are" is a
              // no-op that reads as if it might destroy something.
              <div
                key={node.id}
                data-testid="snapshot-node-live"
                className="absolute rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground"
                style={{ left: node.lane * LANE_STEP, top: node.depth * DEPTH_STEP }}
              >
                {t('snapshot.currentWork')}
              </div>
            ) : (
              <button
                key={node.id}
                type="button"
                onClick={() => setSelected(node.id)}
                aria-pressed={selected === node.id}
                className={`absolute rounded border px-2 py-1 text-xs ${
                  selected === node.id ? 'border-primary bg-accent' : 'border-border'
                }`}
                style={{ left: node.lane * LANE_STEP, top: node.depth * DEPTH_STEP }}
              >
                {node.name}
              </button>
            ),
          )}
        </div>
      </div>
    </FormModal>
  );
}
