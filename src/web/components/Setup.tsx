/** @jsxImportSource react */
import React, { useState, useEffect, useRef } from 'react';
import '../assets/css/Setup.css';

interface TriggerConfig {
    provider: string;
    model: string;
    apiKey?: string;
}

interface SetupProps {
    onComplete: (config: TriggerConfig) => void;
}

interface Provider {
    id: string;
    name: string;
    description: string;
    requiresApiKey: boolean;
    models: Model[];
    isCustom?: boolean;
}

interface Model {
    id: string;
    name: string;
    description: string;
    requiresApiKey?: boolean;
}

type Step = 'provider' | 'model' | 'apikey' | 'confirm';

export function Setup({ onComplete }: SetupProps) {
    const [step, setStep] = useState<Step>('provider');
    const [providers, setProviders] = useState<Provider[]>([]);
    const [selectedProviderId, setSelectedProviderId] = useState<string>('');
    const [selectedModelId, setSelectedModelId] = useState<string>('');
    const [apiKey, setApiKey] = useState<string>('');
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
        fetch('/api/config/providers')
            .then(res => res.json())
            .then(data => setProviders(data))
            .catch(err => console.error("Failed to load providers", err));
    }, []);

    useEffect(() => {
        setSelectedIndex(0);
    }, [step]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (step === 'provider') {
            const options = providers;
            if (e.key === 'ArrowDown') {
                setSelectedIndex(prev => (prev + 1) % options.length);
            } else if (e.key === 'ArrowUp') {
                setSelectedIndex(prev => (prev - 1 + options.length) % options.length);
            } else if (e.key === 'Enter') {
                const provider = options[selectedIndex];
                if (provider) {
                    setSelectedProviderId(provider.id);
                    setStep('model');
                }
            }
        } else if (step === 'model') {
            const provider = providers.find(p => p.id === selectedProviderId);
            const options = provider?.models || [];
            if (e.key === 'ArrowDown') {
                setSelectedIndex(prev => (prev + 1) % options.length);
            } else if (e.key === 'ArrowUp') {
                setSelectedIndex(prev => (prev - 1 + options.length) % options.length);
            } else if (e.key === 'Enter') {
                const model = options[selectedIndex];
                if (model) {
                    setSelectedModelId(model.id);
                    const requiresKey = (provider?.requiresApiKey || model.requiresApiKey);
                    if (requiresKey && provider?.id !== 'ollama') {
                        setStep('apikey');
                    } else if (requiresKey && provider?.id === 'ollama' && (model.id.includes(':cloud') || model.id.includes('-cloud'))) {
                        setStep('apikey');
                    } else {
                        setStep('confirm');
                    }
                }
            } else if (e.key === 'Escape') {
                setStep('provider');
            }
        } else if (step === 'apikey') {
            if (e.key === 'Enter') {
                setStep('confirm');
            } else if (e.key === 'Escape') {
                setStep('model');
            }
        } else if (step === 'confirm') {
            if (e.key === 'Enter') {
                onComplete({
                    provider: selectedProviderId,
                    model: selectedModelId,
                    apiKey: apiKey || undefined
                });
            } else if (e.key === 'Escape') {
                const provider = providers.find(p => p.id === selectedProviderId);
                const model = provider?.models.find(m => m.id === selectedModelId);

                if (provider && model) {
                    const requiresKey = (provider.requiresApiKey || model.requiresApiKey);
                    if (requiresKey) setStep('apikey');
                    else setStep('model');
                } else {
                    setStep('model');
                }
            }
        }
    };

    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        containerRef.current?.focus();
    }, [step]);


    const renderProviderStep = () => {
        return (
            <div className="step-container">
                <div className="step-header">Select your AI provider (↑/↓ to navigate, Enter to select):</div>
                <div className="select-list">
                    {providers.map((p, idx) => (
                        <div key={p.id} className={`select-item ${idx === selectedIndex ? 'selected' : ''}`}
                            onClick={() => { setSelectedIndex(idx); }}>
                            <span className="item-name">{p.name}</span>
                            {idx === selectedIndex && <span className="item-desc"> - {p.description}</span>}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderModelStep = () => {
        const provider = providers.find(p => p.id === selectedProviderId);
        const models = provider?.models || [];
        return (
            <div className="step-container">
                <div className="step-header">Select the AI model (↑/↓ to navigate, Enter to select):</div>
                <div className="select-list">
                    {models.map((m, idx) => (
                        <div key={m.id} className={`select-item ${idx === selectedIndex ? 'selected' : ''}`}
                            onClick={() => { setSelectedIndex(idx); }}>
                            <span className="item-name">{m.name}</span>
                            {idx === selectedIndex && <span className="item-desc"> - {m.description}</span>}
                        </div>
                    ))}
                </div>
                <div className="step-footer">Escape to go back</div>
            </div>
        );
    };

    const renderApiKeyStep = () => {
        const provider = providers.find(p => p.id === selectedProviderId);
        return (
            <div className="step-container">
                <div className="step-header">Enter your {provider?.name} API key:</div>
                <input
                    type="password"
                    className="custom-input"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoFocus
                    placeholder="sk-..."
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') setStep('confirm');
                        if (e.key === 'Escape') setStep('model');
                    }}
                />
                <div className="step-footer">Press Enter when done, Escape to go back</div>
            </div>
        );
    };

    const renderConfirmStep = () => {
        const provider = providers.find(p => p.id === selectedProviderId);
        const model = provider?.models.find(m => m.id === selectedModelId);

        return (
            <div className="step-container center-content">
                <div className="bold-text">Configuration Complete!</div>
                <div className="summary-box">
                    <div>Provider: {provider?.name}</div>
                    <div>Model: {model?.name}</div>
                    {apiKey && <div>API Key: ********************</div>}
                </div>
                <div className="step-footer">Press Enter to continue, Escape to go back</div>
            </div>
        );
    };

    return (
        <div className="setup-screen" tabIndex={0} onKeyDown={handleKeyDown} ref={containerRef}>
            <div className="setup-content">
                <div className="main-title">Ready to innovate ?</div>

                {step === 'provider' && renderProviderStep()}
                {step === 'model' && renderModelStep()}
                {step === 'apikey' && renderApiKeyStep()}
                {step === 'confirm' && renderConfirmStep()}
            </div>
        </div>
    );
}
