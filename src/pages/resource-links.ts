/**
 * The links the Resources page shows, and the groups they read in.
 *
 * Data lives apart from the component for the reason `docs-content.ts` does:
 * it is a list somebody edits without touching JSX, and a test can read it
 * without rendering anything. `resource-links.test.ts` is what stops a link
 * added here from shipping with no description — i18next falls back to the key
 * itself, so a missing string renders as `resources.link.midkar` and nothing
 * fails.
 */
export type Resource = {
  /** i18n key suffix under `resources.link`, and the React key. */
  key: string;
  name: string;
  url: string;
};

export type ResourceGroup = {
  /** i18n key suffix under `resources.group`, for the title and route line. */
  key: string;
  links: readonly Resource[];
};

/**
 * Grouped by which importer the files feed, in the order a reader is likely to
 * want them: scores first (the format that carries the most music), then MIDI,
 * then the two formats this app supports and most editors do not.
 *
 * Chosen for being free, long-lived and directly usable here rather than for
 * being large — a site behind a paywall or an account wall answers the page's
 * question with "no". The Mod Archive is also where this app's own tracker
 * decoder fixtures came from, so its files are the ones the importer is tested
 * against.
 */
export const RESOURCE_GROUPS: readonly ResourceGroup[] = [
  {
    key: 'scores',
    links: [
      { key: 'musescore', name: 'MuseScore', url: 'https://musescore.com/sheetmusic' },
      { key: 'openscore', name: 'OpenScore', url: 'https://musescore.com/openscore' },
      { key: 'imslp', name: 'IMSLP', url: 'https://imslp.org/' },
      { key: 'cpdl', name: 'CPDL', url: 'https://www.cpdl.org/' },
      { key: 'mutopia', name: 'Mutopia Project', url: 'https://www.mutopiaproject.org/' },
      { key: 'musopenScores', name: 'Musopen Sheet Music', url: 'https://musopen.org/sheetmusic/' },
      {
        key: 'openGoldberg',
        name: 'Open Goldberg Variations',
        url: 'https://opengoldbergvariations.org/',
      },
      {
        key: 'musicxmlDirectory',
        name: 'MusicXML.com Directory',
        url: 'https://www.musicxml.com/music-in-musicxml/',
      },
    ],
  },
  {
    key: 'midi',
    links: [
      { key: 'bitmidi', name: 'BitMidi', url: 'https://bitmidi.com/' },
      { key: 'vgmusic', name: 'VGMusic', url: 'https://www.vgmusic.com/' },
      { key: 'kunstderfuge', name: 'Kunst der Fuge', url: 'https://www.kunstderfuge.com/' },
      { key: 'midiworld', name: 'MIDIWORLD', url: 'https://www.midiworld.com/' },
      { key: 'mfiles', name: 'mfiles', url: 'https://www.mfiles.co.uk/classical-midi.htm' },
      {
        key: 'classicalArchives',
        name: 'Classical Archives',
        url: 'https://www.classicalarchives.com/prs/free.html',
      },
      { key: 'theSession', name: 'The Session', url: 'https://thesession.org/' },
      { key: 'hymnary', name: 'Hymnary', url: 'https://hymnary.org/' },
      { key: 'midkar', name: 'MIDKAR', url: 'https://midkar.com/' },
    ],
  },
  {
    key: 'modules',
    links: [
      { key: 'modarchive', name: 'The Mod Archive', url: 'https://modarchive.org/' },
      { key: 'modland', name: 'Modland', url: 'https://modland.com/' },
      { key: 'amp', name: 'Amiga Music Preservation', url: 'https://amp.dascene.net/' },
      { key: 'sceneOrg', name: 'scene.org', url: 'https://files.scene.org/browse/music/' },
      { key: 'woolyss', name: 'Woolyss Tracking', url: 'https://woolyss.com/tracking-modules.php' },
      {
        key: 'archiveTrackers',
        name: 'Tracker Collection (Internet Archive)',
        url: 'https://archive.org/details/spacedrone-ultimate-mod-xm-it-s3m-collection',
      },
    ],
  },
  {
    key: 'audio',
    links: [
      { key: 'musopenAudio', name: 'Musopen Recordings', url: 'https://musopen.org/music/' },
      { key: 'freeMusicArchive', name: 'Free Music Archive', url: 'https://freemusicarchive.org/' },
      { key: 'freesound', name: 'Freesound', url: 'https://freesound.org/' },
      {
        key: 'archiveAudio',
        name: 'Internet Archive Audio',
        url: 'https://archive.org/details/audio',
      },
    ],
  },
  {
    key: 'datasets',
    links: [
      { key: 'pdmx', name: 'PDMX', url: 'https://zenodo.org/records/14648209' },
      { key: 'lakh', name: 'Lakh MIDI Dataset', url: 'https://colinraffel.com/projects/lmd/' },
      { key: 'maestro', name: 'MAESTRO', url: 'https://magenta.withgoogle.com/datasets/maestro' },
      {
        key: 'adlPiano',
        name: 'ADL Piano MIDI',
        url: 'https://github.com/lucasnfe/adl-piano-midi',
      },
      {
        key: 'museTrainer',
        name: 'MuseTrainer Library',
        url: 'https://github.com/musetrainer/library',
      },
      {
        key: 'womenComposers',
        name: 'Scores by Women Composers',
        url: 'https://github.com/cuthbertLab/womenComposers',
      },
    ],
  },
  {
    key: 'sound',
    links: [
      { key: 'freepats', name: 'FreePATS', url: 'https://freepats.zenvoid.org/' },
      { key: 'polyphone', name: 'Polyphone', url: 'https://www.polyphone.io/en/soundfonts' },
      {
        key: 'generalUser',
        name: 'GeneralUser GS',
        url: 'https://www.schristiancollins.com/generaluser.php',
      },
      {
        key: 'philharmonia',
        name: 'Philharmonia Sound Samples',
        url: 'https://philharmonia.co.uk/resources/sound-samples/',
      },
    ],
  },
  {
    key: 'reference',
    links: [
      { key: 'musicXmlSpec', name: 'MusicXML 4.0', url: 'https://www.w3.org/2021/06/musicxml40/' },
      { key: 'generalMidi', name: 'General MIDI', url: 'https://midi.org/general-midi' },
      {
        key: 'standardMidiFile',
        name: 'Standard MIDI Files',
        url: 'https://midi.org/standard-midi-files',
      },
      { key: 'openMpt', name: 'OpenMPT', url: 'https://openmpt.org/' },
      {
        key: 'verovio',
        name: 'Verovio Humdrum Viewer',
        url: 'https://verovio.humdrum.org/',
      },
    ],
  },
];

