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
    const actionCount = 3;

    useKeyboard((key) => {
        if (disabled) return;

        if (key.name === 'up' || key.name === 'k') {
            setSelectedIndex(prev => (prev === 0 ? actionCount - 1 : prev - 1));
            return;
        }

        if (key.name === 'down' || key.name === 'j') {
            setSelectedIndex(prev => (prev === actionCount - 1 ? 0 : prev + 1));
            return;
        }

        if (key.name === 'return') {
            if (selectedIndex === 0) {
                onKeep();
            } else if (selectedIndex === 1) {
                onRevert();
            } else {
                onAcceptAll();
            }
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
        <box flexDirection="column" width="100%" backgroundColor="#1a1a1a" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
            <box flexDirection="row" justifyContent="space-between" width="100%">
                <text fg="#8a8a8a" attributes={TextAttributes.DIM}>Review actions</text>
                <text fg="#8a8a8a" attributes={TextAttributes.DIM}>y keep · r revert · a accept all</text>
            </box>
            <box flexDirection="column" marginTop={1}>
                <box
                    flexDirection="row"
                    backgroundColor={selectedIndex === 0 ? '#2a2a2a' : 'transparent'}
                    paddingLeft={1}
                    paddingRight={1}
                >
                    <text
                        fg={selectedIndex === 0 ? '#e6e6e6' : '#b5b5b5'}
                        attributes={selectedIndex === 0 ? TextAttributes.BOLD : TextAttributes.DIM}
                    >
                        {selectedIndex === 0 ? '> ' : '  '}Keep
                    </text>
                </box>
                <box
                    flexDirection="row"
                    backgroundColor={selectedIndex === 1 ? '#2a2a2a' : 'transparent'}
                    paddingLeft={1}
                    paddingRight={1}
                >
                    <text
                        fg={selectedIndex === 1 ? '#e6e6e6' : '#b5b5b5'}
                        attributes={selectedIndex === 1 ? TextAttributes.BOLD : TextAttributes.DIM}
                    >
                        {selectedIndex === 1 ? '> ' : '  '}Revert
                    </text>
                </box>
                <box
                    flexDirection="row"
                    backgroundColor={selectedIndex === 2 ? '#2a2a2a' : 'transparent'}
                    paddingLeft={1}
                    paddingRight={1}
                >
                    <text
                        fg={selectedIndex === 2 ? '#e6e6e6' : '#b5b5b5'}
                        attributes={selectedIndex === 2 ? TextAttributes.BOLD : TextAttributes.DIM}
                    >
                        {selectedIndex === 2 ? '> ' : '  '}Accept all
                    </text>
                </box>
            </box>
        </box>
    );
}
