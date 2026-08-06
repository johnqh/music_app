/**
 * The two snapshot dialogs.
 *
 * Creating is cheap and safe. Opening is destructive to the live project, so
 * it carries a warning *and* a one-click way to keep the work first — the
 * destructive path always has a non-destructive escape.
 */
import { useEffect, useState } from 'react';
import { Button, Dialog } from '@sudobility/components';
import { LIVE_NODE_ID } from '@/features/snapshots/snapshot-tree';
import type { TreeNode } from '@/features/snapshots/snapshot-tree';

export type CreateSnapshotDialogProps = {
  open: boolean;
  /** How many snapshots the project already has, for the default name. */
  snapshotCount: number;
  onCreate: (name: string) => void;
  onClose: () => void;
};

export function CreateSnapshotDialog({
  open,
  snapshotCount,
  onCreate,
  onClose,
}: CreateSnapshotDialogProps) {
  // Global creation order, not per-branch: "Version 4" off "Version 2" reads
  // better than "Version 2.1.1".
  const suggested = `Version ${snapshotCount + 1}`;
  const [name, setName] = useState(suggested);

  // Re-suggest whenever the dialog reopens; the count has usually moved.
  useEffect(() => {
    if (open) setName(suggested);
  }, [open, suggested]);

  const trimmed = name.trim();

  return (
    <Dialog isOpen={open} onClose={onClose} size="sm" showCloseButton={false}>
      <h2 className="px-1 pt-1 text-lg font-semibold text-theme-text-primary">Create snapshot</h2>
      <div className="flex flex-col gap-4 p-1">
        <p className="text-sm text-theme-text-secondary">
          Pins the project as it is now. A snapshot never changes once saved.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-theme-text-secondary">Snapshot name</span>
          <input
            aria-label="Snapshot name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-theme-border bg-theme-surface px-2 py-1"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            // Guarded rather than disabled: a disabled button gives no reason.
            onClick={() => {
              if (trimmed.length === 0) return;
              onCreate(trimmed);
            }}
          >
            Create snapshot
          </Button>
        </div>
      </div>
    </Dialog>
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
  const [selected, setSelected] = useState<string | null>(null);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <Dialog isOpen={open} onClose={onClose} size="lg" showCloseButton={false}>
      <h2 className="px-1 pt-1 text-lg font-semibold text-theme-text-primary">Open snapshot</h2>
      <div className="flex flex-col gap-4 p-1">
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Your current work will be replaced by the snapshot you open. Nothing else is lost — every
          snapshot stays where it is.
        </p>

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
                Current work
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

        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={onSnapshotFirst}>
            Snapshot current work first
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                if (selected && selected !== LIVE_NODE_ID) onOpen(selected);
              }}
            >
              Open
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
