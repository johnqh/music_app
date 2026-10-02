/**
 * The style menu, as `Select` children: "No style", then each family heading
 * with its styles.
 *
 * A component of its own for the reason `InstrumentSelectItems` is one —
 * `Select` wants its groups as children, and both generation dialogs want
 * exactly the same ones. The grouping is music_types' `STYLE_FAMILY_OF`, the
 * sorting music_lib's `groupedStyleOptions`, which the native pickers draw
 * flattened. A family is a heading only; the value chosen is still one style.
 */
import { SelectGroup, SelectItem, SelectLabel } from '@sudobility/components';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { NO_MARK, groupedStyleOptions, styleFamilyLabelKey, styleLabelKey } from '@/app-library';

export function StyleSelectItems() {
  const { t, i18n } = useTranslation();
  const groups = useMemo(
    () =>
      groupedStyleOptions(
        (style) => t(styleLabelKey(style)),
        (family) => t(styleFamilyLabelKey(family)),
        i18n.language,
      ),
    [t, i18n.language],
  );
  return (
    <>
      <SelectItem value={NO_MARK}>{t('generateScore.noStyle')}</SelectItem>
      {groups.map((group) => (
        <SelectGroup key={group.family}>
          <SelectLabel>{group.label}</SelectLabel>
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
