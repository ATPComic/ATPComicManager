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

export function installVarlet(app, locale = 'zh-CN') {
  Locale.use({ en: 'en-US', ja: 'ja-JP' }[locale] ?? 'zh-CN');
  components.forEach((component) => app.use(component));
  return app;
}
