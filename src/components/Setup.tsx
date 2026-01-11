import { useState } from 'react';
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { getAllProviders, getProviderById, addCustomProvider, type CustomProvider, type AIModel } from '../utils/config';
import { SelectList, type SelectOption } from './SelectList';
import { CustomInput } from './CustomInput';

interface SetupProps {
  onComplete: (provider: string, model: string, apiKey?: string) => void;
}

type SetupStep =
  | 'provider'
  | 'custom-name'
  | 'custom-description'
  | 'custom-baseurl'
  | 'custom-apikey-required'
  | 'custom-model-name'
  | 'custom-model-id'
  | 'custom-model-description'
  | 'custom-add-another-model'
  | 'model'
  | 'apikey'
  | 'confirm';

export function Setup({ onComplete }: SetupProps) {
  const [step, setStep] = useState<SetupStep>('provider');
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [apiKey, setApiKey] = useState<string>('');

  const [customName, setCustomName] = useState<string>('');
  const [customDescription, setCustomDescription] = useState<string>('');
  const [customBaseUrl, setCustomBaseUrl] = useState<string>('');
  const [customRequiresApiKey, setCustomRequiresApiKey] = useState<boolean>(true);
  const [customModels, setCustomModels] = useState<AIModel[]>([]);
  const [tempModelName, setTempModelName] = useState<string>('');
  const [tempModelId, setTempModelId] = useState<string>('');
  const [tempModelDescription, setTempModelDescription] = useState<string>('');

  const allProviders = getAllProviders();
  const providerOptions: SelectOption[] = [
    ...allProviders.map(p => ({
      name: p.name,
      description: p.description,
      value: p.id
    })),
    {
      name: 'Custom Provider',
      description: 'Add your own API provider',
      value: '__custom__'
    }
  ];

  const currentProvider = getProviderById(selectedProvider);
  const modelOptions: SelectOption[] = currentProvider?.models.map(m => ({
    name: m.name,
    description: m.description,
    value: m.id
  })) || [];

  const handleProviderSelect = (value: any) => {
    if (value === '__custom__') {
      setStep('custom-name');
    } else {
      setSelectedProvider(value);
      setStep('model');
    }
  };

  const handleModelSelect = (value: any) => {
    setSelectedModel(value);
    if (currentProvider?.requiresApiKey) {
      setStep('apikey');
    } else {
      setStep('confirm');
    }
  };

  const handleApiKeySubmit = (value: string) => {
    setApiKey(value);
    setStep('confirm');
  };

  const handleCustomNameSubmit = (value: string) => {
    setCustomName(value);
    setStep('custom-description');
  };

  const handleCustomDescriptionSubmit = (value: string) => {
    setCustomDescription(value);
    setStep('custom-baseurl');
  };

  const handleCustomBaseUrlSubmit = (value: string) => {
    setCustomBaseUrl(value);
    setStep('custom-apikey-required');
  };

  const handleCustomModelNameSubmit = (value: string) => {
    setTempModelName(value);
    setStep('custom-model-id');
  };

  const handleCustomModelIdSubmit = (value: string) => {
    setTempModelId(value);
    setStep('custom-model-description');
  };

  const handleCustomModelDescriptionSubmit = (value: string) => {
    setTempModelDescription(value);

    const newModel: AIModel = {
      id: tempModelId,
      name: tempModelName,
      description: value
    };
    setCustomModels([...customModels, newModel]);

    setTempModelName('');
    setTempModelId('');
    setTempModelDescription('');

    setStep('custom-add-another-model');
  };

  const finalizeCustomProvider = () => {
    const customProviderId = customName.toLowerCase().replace(/\s+/g, '-');
    const newProvider: CustomProvider = {
      id: customProviderId,
      name: customName,
      description: customDescription,
      baseUrl: customBaseUrl,
      requiresApiKey: customRequiresApiKey,
      models: customModels,
      isCustom: true
    };

    addCustomProvider(newProvider);
    setSelectedProvider(customProviderId);
    setStep('model');
  };

  useKeyboard((key) => {
    if (step === 'confirm' && key.name === 'return') {
      onComplete(selectedProvider, selectedModel, apiKey || undefined);
    } else if (step === 'custom-apikey-required') {
      if (key.name === 'y') {
        setCustomRequiresApiKey(true);
        setStep('custom-model-name');
      } else if (key.name === 'n') {
        setCustomRequiresApiKey(false);
        setStep('custom-model-name');
      }
    } else if (step === 'custom-add-another-model') {
      if (key.name === 'y') {
        setStep('custom-model-name');
      } else if (key.name === 'n') {
        finalizeCustomProvider();
      }
    }
  });

  return (
    <box width="100%" height="100%" flexDirection="column" padding={2}>
      <box marginBottom={2}>
        <text attributes={TextAttributes.BOLD}>Ready to innovate ?</text>
      </box>

      {step === 'provider' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Select your AI provider (↑/↓ to navigate, Enter to select):</text>
          </box>
          <SelectList options={providerOptions} onSelect={handleProviderSelect} />
        </box>
      )}

      {step === 'custom-name' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter custom provider name:</text>
          </box>
          <CustomInput
            focused={true}
            onSubmit={handleCustomNameSubmit}
            placeholder="My Custom Provider"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done</text>
          </box>
        </box>
      )}

      {step === 'custom-description' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter a description for {customName}:</text>
          </box>
          <CustomInput
            focused={true}
            onSubmit={handleCustomDescriptionSubmit}
            placeholder="Description of the provider"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done</text>
          </box>
        </box>
      )}

      {step === 'custom-baseurl' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter the API base URL:</text>
          </box>
          <CustomInput
            focused={true}
            onSubmit={handleCustomBaseUrlSubmit}
            placeholder="https://api.example.com/v1"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done</text>
          </box>
        </box>
      )}

      {step === 'custom-apikey-required' && (
        <box flexDirection="column" flexGrow={1} justifyContent="center">
          <text>Does this provider require an API key?</text>
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Y for Yes, N for No</text>
          </box>
        </box>
      )}

      {step === 'custom-model-name' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter model name{customModels.length > 0 ? ` (${customModels.length} added)` : ''}:</text>
          </box>
          <CustomInput
            focused={true}
            onSubmit={handleCustomModelNameSubmit}
            placeholder="GPT-4 or Claude Opus"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done</text>
          </box>
        </box>
      )}

      {step === 'custom-model-id' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter model ID for {tempModelName}:</text>
          </box>
          <CustomInput
            focused={true}
            onSubmit={handleCustomModelIdSubmit}
            placeholder="gpt-4 or claude-opus-4"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done</text>
          </box>
        </box>
      )}

      {step === 'custom-model-description' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter description for {tempModelName}:</text>
          </box>
          <CustomInput
            focused={true}
            onSubmit={handleCustomModelDescriptionSubmit}
            placeholder="Best for complex tasks"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done</text>
          </box>
        </box>
      )}

      {step === 'custom-add-another-model' && (
        <box flexDirection="column" flexGrow={1} justifyContent="center">
          <text>Model added: {customModels[customModels.length - 1]?.name}</text>
          <box marginTop={1}>
            <text>Add another model?</text>
          </box>
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Y for Yes, N for No</text>
          </box>
        </box>
      )}

      {step === 'model' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Select the AI model (↑/↓ to navigate, Enter to select):</text>
          </box>
          <SelectList options={modelOptions} onSelect={handleModelSelect} />
        </box>
      )}

      {step === 'apikey' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter your {currentProvider?.name} API key:</text>
          </box>
          <CustomInput
            onSubmit={handleApiKeySubmit}
            placeholder="sk-..."
            password={true}
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>F2 to paste, then press Enter</text>
          </box>
        </box>
      )}

      {step === 'confirm' && (
        <box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
          <text attributes={TextAttributes.BOLD}>Configuration Complete!</text>
          <box marginTop={2} flexDirection="column" alignItems="flex-start">
            <text>Provider: {currentProvider?.name}</text>
            <text>Model: {currentProvider?.models.find(m => m.id === selectedModel)?.name}</text>
            {apiKey && <text>API Key: ********************</text>}
          </box>
          <box marginTop={2}>
            <text attributes={TextAttributes.DIM}>Press Enter to continue...</text>
          </box>
        </box>
      )}
    </box>
  );
}
