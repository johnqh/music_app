import { useEffect, useRef, useState } from 'react';
import { MicrophoneIcon } from '@heroicons/react/24/solid';
import { Button, FormModal, Tooltip } from '@sudobility/components';
import { dispatchTracked, transcribedScoreCommand } from '@sudobility/music_editing';
import { getMusicPosition } from '@sudobility/music_types';
import { useTranslation } from 'react-i18next';
import { getAppServices } from '@/config/initialize';
import type { EditorStoreApi } from '@/app-library';
import { transcribeVoiceRecording } from './transcribe-recording';
import { microphoneMp3 } from './microphone-mp3';

type Capture = {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  anchorTick: number;
  scope: 'voice' | 'all';
};

export function VoiceRecordButton({
  store,
  className,
  iconClassName,
  onStart,
  onTranscriptionJob,
}: {
  store: EditorStoreApi;
  className: string;
  iconClassName: string;
  onStart?: () => void;
  onTranscriptionJob?: (
    projectId: string,
    cancel: () => void,
    progress?: {
      stage: 'plan' | 'part' | 'section' | 'chunk';
      label: string;
      done: number;
      total: number;
    },
  ) => void;
}) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [source, setSource] = useState<'microphone' | 'speakers'>('microphone');
  const [scope, setScope] = useState<'voice' | 'all'>('voice');
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const capture = useRef<Capture | null>(null);
  const cancelled = useRef(false);

  const reportError = (cause: unknown, fallback: string) => {
    const message = cause instanceof Error ? cause.message : fallback;
    setError(message);
    store.getState().pushToast({ message, severity: 'error' });
  };

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      const active = capture.current;
      if (active?.recorder.state !== 'inactive') active?.recorder.stop();
      active?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!dialogOpen || !navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((list) => setDevices(list.filter((device) => device.kind === 'audioinput')))
      .catch(() => setDevices([]));
  }, [dialogOpen]);

  const start = async () => {
    if (sending || recording) return;
    cancelled.current = false;
    setError(null);
    const state = store.getState();
    if (!state.score) {
      reportError(new Error(t('editor.recordVoiceError')), t('editor.recordVoiceError'));
      return;
    }
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      setError(t('editor.microphoneUnavailable'));
      return;
    }
    let stream: MediaStream | null = null;
    setSending(true);
    try {
      const { musicClient, auth } = getAppServices();
      const token = await auth.getToken();
      if (!token) throw new Error(t('errors.mustSignIn'));
      const capability = await musicClient.getTranscriptionCapability(token);
      if (!capability.available) throw new Error(t('importAudio.unavailable'));
      if (cancelled.current) return;
      stream =
        source === 'speakers'
          ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          : await navigator.mediaDevices.getUserMedia({
              audio: deviceId ? { deviceId: { exact: deviceId } } : true,
            });
      if (source === 'speakers') stream.getVideoTracks().forEach((track) => track.stop());
      if (!stream.getAudioTracks().length) throw new Error(t('editor.speakerCaptureUnavailable'));
      if (cancelled.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start();
      capture.current = {
        recorder,
        stream,
        chunks,
        anchorTick: getMusicPosition().tick,
        scope: source === 'speakers' ? 'all' : scope,
      };
      onStart?.();
      setRecording(true);
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      if (!cancelled.current) reportError(cause, t('editor.microphoneDenied'));
    } finally {
      if (!cancelled.current) setSending(false);
    }
  };

  const stop = async () => {
    const active = capture.current;
    if (!active) return;
    capture.current = null;
    setRecording(false);
    setSending(true);
    let cleanupTranscriptionProject: () => Promise<unknown> = async () => undefined;
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        active.recorder.onstop = () =>
          resolve(new Blob(active.chunks, { type: active.recorder.mimeType || 'audio/webm' }));
        active.recorder.onerror = () => reject(new Error(t('editor.recordVoiceError')));
        active.recorder.stop();
      });
      if (blob.size === 0) throw new Error(t('editor.emptyRecording'));
      const { musicClient, auth, io } = getAppServices();
      const file = await microphoneMp3(blob, io.audioCodec);
      const token = await auth.getToken();
      if (!token) throw new Error(t('errors.mustSignIn'));
      let projectId = '';
      let cancelJob = () => undefined;
      const result = await transcribeVoiceRecording(
        musicClient,
        token,
        file,
        file.name,
        () => cancelled.current,
        (id) => {
          projectId = id;
          cleanupTranscriptionProject = () =>
            musicClient.deleteProject(id, token).catch(() => undefined);
          cancelJob = () => {
            cancelled.current = true;
            void musicClient
              .cancelProjectGeneration(id, token)
              .then(() => musicClient.deleteProject(id, token))
              .catch(() => undefined);
          };
          onTranscriptionJob?.(id, cancelJob);
        },
        (progress) => onTranscriptionJob?.(projectId, cancelJob, progress),
        active.scope,
      );
      if (cancelled.current) return;
      const command = transcribedScoreCommand(result.score, active.anchorTick, active.scope);
      if (!command) throw new Error(t('editor.noVoiceNotes'));
      const before = store.getState().score;
      dispatchTracked(store, command);
      if (store.getState().score === before) throw new Error(t('editor.recordVoiceError'));
    } catch (cause) {
      if (!cancelled.current) reportError(cause, t('editor.recordVoiceError'));
    } finally {
      onTranscriptionJob?.('', () => undefined);
      await cleanupTranscriptionProject();
      active.stream.getTracks().forEach((track) => track.stop());
      setSending(false);
    }
  };

  return (
    <>
      <Tooltip
        placement="bottom"
        content={error ?? t(recording ? 'editor.stopVoiceRecording' : 'editor.recordVoiceHint')}
      >
        <Button
          type="button"
          variant="ghost"
          aria-label={t(recording ? 'editor.stopVoiceRecording' : 'editor.recordVoice')}
          aria-pressed={recording}
          disabled={sending}
          onClick={() => (recording ? void stop() : setDialogOpen(true))}
          className={className}
        >
          <MicrophoneIcon className={iconClassName} />
        </Button>
      </Tooltip>
      <FormModal
        open={dialogOpen}
        title={t('editor.captureAudio')}
        onClose={() => setDialogOpen(false)}
        closeAriaLabel={t('common.closeDialog')}
        actions={[
          { label: t('common.cancel'), variant: 'ghost', onClick: () => setDialogOpen(false) },
          {
            label: t('editor.startRecording'),
            disabled: sending,
            onClick: () => {
              setDialogOpen(false);
              void start();
            },
          },
        ]}
      >
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            {t('editor.recordFrom')}
            <select
              className="rounded border bg-background p-2"
              value={source}
              onChange={(event) => setSource(event.target.value as 'microphone' | 'speakers')}
            >
              <option value="microphone">{t('editor.microphone')}</option>
              <option value="speakers">{t('editor.speakers')}</option>
            </select>
          </label>
          {source === 'microphone' && (
            <>
              <label className="grid gap-1 text-sm">
                {t('editor.inputDevice')}
                <select
                  className="rounded border bg-background p-2"
                  value={deviceId}
                  onChange={(event) => setDeviceId(event.target.value)}
                >
                  <option value="">{t('editor.defaultInput')}</option>
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || t('editor.inputDevice')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                {t('editor.transcriptionScope')}
                <select
                  className="rounded border bg-background p-2"
                  value={scope}
                  onChange={(event) => setScope(event.target.value as 'voice' | 'all')}
                >
                  <option value="voice">{t('editor.voiceTrackOnly')}</option>
                  <option value="all">{t('editor.allTracks')}</option>
                </select>
              </label>
            </>
          )}
          {source === 'speakers' && (
            <p className="text-sm text-muted-foreground">{t('editor.speakerCaptureHelp')}</p>
          )}
        </div>
      </FormModal>
    </>
  );
}
