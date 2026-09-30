/**
 * Which tracks are drawn at all.
 *
 * On the Track tab rather than the editing bar. It sat on the bar as half of
 * a control that also chose the active track, and that half went when
 * clicking a staff came to do it; this half had no other home, and nothing
 * else in the app hides a track. A list rather than a switch for the track
 * that is showing, because the tab shows the *active* track and the active
 * track is never hidden — a switch there could hide a track and never bring
 * one back.
 *
 * Absent below two tracks, by music_editing's `trackPickerVisible`: with one
 * track there is nothing that could be hidden. The last visible track cannot
 * be unticked, since a score with nothing drawn is a blank page with no way
 * to say why.
 */
import { useTranslation } from 'react-i18next';
import { selectVisibleTrackIds, trackPickerVisible } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { MixedCheckbox } from '@/components/inspector/controls';
import { FIELD_LABEL_CLASS } from '@/components/inspector/shared';

export function VisibleTracksField({ store }: { store: EditorStoreApi }) {
  const { t } = useTranslation();
  const tracks = store((s) => s.score?.tracks);
  const visibleTrackIds = store(selectVisibleTrackIds);
  const visible = store(trackPickerVisible);
  if (!visible || !tracks) return null;

  const shown = new Set(visibleTrackIds);
  const toggle = (trackId: string, checked: boolean) => {
    // In score order whatever order they were ticked in, so the stored list
    // reads the way the page does.
    const next = tracks
      .map((track) => track.id)
      .filter((id) => (id === trackId ? checked : shown.has(id)));
    if (next.length > 0) store.getState().setVisibleTracks(next);
  };

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className={FIELD_LABEL_CLASS}>{t('inspector.visibleTracks')}</legend>
      {tracks.map((track) => (
        <MixedCheckbox
          key={track.id}
          label={track.name}
          checked={shown.has(track.id)}
          // The last one showing stays: see the file comment.
          disabled={shown.has(track.id) && shown.size === 1}
          onChange={(checked) => toggle(track.id, checked)}
        />
      ))}
    </fieldset>
  );
}
