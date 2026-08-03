/**
 * The editing bar's track control: which track is active, and which tracks are
 * drawn at all.
 *
 * One control for both, because they are the same question asked twice — you
 * pick the track you are working on out of the same list you decide to look at.
 * Choosing a hidden track reveals it (handled in music_lib's `setActiveTrack`),
 * so picking one and seeing nothing happen is not a reachable state.
 */
import { CheckableSelect, Tooltip } from '@sudobility/components';
import { selectActiveTrackId, selectVisibleTrackIds, useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';

export type TrackVisibilitySelectProps = {
  store?: EditorStoreApi;
};

export function TrackVisibilitySelect({ store = useAppStore }: TrackVisibilitySelectProps) {
  const tracks = store((s) => s.score?.tracks);
  const visibleTrackIds = store(selectVisibleTrackIds);
  const activeTrackId = store(selectActiveTrackId);

  // With fewer than two tracks there is nothing to choose between and nothing
  // that could be hidden, so the control would be a permanently-disabled no-op
  // taking up toolbar width.
  if (!tracks || tracks.length < 2 || !activeTrackId) return null;

  return (
    <Tooltip placement="bottom" content="Active track, and which tracks are shown">
      <CheckableSelect
        ariaLabel="Visible tracks"
        options={tracks.map((track) => ({ value: track.id, label: track.name }))}
        value={activeTrackId}
        onChange={(trackId) => store.getState().setActiveTrack(trackId)}
        checked={visibleTrackIds}
        onCheckedChange={(ids) => store.getState().setVisibleTracks(ids)}
        className="w-[150px]"
      />
    </Tooltip>
  );
}
