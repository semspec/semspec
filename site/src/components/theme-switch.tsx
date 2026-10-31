// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Semspec Authors
// The header control that picks the Light, Dark or System theme.
import { Monitor, Moon, Sun } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from '@/lib/use-theme';
import type { ThemeChoice } from '../../../packages/app/src/lib/theme';

const ITEMS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeSwitch() {
  const { choice, setChoice } = useTheme();
  return (
    <ToggleGroup
      variant="outline"
      size="sm"
      spacing={0}
      aria-label="Theme"
      value={[choice]}
      onValueChange={(values) => {
        if (values[0]) setChoice(values[0] as ThemeChoice);
      }}
    >
      {ITEMS.map(({ value, label, icon: Icon }) => (
        <Tooltip key={value}>
          <TooltipTrigger render={<ToggleGroupItem value={value} aria-label={label} />}>
            <Icon />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
