/**
 * The starter scores, behind a button instead of down the page.
 *
 * The Templates grid used to sit permanently between the toolbar and the
 * project list, which put twelve cards nobody had asked for above the projects
 * somebody came to open — and pushed the list itself below the fold on a laptop
 * once a handful of projects existed. It is a *way of starting* a project, so
 * it belongs beside the other one, as a modal off "New from Template".
 *
 * Choosing a template **is** the action, so there is no confirm step and no
 * primary CTA: the footer is Cancel alone. A `FormModal` with one destructive-
 * less action is the same shell every other dialog here uses, which is what
 * makes it full-screen on a phone with the Cancel pinned to the bottom.
 *
 * The templates themselves come from music_lib — which instruments, clefs, keys
 * and bar counts a starter score has is a decision about the product, and two
 * apps read the same list. Only the words are the host's, through
 * `libraryCopy.templates()`.
 */
import { useTranslation } from 'react-i18next';
import { Button, FormModal, Text, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
import { projectTemplates } from '@/app-library';
import { libraryCopy } from '@/i18n/library-copy';

export type TemplatePickerDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Receives the chosen template's id; the dashboard builds and opens it. */
  onChoose: (templateId: string) => void;
};

export function TemplatePickerDialog({ open, onClose, onChoose }: TemplatePickerDialogProps) {
  const { t } = useTranslation();
  return (
    <FormModal
      open={open}
      title={t('dashboard.templatesTitle')}
      onClose={onClose}
      size="large"
      closeAriaLabel={t('common.closeDialog')}
      actions={[{ label: t('common.cancel'), onClick: onClose, variant: 'ghost' }]}
    >
      <div className="flex flex-col gap-4">
        <Text as="p" size="sm" color="muted">
          {t('dashboard.templatesDescription')}
        </Text>
        {/*
          `{ sm: 1, md: 2 }` in Tailwind terms: `@sudobility/components`' Grid
          emits `sm` unprefixed, so a two-column base would be two columns on a
          phone — which is why this is written as plain classes here, matching
          the card grid the project list uses.
        */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {projectTemplates(libraryCopy.templates()).map((template) => (
            <Button
              key={template.id}
              type="button"
              variant="ghost"
              aria-label={t('dashboard.newFromTemplate', { name: template.name })}
              onClick={() => onChoose(template.id)}
              className={cn(
                variants.card.default.interactive(),
                'h-auto flex-col items-start gap-1 rounded-md p-4 text-left',
              )}
            >
              <span className="text-sm font-medium text-foreground">{template.name}</span>
              <span className="text-xs text-muted-foreground">{template.description}</span>
            </Button>
          ))}
        </div>
      </div>
    </FormModal>
  );
}
