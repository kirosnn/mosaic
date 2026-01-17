import { useState, useEffect } from 'react';
import { TextAttributes, type KeyEvent } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { getAllProviders, getProviderById, modelRequiresApiKey, addCustomProvider, addCustomModel, type CustomProvider, type AIModel } from '../utils/config';
import { SelectList, type SelectOption } from './SelectList';
import { CustomInput } from './CustomInput';

interface SetupProps {
  onComplete: (provider: string, model: string, apiKey?: string) => void;
  pasteRequestId?: number;
  shortcutsOpen?: boolean;
  commandsOpen?: boolean;
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
  | 'add-custom-model'
  | 'custom-model-name-existing'
  | 'custom-model-id-existing'
  | 'custom-model-description-existing'
  | 'apikey'
  | 'confirm';

export function Setup({ onComplete, pasteRequestId = 0, shortcutsOpen = false, commandsOpen = false }: SetupProps) {
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

  const renderer = useRenderer();
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
  const isOllamaCloudModel = selectedProvider === 'ollama' && (selectedModel.includes(':cloud') || selectedModel.includes('-cloud'));
  const modelOptions: SelectOption[] = currentProvider?.models.map(m => ({
    name: m.name,
    description: m.description,
    value: m.id
  })) || [];

  if (currentProvider && !('isCustom' in currentProvider)) {
    modelOptions.push({
      name: 'Add Custom Model',
      description: 'Add your own model for this provider',
      value: '__add-custom-model__'
    });
  }

  const handleProviderSelect = (value: any) => {
    if (value === '__custom__') {
      setStep('custom-name');
    } else {
      setSelectedProvider(value);
      setStep('model');
    }
  };

  const handleModelSelect = (value: any) => {
    if (value === '__add-custom-model__') {
      setStep('add-custom-model');
    } else {
      setSelectedModel(value);
      const requiresKey = !!currentProvider && (currentProvider.requiresApiKey || modelRequiresApiKey(currentProvider.id, value));
      if (requiresKey) {
        setStep('apikey');
      } else {
        setStep('confirm');
      }
    }
  };

  const handleApiKeySubmit = (value: string) => {
    setApiKey(value.trim().replace(/[\r\n]+/g, ''));
    setStep('confirm');
  };

  const handleCustomNameSubmit = (value: string) => {
    setCustomName(value.trim().replace(/[\r\n]+/g, ''));
    setStep('custom-description');
  };

  const handleCustomDescriptionSubmit = (value: string) => {
    setCustomDescription(value.trim().replace(/[\r\n]+/g, ' '));
    setStep('custom-baseurl');
  };

  const handleCustomBaseUrlSubmit = (value: string) => {
    setCustomBaseUrl(value.trim().replace(/[\r\n]+/g, ''));
    setStep('custom-apikey-required');
  };

  const handleCustomModelNameSubmit = (value: string) => {
    setTempModelName(value.trim().replace(/[\r\n]+/g, ''));
    setStep('custom-model-id');
  };

  const handleCustomModelIdSubmit = (value: string) => {
    setTempModelId(value.trim().replace(/[\r\n]+/g, ''));
    setStep('custom-model-description');
  };

  const handleCustomModelDescriptionSubmit = (value: string) => {
    setTempModelDescription(value.trim().replace(/[\r\n]+/g, ' '));

    const newModel: AIModel = {
      id: tempModelId.trim().replace(/[\r\n]+/g, ''),
      name: tempModelName.trim().replace(/[\r\n]+/g, ''),
      description: value.trim().replace(/[\r\n]+/g, ' ')
    };
    setCustomModels([...customModels, newModel]);

    setTempModelName('');
    setTempModelId('');
    setTempModelDescription('');

    setStep('custom-add-another-model');
  };

  const handleCustomModelNameExistingSubmit = (value: string) => {
    setTempModelName(value.trim().replace(/[\r\n]+/g, ''));
    setStep('custom-model-id-existing');
  };

  const handleCustomModelIdExistingSubmit = (value: string) => {
    setTempModelId(value.trim().replace(/[\r\n]+/g, ''));
    setStep('custom-model-description-existing');
  };

  const handleCustomModelDescriptionExistingSubmit = (value: string) => {
    const newModel: AIModel = {
      id: tempModelId.trim().replace(/[\r\n]+/g, ''),
      name: tempModelName.trim().replace(/[\r\n]+/g, ''),
      description: value.trim().replace(/[\r\n]+/g, ' ')
    };

    addCustomModel(selectedProvider, newModel);

    setTempModelName('');
    setTempModelId('');
    setTempModelDescription('');

    setStep('model');
  };

  const finalizeCustomProvider = () => {
    const cleanedName = customName.trim().replace(/[\r\n]+/g, '');
    const customProviderId = cleanedName.toLowerCase().replace(/\s+/g, '-');
    const newProvider: CustomProvider = {
      id: customProviderId,
      name: cleanedName,
      description: customDescription.trim().replace(/[\r\n]+/g, ' '),
      baseUrl: customBaseUrl.trim().replace(/[\r\n]+/g, ''),
      requiresApiKey: customRequiresApiKey,
      models: customModels,
      isCustom: true
    };

    addCustomProvider(newProvider);
    setSelectedProvider(customProviderId);
    setStep('model');
  };

  const getPreviousStep = (currentStep: SetupStep): SetupStep | null => {
    switch (currentStep) {
      case 'provider':
        return null;
      case 'custom-name':
        return 'provider';
      case 'custom-description':
        return 'custom-name';
      case 'custom-baseurl':
        return 'custom-description';
      case 'custom-apikey-required':
        return 'custom-baseurl';
      case 'custom-model-name':
        return 'custom-apikey-required';
      case 'custom-model-id':
        return 'custom-model-name';
      case 'custom-model-description':
        return 'custom-model-id';
      case 'custom-add-another-model':
        return 'custom-model-description';
      case 'model':
        return selectedProvider === '__custom__' ? 'custom-add-another-model' : 'provider';
      case 'add-custom-model':
        return 'model';
      case 'custom-model-name-existing':
        return 'add-custom-model';
      case 'custom-model-id-existing':
        return 'custom-model-name-existing';
      case 'custom-model-description-existing':
        return 'custom-model-id-existing';
      case 'apikey':
        return 'model';
      case 'confirm':
        return currentProvider && (currentProvider.requiresApiKey || modelRequiresApiKey(currentProvider.id, selectedModel)) ? 'apikey' : 'model';
      default:
        return null;
    }
  };

  const goBack = () => {
    const previousStep = getPreviousStep(step);
    if (previousStep) {
      setStep(previousStep);
    }
  };

  useEffect(() => {
    const handleKeyPress = (key: KeyEvent) => {
      if (shortcutsOpen) return;
      if (key.name === 'escape') {
        goBack();
      } else if (step === 'confirm' && key.name === 'return') {
        onComplete(selectedProvider, selectedModel, apiKey || undefined);
      } else if (step === 'add-custom-model' && key.name === 'return') {
        setStep('custom-model-name-existing');
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
    };

    renderer.keyInput.on('keypress', handleKeyPress);

    return () => {
      renderer.keyInput.off('keypress', handleKeyPress);
    };
  }, [step, selectedProvider, selectedModel, apiKey, customRequiresApiKey, customModels, customName, customDescription, customBaseUrl, tempModelName, tempModelId, tempModelDescription, shortcutsOpen, renderer.keyInput]);

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
          <SelectList options={providerOptions} onSelect={handleProviderSelect} disabled={shortcutsOpen} />
        </box>
      )}

