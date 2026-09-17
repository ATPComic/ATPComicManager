export function matchArchiveFolderName(folderName) {
  const text = String(folderName ?? '');
  const date = text.match(/(?:^|\D)(\d{8})(?!\d)/)?.[1];
  if (date) return { layout: 'folder', date };
  const month = text.match(/(?:^|\D)(\d{6})(?!\d)/)?.[1];
  return month ? { layout: 'month-flat', month } : null;
}

export function matchesRecognitionRule(folderName, rules) {
  const name = String(folderName ?? '');
  return (rules ?? []).some(rule => (rule.prefix || rule.suffix)
    && (!rule.prefix || name.startsWith(rule.prefix)) && (!rule.suffix || name.endsWith(rule.suffix)));
}
