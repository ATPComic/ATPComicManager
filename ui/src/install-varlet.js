import {
  Avatar,
  Badge,
  Button,
  ButtonGroup,
  Card,
  Cell,
  Chip,
  Dialog,
  DatePicker,
  Fab,
  Input,
  Locale,
  Menu,
  MenuSelect,
  Pagination,
  Ripple,
  SegmentedButtons,
  Snackbar,
  Skeleton,
  Switch
} from '@varlet/ui';
import '@varlet/touch-emulator';

const components = [
  Avatar,
  Badge,
  Button,
  ButtonGroup,
  Card,
  Cell,
  Chip,
  Dialog,
  DatePicker,
  Fab,
  Input,
  Menu,
  MenuSelect,
  Pagination,
  Ripple,
  SegmentedButtons,
  Snackbar,
  Skeleton,
  Switch
];

export function installVarlet(app, locale = 'en') {
  window.atpDesktop?.setLocale?.(locale);
  Locale.use({ en: 'en-US', ja: 'ja-JP', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW' }[locale] ?? 'en-US');
  components.forEach((component) => app.use(component));
  return app;
}
