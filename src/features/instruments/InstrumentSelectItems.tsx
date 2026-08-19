/**
 * The instrument menu, as `Select` children.
 *
 * A component of its own because `Select` wants its groups as children, and
 * both generation dialogs want exactly the same ones. The catalogue it reads
 * lives beside it in `instrument-catalog.ts`.
 */
import { SelectGroup, SelectItem, SelectLabel } from '@sudobility/components';
import { useTranslation } from 'react-i18next';
import { FAMILY_GROUPS, KIT_OPTIONS } from '@/features/instruments/instrument-catalog';

export function InstrumentSelectItems() {
  const { t } = useTranslation();
  return (
    <>
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
