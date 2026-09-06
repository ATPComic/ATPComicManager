export const TAG_CATEGORY_COLORS = [
  { id: 'purple', nameKey: 'colorPurple', accent: '#d0bcff', container: '#4f378b', onContainer: '#eaddff' },
  { id: 'violet', nameKey: 'colorViolet', accent: '#e1b7ff', container: '#5c3f75', onContainer: '#f2daff' },
  { id: 'lavender', nameKey: 'colorLavender', accent: '#ccc2dc', container: '#4a4458', onContainer: '#e8def8' },
  { id: 'indigo', nameKey: 'colorIndigo', accent: '#bec2ff', container: '#414575', onContainer: '#dfe0ff' },
  { id: 'blue', nameKey: 'colorBlue', accent: '#a9c7ff', container: '#284777', onContainer: '#d7e3ff' },
  { id: 'cyan', nameKey: 'colorCyan', accent: '#4fd8eb', container: '#004e59', onContainer: '#a5eeff' },
  { id: 'teal', nameKey: 'colorTeal', accent: '#63dac1', container: '#005046', onContainer: '#9ef2da' },
  { id: 'green', nameKey: 'colorGreen', accent: '#b5d58f', container: '#31511b', onContainer: '#d0efb0' },
  { id: 'lime', nameKey: 'colorLime', accent: '#c4d58a', container: '#414d16', onContainer: '#e0f1a4' },
  { id: 'yellow', nameKey: 'colorYellow', accent: '#e9c349', container: '#544600', onContainer: '#ffe177' },
  { id: 'amber', nameKey: 'colorAmber', accent: '#ffca65', container: '#5b4300', onContainer: '#ffdea1' },
  { id: 'orange', nameKey: 'colorOrange', accent: '#ffb77d', container: '#663c16', onContainer: '#ffdcbe' },
  { id: 'red', nameKey: 'colorRed', accent: '#ffb4ab', container: '#93000a', onContainer: '#ffdad6' },
  { id: 'pink', nameKey: 'colorPink', accent: '#ffafd2', container: '#5b113a', onContainer: '#ffd9e7' },
  { id: 'magenta', nameKey: 'colorMagenta', accent: '#ffade2', container: '#653355', onContainer: '#ffd8ed' },
  { id: 'brown', nameKey: 'colorBrown', accent: '#e7bdb4', container: '#5d403b', onContainer: '#ffdad2' },
  { id: 'slate', nameKey: 'colorSlate', accent: '#c4c6d0', container: '#45464f', onContainer: '#e1e2ec' }
];

export function normalizeCategoryColor(value) {
  const color = String(value ?? '').trim();
  return /^#[\da-f]{6}$/i.test(color) ? color.toLowerCase() : '';
}

function defaultTagCategoryColor(categoryId) {
  let hash = 0;
  for (const character of String(categoryId ?? '')) hash = ((hash * 31) + character.codePointAt(0)) | 0;
  return TAG_CATEGORY_COLORS[Math.abs(hash) % TAG_CATEGORY_COLORS.length];
}

function colorDistance(left, right) {
  const channels = (color) => [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
  const [lr, lg, lb] = channels(left);
  const [rr, rg, rb] = channels(right);
  return ((lr - rr) ** 2) + ((lg - rg) ** 2) + ((lb - rb) ** 2);
}

export function tagCategoryColor(categoryOrId, categories = []) {
  const category = typeof categoryOrId === 'object' && categoryOrId
    ? categoryOrId
    : categories.find((candidate) => candidate.id === categoryOrId);
  const categoryId = category?.id ?? categoryOrId;
  const customColor = normalizeCategoryColor(category?.color);
  if (customColor) {
    return TAG_CATEGORY_COLORS.find((preset) => preset.accent === customColor)
      ?? TAG_CATEGORY_COLORS.reduce((closest, preset) => (
        colorDistance(customColor, preset.accent) < colorDistance(customColor, closest.accent) ? preset : closest
      ));
  }
  return defaultTagCategoryColor(categoryId);
}

export function tagCategoryStyle(categoryOrId, categories = []) {
  const color = tagCategoryColor(categoryOrId, categories);
  return {
    '--tag-accent': color.accent,
    '--tag-container': color.container,
    '--tag-on-container': color.onContainer
  };
}
