/**
 * The two snapshot dialogs.
 *
 * Creating is cheap and safe. Opening is destructive to the live project, so
 * it carries a warning *and* a one-click way to keep the work first — the
 * destructive path always has a non-destructive escape.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormModal } from '@sudobility/components';
import { LIVE_NODE_ID } from '@/features/snapshots/snapshot-tree';
import type { TreeNode } from '@/features/snapshots/snapshot-tree';

export type CreateSnapshotDialogProps = {
  open: boolean;
  /** How many snapshots the project already has, for the default name. */
  snapshotCount: number;
  /** The name this user last published under, pre-filled when publishing. */
  defaultPublisherName?: string;
  onCreate: (name: string, publisherName?: string) => void;
  onClose: () => void;
};

export function CreateSnapshotDialog({
  open,
  snapshotCount,
  defaultPublisherName,
  onCreate,
  onClose,
}: CreateSnapshotDialogProps) {
  const { t } = useTranslation();
  // Global creation order, not per-branch: "Version 4" off "Version 2" reads
  // better than "Version 2.1.1".
  const suggested = `Version ${snapshotCount + 1}`;
  const [name, setName] = useState(suggested);
  const [publish, setPublish] = useState(false);
  const [publisherName, setPublisherName] = useState(defaultPublisherName ?? '');

  // Re-suggest whenever the dialog reopens; the count has usually moved.
  useEffect(() => {
    if (open) {
      setName(suggested);
      setPublish(false);
      setPublisherName(defaultPublisherName ?? '');
    }
  }, [open, suggested, defaultPublisherName]);

  const trimmed = name.trim();

  return (
    <FormModal
      open={open}
      title={t('snapshot.createTitle')}
      onClose={onClose}
      size="small"
      closeAriaLabel={t('common.closeDialog')}
      actions={[
        { label: t('common.cancel'), onClick: onClose, variant: 'ghost' },
        {
          label: t('snapshot.createTitle'),
          variant: 'primary',
          // Guarded rather than disabled: a disabled button gives no reason.
          onClick: () => {
            if (trimmed.length === 0) return;
            const publisher = publisherName.trim();
            // Publishing without a name would put an unattributable row on a
            // public page, so it is guarded exactly like a blank title.
            if (publish && publisher.length === 0) return;
            onCreate(trimmed, publish ? publisher : undefined);
          },
        },
      ]}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-theme-text-secondary">{t('snapshot.createHint')}</p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-theme-text-secondary">{t('snapshot.name')}</span>
          <input
            aria-label={t('snapshot.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-theme-border bg-theme-surface px-2 py-1"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label={t('snapshot.publish')}
            checked={publish}
            onChange={(e) => setPublish(e.target.checked)}
          />
          <span className="text-theme-text-secondary">{t('snapshot.publishHint')}</span>
        </label>

        {publish && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-theme-text-secondary">{t('snapshot.publisherName')}</span>
            <input
              aria-label={t('snapshot.publisherName')}
              value={publisherName}
              onChange={(e) => setPublisherName(e.target.value)}
              className="rounded border border-theme-border bg-theme-surface px-2 py-1"
            />
            <span className="text-xs text-theme-text-secondary">{t('snapshot.publisherHint')}</span>
          </label>
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
      actions={[
        { label: t('snapshot.snapshotFirst'), onClick: onSnapshotFirst, variant: 'ghost' },
        { label: t('common.cancel'), onClick: onClose, variant: 'ghost' },
        {
          label: t('snapshot.open'),
          variant: 'primary',
          onClick: () => {
            if (selected && selected !== LIVE_NODE_ID) onOpen(selected);
          },
        },
      ]}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-amber-700 dark:text-amber-400">{t('snapshot.openWarning')}</p>

        <div className="relative min-h-[200px] overflow-auto rounded border border-theme-border p-3">
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
                  className="text-theme-border"
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
                className="absolute rounded border border-dashed border-theme-border px-2 py-1 text-xs text-theme-text-secondary"
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
                  selected === node.id ? 'border-primary bg-theme-hover-bg' : 'border-theme-border'
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
