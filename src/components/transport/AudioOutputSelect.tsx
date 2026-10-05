import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SpeakerWaveIcon } from '@heroicons/react/24/solid';
import { getMusicPlayerIfInitialized } from '@sudobility/music_player/core';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
} from '@sudobility/components';

type OutputPlayer = {
  setAudioOutputDevice?: (deviceId: string) => Promise<void>;
  getAudioOutputDeviceId?: () => string;
};
type SelectableMediaDevices = MediaDevices & {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>;
};

const CHOOSE_DEVICE = '__choose_audio_output__';
const DEFAULT_DEVICE = '__default_audio_output__';

export function AudioOutputSelect() {
  const { t } = useTranslation();
  const player = getMusicPlayerIfInitialized() as OutputPlayer | null;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState(player?.getAudioOutputDeviceId?.() || DEFAULT_DEVICE);
  const [failed, setFailed] = useState(false);
  const media =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator.mediaDevices as SelectableMediaDevices | undefined);
  const supported =
    typeof AudioContext !== 'undefined' &&
    'setSinkId' in AudioContext.prototype &&
    !!media &&
    !!player?.setAudioOutputDevice;

  const refresh = useCallback(async () => {
    if (!media) return;
    try {
      const found = await media.enumerateDevices();
      setDevices(
        found.filter(
          (device) =>
            device.kind === 'audiooutput' && !!device.deviceId && device.deviceId !== 'default',
        ),
      );
    } catch {
      setDevices([]);
    }
  }, [media]);

  useEffect(() => {
    if (!supported || !media) return;
    void refresh();
    media.addEventListener?.('devicechange', refresh);
    return () => media.removeEventListener?.('devicechange', refresh);
  }, [media, refresh, supported]);

  if (!supported) return null;

  const select = async (value: string) => {
    try {
      let deviceId = value === DEFAULT_DEVICE ? '' : value;
      if (value === CHOOSE_DEVICE) {
        const chosen = await media.selectAudioOutput?.();
        if (!chosen) return;
        deviceId = chosen.deviceId;
      }
      await player.setAudioOutputDevice!(deviceId);
      setSelected(deviceId || DEFAULT_DEVICE);
      setFailed(false);
      void refresh();
    } catch {
      setFailed(true);
    }
  };

  return (
    <Tooltip content={failed ? t('transport.outputUnavailable') : t('transport.audioOutput')}>
      <Select
        value={selected}
        onValueChange={(value) => void select(value)}
        onOpenChange={(open) => {
          if (open) void refresh();
        }}
      >
        <SelectTrigger aria-label={t('transport.audioOutput')} className="h-9 w-11 px-2">
          <SpeakerWaveIcon className="size-[18px]" />
          <SelectValue className="sr-only" />
        </SelectTrigger>
        <SelectContent position="popper" side="top" sideOffset={4}>
          <SelectItem value={DEFAULT_DEVICE}>{t('transport.systemDefault')}</SelectItem>
          {devices.map((device, index) => (
            <SelectItem key={device.deviceId} value={device.deviceId}>
              {device.label || t('transport.outputNumber', { number: index + 1 })}
            </SelectItem>
          ))}
          {media.selectAudioOutput ? (
            <SelectItem value={CHOOSE_DEVICE}>{t('transport.chooseOutput')}</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </Tooltip>
  );
}
