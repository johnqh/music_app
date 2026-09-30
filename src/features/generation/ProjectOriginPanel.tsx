/**
 * Where the open project came from, on the inspector's Score tab.
 *
 * A project's row records only an origin — the job that generated it, the
 * file it was imported from, the recording it was transcribed from, or the
 * project it copies. Everything else is read back from where it already
 * lives: a generated project's request, date, model and token count are on
 * its job (`GET /projects/:id/jobs`), and a duplicate's source name is in
 * the projects list the dashboard already holds. Nothing here fetches a
 * score.
 *
 * The rows for a generated project are the request as it was sent — the
 * brief, not the choices the server rolled from it; those are the
 * `GenerationChoices` panel's, shown beneath this one.
 */
import { useTranslation } from 'react-i18next';
import {
  GENERATION_VARIANT_LABELS,
  keySignatureOptions,
  type GenerateScoreRequest,
  type GenerationJobDetail,
  type ProjectOrigin,
} from '@sudobility/music_types';
import { useProjectJobs, useProjects } from '@sudobility/music_client';
import { complexityLabelKey, moodLabelKey, styleLabelKey } from '@/app-library';
import { useMusicHookContext } from '@/app/AuthContext';

export type ProjectOriginProps = {
  /** Null for a project written before origins were recorded. */
  origin: ProjectOrigin | null;
  projectId: string;
};

type Row = readonly [label: string, value: string];

function OriginRows({ rows }: { rows: readonly Row[] }) {
  return (
    <dl className="flex flex-col gap-1 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start gap-2">
          <dt className="shrink-0 text-muted-foreground">{label}:</dt>
          <dd className="min-w-0 flex-1 whitespace-pre-line break-words text-foreground">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Whether a job's stored request is a whole-score brief rather than a region's. */
function isScoreRequest(request: GenerationJobDetail['request']): request is GenerateScoreRequest {
  return 'durationMeasures' in request;
}

/**
 * The request a job was written to, in readable rows, then what the job cost.
 * Pure: handed the job, so it can be rendered and tested without a server.
 */
export function GeneratedOriginDetails({ job }: { job: GenerationJobDetail }) {
  const { t } = useTranslation();
  const rows: Row[] = [];

  if (isScoreRequest(job.request)) {
    const request = job.request;
    rows.push([t('generate.prompt'), request.prompt]);
    if (request.style) rows.push([t('generateScore.style'), t(styleLabelKey(request.style))]);
    if (request.mood) rows.push([t('generateScore.mood'), t(moodLabelKey(request.mood))]);
    if (request.tempo !== undefined)
      rows.push([t('generateScore.tempo'), t('projectOrigin.tempoValue', { bpm: request.tempo })]);
    if (request.keySignature) {
      const { fifths, mode } = request.keySignature;
      const tonic =
        keySignatureOptions(mode).find((option) => option.fifths === fifths)?.tonic ??
        String(fifths);
      rows.push([t('generateScore.key'), `${tonic} ${t(`key.${mode}`)}`]);
    }
    if (request.timeSignature) {
      const { numerator, denominator } = request.timeSignature;
      rows.push([t('generateScore.timeSignature'), `${numerator}/${denominator}`]);
    }
    rows.push([
      t('generateScore.measures'),
      t('projectOrigin.barsValue', { count: request.durationMeasures }),
    ]);
    if (request.tracks.length > 0) {
      rows.push([
        t('projectOrigin.lineup'),
        request.tracks
          .map((track) =>
            track.instrumentName && track.instrumentName !== track.name
              ? `${track.name} — ${track.instrumentName}`
              : track.name,
          )
          .join('\n'),
      ]);
    }
    if (request.lyrics && request.lyricsTheme?.trim())
      rows.push([t('newProject.lyricsTheme'), request.lyricsTheme.trim()]);
    if (request.complexity)
      rows.push([t('generateScore.complexity'), t(complexityLabelKey(request.complexity))]);
    // A name the server maps to a backend, shown as the picker shows it; an
    // unlisted one is printed as sent rather than hidden.
    const variant = request.variant ?? 'default';
    rows.push([
      t('projectOrigin.backend'),
      variant in GENERATION_VARIANT_LABELS
        ? GENERATION_VARIANT_LABELS[variant as keyof typeof GENERATION_VARIANT_LABELS]
        : variant,
    ]);
  }

  rows.push([
    t('projectOrigin.generatedOn'),
    new Date(job.finishedAt ?? job.createdAt).toLocaleString(),
  ]);
  if (job.usage) {
    rows.push([t('projectOrigin.modelUsed'), job.usage.model]);
    rows.push([
      t('projectOrigin.tokens'),
      t('projectOrigin.tokensValue', {
        prompt: job.usage.promptTokens,
        completion: job.usage.completionTokens,
      }),
    ]);
  }

  return <OriginRows rows={rows} />;
}

function GeneratedOrigin({ projectId, jobId }: { projectId: string; jobId: string }) {
  const { t } = useTranslation();
  const hookContext = useMusicHookContext();
  const jobs = useProjectJobs(hookContext, projectId);
  const job = jobs.data?.find((candidate) => candidate.id === jobId);
  if (job) return <GeneratedOriginDetails job={job} />;
  return (
    <p className="text-xs text-muted-foreground">
      {jobs.isSuccess ? t('projectOrigin.jobMissing') : t('projectOrigin.jobLoading')}
    </p>
  );
}

function DuplicatedOrigin({ sourceProjectId }: { sourceProjectId: string }) {
  const { t } = useTranslation();
  const hookContext = useMusicHookContext();
  // The summaries list, never the source project itself: naming it must not
  // download its score.
  const projects = useProjects(hookContext);
  const source = projects.data?.find((project) => project.id === sourceProjectId);
  const name = source
    ? source.name
    : projects.isSuccess
      ? t('projectOrigin.sourceMissing')
      : sourceProjectId;
  return <OriginRows rows={[[t('projectOrigin.sourceProject'), name]]} />;
}

export function ProjectOriginPanel({ origin, projectId }: ProjectOriginProps) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="project-origin-heading" className="flex flex-col gap-2">
      <p id="project-origin-heading" className="text-sm font-semibold text-foreground">
        {t('projectOrigin.heading')}
      </p>
      <p className="text-xs text-foreground">
        {t(`projectOrigin.kind.${origin?.kind ?? 'unknown'}`)}
      </p>
      {origin?.kind === 'imported' && (
        <OriginRows
          rows={[
            [t('projectOrigin.format'), t(`docs.formats.name.${origin.format}`)],
            ...(origin.fileName ? [[t('projectOrigin.file'), origin.fileName] as Row] : []),
          ]}
        />
      )}
      {origin?.kind === 'transcribed' && origin.fileName && (
        <OriginRows rows={[[t('projectOrigin.file'), origin.fileName]]} />
      )}
      {origin?.kind === 'duplicated' && (
        <DuplicatedOrigin sourceProjectId={origin.sourceProjectId} />
      )}
      {origin?.kind === 'generated' && (
        <GeneratedOrigin projectId={projectId} jobId={origin.jobId} />
      )}
    </section>
  );
}
