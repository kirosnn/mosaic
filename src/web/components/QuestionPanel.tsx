/** @jsxImportSource react */
import React, { useState, useEffect, useRef } from 'react';
import { QuestionRequest } from '../../utils/questionBridge';

interface QuestionPanelProps {
    request: QuestionRequest;
    onAnswer: (index: number, customText?: string) => void;
}

export function QuestionPanel({ request, onAnswer }: QuestionPanelProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [customText, setCustomText] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setSelectedIndex(0);
        setCustomText('');
        if (inputRef.current) inputRef.current.focus();
    }, [request.id]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev === 0 ? request.options.length - 1 : prev - 1));
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev === request.options.length - 1 ? 0 : prev + 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (customText.trim()) {
                onAnswer(0, customText);
            } else {
                onAnswer(selectedIndex);
            }
        } else if (e.key >= '1' && e.key <= '9') {
            const idx = Number(e.key) - 1;
            if (idx >= 0 && idx < request.options.length) {
                onAnswer(idx);
            }
        }
    };

    const handleOptionClick = (index: number) => {
        onAnswer(index);
    };

    const handleSubmitCustom = (e: React.FormEvent) => {
        e.preventDefault();
        if (customText.trim()) {
            onAnswer(0, customText);
        }
    };

    return (
        <div className="panel question-panel">
            <div className="panel-header">
                <strong>Question</strong>
            </div>
            <div className="panel-content">
                <div className="question-prompt">
                    {request.prompt.split('\n').map((line, i) => (
                        <div key={i}>{line}</div>
                    ))}
                </div>
                <div className="question-options">
                    {request.options.map((option, index) => (
                        <div
                            key={index}
                            className={`question-option ${index === selectedIndex ? 'selected' : ''}`}
                            onClick={() => handleOptionClick(index)}
                        >
                            <span className="option-key">{index + 1}.</span>
                            <span className="option-label">{option.label}</span>
                        </div>
                    ))}
                </div>
                <div className="custom-input-container">
                    <form onSubmit={handleSubmitCustom}>
                        <input
                            ref={inputRef}
                            type="text"
                            value={customText}
                            onChange={(e) => setCustomText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Tell Mosaic what it should do..."
                            className="panel-input"
                        />
                    </form>
                </div>
            </div>
            <style>{`
                .panel {
                   background: var(--bg-panel);
                   border: 1px solid var(--border-subtle);
                   border-radius: 8px;
                   margin: 1rem 0;
                   padding: 1rem;
                }
                .panel-header {
                   margin-bottom: 1rem;
                   color: var(--accent-color);
                }
                .question-prompt {
                   margin-bottom: 1rem;
                   font-weight: 500;
                   line-height: 1.5;
                }
                .question-options {
                   display: flex;
                   flex-direction: column;
                   gap: 0.5rem;
                   margin-bottom: 1rem;
                }
                .question-option {
                   padding: 0.5rem;
                   border-radius: 4px;
                   cursor: pointer;
                   display: flex;
                   gap: 0.5rem;
                   transition: background 0.1s;
                }
                .question-option:hover {
                    background: var(--overlay-light);
                }
                .question-option.selected {
                    background: var(--overlay-medium);
                    border: 1px solid var(--border-subtle);
                }
                .option-key {
                   color: var(--text-muted);
                   width: 1.5rem;
                }
                .panel-input {
                    width: 100%;
                    padding: 0.75rem;
                    background: var(--bg-app);
                    border: 1px solid var(--border-subtle);
                    color: var(--text-primary);
                    border-radius: 6px;
                    font-family: inherit;
                }
                .panel-input:focus {
                    outline: none;
                    border-color: var(--accent-color);
                }
            `}</style>
        </div>
    );
}
