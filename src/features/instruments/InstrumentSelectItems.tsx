/**
 * The instrument menu, as `Select` children.
 *
 * A component of its own because `Select` wants its groups as children, and
 * both generation dialogs want exactly the same ones. The menu itself — which
 * groups, in which order — is music_types' `GENERATION_INSTRUMENT_GROUPS`,
 * which the native pickers draw too: voices first, because General MIDI files a
 * singer under Ensemble between String Ensemble and Orchestra Hit, which is
 * where nobody setting out to write a song looks for one; kits next; then the
 * GM families. A heading is either a key this product translates (voices,
 * kits) or a family's fixed GM name, printed as it is.
 */
import { SelectGroup, SelectItem, SelectLabel } from '@sudobility/components';
import { useTranslation } from 'react-i18next';
import { GENERATION_INSTRUMENT_GROUPS } from '@/app-library';

export function InstrumentSelectItems() {
  const { t } = useTranslation();
  return (
    <>
      {GENERATION_INSTRUMENT_GROUPS.map((group) => (
        <SelectGroup key={group.key}>
          <SelectLabel>{group.labelKey ? t(group.labelKey) : group.label}</SelectLabel>
          {group.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}
