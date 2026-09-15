/**
 * The editing bar's track control: which track is active, and which tracks are
 * drawn at all.
 *
 * One control for both, because they are the same question asked twice — you
 * pick the track you are working on out of the same list you decide to look at.
 * Choosing a hidden track reveals it (handled in music_lib's `setActiveTrack`),
 * so picking one and seeing nothing happen is not a reachable state.
 */
import { CheckableSelect, Tooltip, cn } from '@sudobility/components';
import { useTranslation } from 'react-i18next';
import {
  selectActiveTrackId,
  selectVisibleTrackIds,
  trackPickerVisible,
  useAppStore,
} from '@sudobility/music_lib';
import type { EditorStoreApi } from '@sudobility/music_lib';
import { TEXT_CONTROL_CLASS } from '@/components/icons/notation-icons';

export type TrackVisibilitySelectProps = {
  store?: EditorStoreApi;
};

export function TrackVisibilitySelect({ store = useAppStore }: TrackVisibilitySelectProps) {
  const { t } = useTranslation();
  const tracks = store((s) => s.score?.tracks);
  const visibleTrackIds = store(selectVisibleTrackIds);
  const activeTrackId = store(selectActiveTrackId);
  // With fewer than two tracks there is nothing to choose between and nothing
  // that could be hidden. The rule is music_editing's, shared with the native bar.
  const visible = store(trackPickerVisible);

  if (!visible || !tracks || !activeTrackId) return null;

  return (
    <Tooltip placement="bottom" content={t('editor.activeTrackHint')}>
      <CheckableSelect
        ariaLabel={t('editor.visibleTracks')}
        options={tracks.map((track) => ({ value: track.id, label: track.name }))}
        value={activeTrackId}
        onChange={(trackId) => store.getState().setActiveTrack(trackId)}
        checked={visibleTrackIds}
        onCheckedChange={(ids) => store.getState().setVisibleTracks(ids)}
        // The bar's shared height: left to itself this takes the library's
        // default, which is 8px taller than every button beside it.
        className={cn(TEXT_CONTROL_CLASS, 'w-[150px] justify-between')}
      />
    </Tooltip>
  );
}
