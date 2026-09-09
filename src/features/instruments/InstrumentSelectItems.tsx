/**
 * The instrument menu, as `Select` children.
 *
 * A component of its own because `Select` wants its groups as children, and
 * both generation dialogs want exactly the same ones. The catalogue it reads
 * lives in music_lib's `instrument-options.ts`.
 */
import { SelectGroup, SelectItem, SelectLabel } from '@sudobility/components';
import { useTranslation } from 'react-i18next';
import { FAMILY_GROUPS, KIT_OPTIONS, VOICE_OPTIONS } from '@sudobility/music_lib';

export function InstrumentSelectItems() {
  const { t } = useTranslation();
  return (
    <>
      {/* Voices first, because General MIDI files them under Ensemble between
          String Ensemble and Orchestra Hit — which is where nobody setting out
          to write a song looks for a singer, and is why generated scores never
          had one. They are removed from that family upstream, so no program is
          offered twice here. */}
      <SelectGroup>
        <SelectLabel>{t('generate.voices')}</SelectLabel>
        {VOICE_OPTIONS.map((voice) => (
          <SelectItem key={voice.value} value={voice.value}>
            {voice.label}
          </SelectItem>
        ))}
      </SelectGroup>
      <SelectGroup>
        <SelectLabel>{t('generate.drumKits')}</SelectLabel>
        {KIT_OPTIONS.map((kit) => (
          <SelectItem key={kit.value} value={kit.value}>
            {kit.label}
          </SelectItem>
        ))}
      </SelectGroup>
      {FAMILY_GROUPS.map((group) => (
        <SelectGroup key={group.key}>
          <SelectLabel>{group.label}</SelectLabel>
          {group.instruments.map((instrument) => (
            <SelectItem key={instrument.program} value={String(instrument.program)}>
              {instrument.name}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}
