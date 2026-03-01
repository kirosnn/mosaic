import { useState } from 'react';
import { TextAttributes } from "@cascadetui/core";
import { useKeyboard } from "@cascadetui/react";

export interface SelectOption {
  name: string;
  description: string;
  value: any;
}

interface SelectListProps {
  options: SelectOption[];
  onSelect: (value: any) => void;
  disabled?: boolean;
}

export function SelectList({ options, onSelect, disabled = false }: SelectListProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleSelect = (index: number) => {
    const option = options[index];
    if (!option) return;
    onSelect(option.value);
  };

  useKeyboard((key) => {
    if (disabled) return;
    if (key.name === 'up' || key.name === 'k') {
      setSelectedIndex(prev => prev === 0 ? options.length - 1 : prev - 1);
    } else if (key.name === 'down' || key.name === 'j') {
      setSelectedIndex(prev => prev === options.length - 1 ? 0 : prev + 1);
    } else if (key.name === 'return') {
      handleSelect(selectedIndex);
    }
  });

  return (
    <box flexDirection="column">
      {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          const isHovered = hoveredIndex === index;
          const bg = isSelected ? '#2a2a2a' : (isHovered ? '#202020' : 'transparent');
          return (
        <box
          key={index}
          padding={1}
          backgroundColor={bg}
          onMouseOver={() => {
            if (disabled) return;
            setHoveredIndex(index);
          }}
          onMouseOut={() => {
            setHoveredIndex(prev => (prev === index ? null : prev));
          }}
          onMouseDown={(event: any) => {
            if (disabled) return;
            if (event?.isSelecting) return;
            if (event?.button !== undefined && event.button !== 0) return;
            setSelectedIndex(index);
            handleSelect(index);
          }}
        >
          <box flexDirection="column">
            <text fg={isSelected ? "#2596be" : undefined} attributes={isSelected ? TextAttributes.BOLD : TextAttributes.NONE}>{isSelected ? '> ' : '  '}{option.name}</text>
            <text attributes={TextAttributes.DIM}>{'  '}{option.description}</text>
          </box>
        </box>
          );
      })}
    </box>
  );
}