      {step === 'custom-name' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter custom provider name:</text>
          </box>
          <CustomInput
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            onSubmit={handleCustomNameSubmit}
            placeholder="My Custom Provider"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done, Escape to go back</text>
          </box>
        </box>
      )}

      {step === 'custom-description' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter a description for {customName}:</text>
          </box>
          <CustomInput
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            onSubmit={handleCustomDescriptionSubmit}
            placeholder="Description of the provider"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done, Escape to go back</text>
          </box>
        </box>
      )}

      {step === 'custom-baseurl' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter the API base URL:</text>
          </box>
          <CustomInput
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            onSubmit={handleCustomBaseUrlSubmit}
            placeholder="https://api.example.com/v1"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done, Escape to go back</text>
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
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            onSubmit={handleCustomModelNameSubmit}
            placeholder="GPT-4 or Claude Opus"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done, Escape to go back</text>
          </box>
        </box>
      )}

      {step === 'custom-model-id' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter model ID for {tempModelName}:</text>
          </box>
          <CustomInput
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            onSubmit={handleCustomModelIdSubmit}
            placeholder="gpt-4 or claude-opus-4"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done, Escape to go back</text>
          </box>
        </box>
      )}

      {step === 'custom-model-description' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter description for {tempModelName}:</text>
          </box>
          <CustomInput
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            onSubmit={handleCustomModelDescriptionSubmit}
            placeholder="Best for complex tasks"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done, Escape to go back</text>
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
          <SelectList options={modelOptions} onSelect={handleModelSelect} disabled={shortcutsOpen} />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Escape to go back</text>
          </box>
        </box>
      )}

      {step === 'add-custom-model' && (
        <box flexDirection="column" flexGrow={1} justifyContent="center">
          <text>Add a custom model for {currentProvider?.name}</text>
          <box marginTop={2} flexDirection="column" alignItems="flex-start">
            <text>You can add custom models that are not in the default list.</text>
            <text>This is useful for new models or specific configurations.</text>
          </box>
          <box marginTop={2}>
            <text attributes={TextAttributes.DIM}>Press Enter to continue, Escape to go back</text>
          </box>
        </box>
      )}

      {step === 'custom-model-name-existing' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter model name:</text>
          </box>
          <CustomInput
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            onSubmit={handleCustomModelNameExistingSubmit}
            placeholder="GPT-4o-mini or Claude 3.5 Sonnet"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done, Escape to go back</text>
          </box>
        </box>
      )}

      {step === 'custom-model-id-existing' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter model ID for {tempModelName}:</text>
          </box>
          <CustomInput
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            onSubmit={handleCustomModelIdExistingSubmit}
            placeholder="gpt-4o-mini or claude-3-5-sonnet-20241022"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done, Escape to go back</text>
          </box>
        </box>
      )}

      {step === 'custom-model-description-existing' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>Enter description for {tempModelName}:</text>
          </box>
          <CustomInput
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            onSubmit={handleCustomModelDescriptionExistingSubmit}
            placeholder="Fast and efficient model for general tasks"
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done, Escape to go back</text>
          </box>
        </box>
      )}

      {step === 'apikey' && (
        <box flexDirection="column" flexGrow={1}>
          <box marginBottom={1}>
            <text>
              Enter your {currentProvider?.name} API key:
            </text>
          </box>
          {isOllamaCloudModel && (
            <box marginBottom={1} flexDirection="column" alignItems="flex-start">
              <text>
                This is an Ollama Cloud model. You must create an API key on:
              </text>
              <text attributes={TextAttributes.DIM}>https://ollama.com/settings/keys</text>
            </box>
          )}
          <CustomInput
            onSubmit={handleApiKeySubmit}
            focused={!shortcutsOpen}
            pasteRequestId={shortcutsOpen ? 0 : pasteRequestId}
            placeholder={isOllamaCloudModel ? "ollama_..." : "sk-..."}
          />
          <box marginTop={1}>
            <text attributes={TextAttributes.DIM}>Press Enter when done, Escape to go back</text>
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
            <text attributes={TextAttributes.DIM}>Press Enter to continue, Escape to go back</text>
          </box>
        </box>
      )}
    </box>
  );
}