import { useState } from 'react';
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

export interface SelectOption {
  name: string;
  description: string;
  value: any;
}

interface SelectListProps {
  options: SelectOption[];
  onSelect: (value: any) => void;
}

export function SelectList({ options, onSelect }: SelectListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useKeyboard((key) => {
    if (key.name === 'up' || key.name === 'k') {
      setSelectedIndex(prev => prev === 0 ? options.length - 1 : prev - 1);
    } else if (key.name === 'down' || key.name === 'j') {
      setSelectedIndex(prev => prev === options.length - 1 ? 0 : prev + 1);
    } else if (key.name === 'return') {
      onSelect(options[selectedIndex]?.value);
    }
  });

  return (
    <box flexDirection="column">
      {options.map((option, index) => (
        <box
          key={index}
          padding={1}
          backgroundColor={index === selectedIndex ? '#2a2a2a' : 'transparent'}
        >
          <box flexDirection="column">
            <text fg={index === selectedIndex ? "#ffca38" : undefined} attributes={index === selectedIndex ? TextAttributes.BOLD : TextAttributes.NONE}>{index === selectedIndex ? '> ' : '  '}{option.name}</text>
            <text attributes={TextAttributes.DIM}>{'  '}{option.description}</text>
          </box>
        </box>
      ))}
    </box>
  );
}