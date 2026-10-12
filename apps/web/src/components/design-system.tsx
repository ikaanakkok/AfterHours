'use client';

import { BaseStyles } from './styles/base';
import { ShellStyles } from './styles/shell';
import { FormStyles } from './styles/forms';
import { ContentStyles } from './styles/content';
import { ResponsiveStyles } from './styles/responsive';

export function DesignSystem() {
  return (
    <>
      <BaseStyles />
      <ShellStyles />
      <FormStyles />
      <ContentStyles />
      <ResponsiveStyles />
    </>
  );
}