/**
 * The bare host, for the line under each name.
 *
 * Derived rather than stored so it cannot disagree with the href above it, and
 * `www.` is dropped because it distinguishes nothing — the reader is checking
 * which site they are about to be sent to, not which subdomain.
 */
export function hostOf(url: string): string {
  return new URL(url).host.replace(/^www\./, '');
}

/**
 * The vendored site icon per link key, keyed off what is actually on disk.
 *
 * `scripts/fetch-resource-icons.ts` writes these; the glob is what reads them,
 * so the map cannot claim an icon that is not there. Four of these sites
 * publish no icon at all — CPDL, MIDIWORLD, Modland and the Lakh dataset's
 * host each answer `/favicon.ico` with an HTML error page or a 1×1 GIF — and
 * rather than carry a flag somebody has to remember to clear, a link with no
 * file here simply gets the monogram instead.
 *
 * Vendored rather than hotlinked: forty-two `<img>` tags aimed at forty-two
 * other people's servers would tell each of them who is reading this page, and
 * would break one tile at a time as those sites reorganise.
 */
const ICON_URLS = import.meta.glob('../assets/resource-icons/*.{png,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const ICONS: Record<string, string> = Object.fromEntries(
  Object.entries(ICON_URLS).map(([path, url]) => [
    path.replace(/^.*\/([^/]+)\.(png|svg)$/, '$1'),
    url,
  ]),
);

/** The site's own icon, or `undefined` when it publishes none. */
export function iconFor(key: string): string | undefined {
  return ICONS[key];
}

/** Every key an icon file exists for, so a test can spot an orphaned one. */
export function iconKeys(): string[] {
  return Object.keys(ICONS).sort();
}

/**
 * The stand-in when a site has no icon.
 *
 * One letter, not an abbreviation: "CPDL" shortened to "CP" reads as a broken
 * name, where a single initial reads as what it is — a placeholder.
 */
export function monogramFor(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}
