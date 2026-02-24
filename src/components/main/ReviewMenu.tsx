import { useState } from 'react';
import { TextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';

interface ReviewMenuProps {
    disabled?: boolean;
    onKeep: () => void;
    onRevert: () => void;
    onAcceptAll: () => void;
}

export function ReviewMenu({ disabled = false, onKeep, onRevert, onAcceptAll }: ReviewMenuProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const actions = [
        { key: 'y', label: 'Keep', run: onKeep },
        { key: 'r', label: 'Revert', run: onRevert },
        { key: 'a', label: 'Accept all', run: onAcceptAll },
    ];
    const actionCount = actions.length;

    const runAction = (index: number) => {
        const action = actions[index];
        if (!action) return;
        action.run();
    };

    useKeyboard((key) => {
        if (disabled) return;

        if (key.name === 'left' || key.name === 'h' || key.name === 'up' || key.name === 'k') {
            setSelectedIndex(prev => (prev === 0 ? actionCount - 1 : prev - 1));
            return;
        }

        if (key.name === 'right' || key.name === 'l' || key.name === 'down' || key.name === 'j') {
            setSelectedIndex(prev => (prev === actionCount - 1 ? 0 : prev + 1));
            return;
        }

        if (key.name === 'return') {
            runAction(selectedIndex);
            return;
        }

        if (key.name === 'y') {
            onKeep();
            return;
        }

        if (key.name === 'n' || key.name === 'r') {
            onRevert();
            return;
        }

        if (key.name === 'a') {
            onAcceptAll();
            return;
        }
    });

    return (
        <box flexDirection="column" width="100%" backgroundColor="#111827" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
            <box flexDirection="row" justifyContent="space-between" width="100%">
                <text fg="#64748b" attributes={TextAttributes.DIM}>Actions</text>
                <text fg="#64748b" attributes={TextAttributes.DIM}>←/→ select · Enter apply</text>
            </box>
            <box flexDirection="row" marginTop={1}>
                {actions.map((action, index) => {
                    const isSelected = selectedIndex === index;
                    const isHovered = hoveredIndex === index;
                    return (
                        <box
                            key={action.key}
                            flexDirection="row"
                            backgroundColor={isSelected ? '#1f2937' : (isHovered ? '#19202c' : 'transparent')}
                            paddingLeft={1}
                            paddingRight={1}
                            marginRight={1}
                            onMouseOver={() => {
                                if (disabled) return;
                                setHoveredIndex(index);
                                setSelectedIndex(index);
                            }}
                            onMouseOut={() => {
                                setHoveredIndex(prev => (prev === index ? null : prev));
                            }}
                            onMouseDown={(event: any) => {
                                if (disabled) return;
                                if (event?.isSelecting) return;
                                if (event?.button !== undefined && event.button !== 0) return;
                                setSelectedIndex(index);
                                runAction(index);
                            }}
                        >
                            <text fg={isSelected ? '#e2e8f0' : '#94a3b8'} attributes={isSelected ? TextAttributes.BOLD : TextAttributes.DIM}>
                                {isSelected ? '> ' : '  '}
                                [{action.key}] {action.label}
                            </text>
                        </box>
                    );
                })}
            </box>
        </box>
    );
}
