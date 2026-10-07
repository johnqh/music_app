import { openLiveGeneration } from '@sudobility/music_client';
import type { MusicClient, UploadableFile } from '@sudobility/music_client';
import type { Score } from '@sudobility/music_types';

/** The existing project job owns polling and authentication for a voice take. */
export async function transcribeVoiceRecording(
  client: MusicClient,
  token: string,
  file: UploadableFile,
  filename: string,
  cancelled: () => boolean,
  onProjectCreated?: (projectId: string) => void,
  onProgress?: (progress: {
    stage: 'plan' | 'part' | 'section' | 'chunk';
    label: string;
    done: number;
    total: number;
  }) => void,
  scope: 'voice' | 'all' = 'voice',
): Promise<{ score: Score; projectId: string }> {
  const project = await client.transcribeAudio(
    file,
    filename,
    token,
    scope === 'voice' ? { instrument: 'voice' } : undefined,
  );
  const live = openLiveGeneration({
    baseUrl: client.baseUrl,
    projectId: project.id,
    getToken: async () => token,
    onMessage: (message) => {
      if (message.type === 'progress') {
        onProgress?.({
          stage: message.stage,
          label: message.label,
          done: message.done,
          total: message.total,
        });
      }
    },
  });
  onProjectCreated?.(project.id);
  try {
    for (;;) {
      if (cancelled()) throw new Error('Recording transcription was interrupted');
      const status = await client.getProjectStatus(project.id, token);
      if (status.status === 'ready') {
        if (status.lastGenerationError) throw new Error(status.lastGenerationError);
        const result = await client.getProject(project.id, token);
        return { score: result.score, projectId: project.id };
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } finally {
    live.close();
  }
}
