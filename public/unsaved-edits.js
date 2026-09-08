export function createUnsavedEdits({ snapshot, confirm, save }) {
  let baseline = null;
  let pending = false;
  const dirty = () => baseline !== null && snapshot() !== baseline;
  const markSaved = () => { baseline = snapshot(); };
  async function permitLeave() {
    if (pending) return false;
    if (!dirty()) return true;
    pending = true;
    try {
      const action = await confirm();
      if (action === 'confirm') {
        if (await save() !== true) return false;
        markSaved();
        return true;
      }
      return action === 'cancel';
    } finally { pending = false; }
  }
  return { dirty, markSaved, permitLeave };
}
