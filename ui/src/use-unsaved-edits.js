import { onBeforeUnmount } from 'vue';
import { Dialog } from '@varlet/ui';
import { t } from '../../public/i18n.js';
import { createUnsavedEdits } from '../../public/unsaved-edits.js';

export function useUnsavedEdits(snapshot, save) {
  let leaving = false;
  const edits = createUnsavedEdits({ snapshot, save, confirm: () => Dialog({
    title: t('unsavedChanges'),
    message: t('saveBeforeLeaving'),
    confirmButtonText: t('save'),
    cancelButtonText: t('discardChanges'),
    closeOnClickOverlay: true,
    closeOnKeyEscape: true,
    dialogClass: 'unsaved-edits-dialog',
    onOpened: () => document.querySelector('.unsaved-edits-dialog .var-dialog__confirm-button')?.focus()
  }) });
  const beforeUnload = event => {
    if (edits.dirty() && !leaving) { event.preventDefault(); event.returnValue = ''; }
  };
  window.addEventListener('beforeunload', beforeUnload);
  onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
  return {
    ...edits,
    async leave(navigate) {
      if (!await edits.permitLeave()) return;
      leaving = true;
      navigate();
    }
  };
}
