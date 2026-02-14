export type ModelsDevProviderId = string;
export type ModelsDevModelId = string;

export type ModelsDevModalities = {
    input: string[];
    output: string[];
};

export type ModelsDevCost = {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    [k: string]: number | undefined;
};

export type ModelsDevLimit = {
    context?: number;
    input?: number;
    output?: number;
    [k: string]: number | undefined;
};

export type ModelsDevModel = {
    id: ModelsDevModelId;
    name: string;
    family?: string;

    attachment?: boolean;
    reasoning?: boolean;
    tool_call?: boolean;
    structured_output?: boolean;
    temperature?: boolean;

    knowledge?: string;
    release_date?: string;
    last_updated?: string;

    modalities?: ModelsDevModalities;
    open_weights?: boolean;

    cost?: ModelsDevCost;
    limit?: ModelsDevLimit;

    [k: string]: unknown;
};

export type ModelsDevProvider = {
    id: ModelsDevProviderId;
    env?: string[];
    npm?: string;
    name?: string;
    doc?: string;
    models: Record<ModelsDevModelId, ModelsDevModel>;
    [k: string]: unknown;
};

export type ModelsDevApiResponse = Record<ModelsDevProviderId, ModelsDevProvider>;

export type ModelsDevClientOptions = {
    url?: string;
    ttlMs?: number;
    fetchFn?: typeof fetch;
};

export type ModelsDevSearchQuery = {
    providerId?: string;
    modelId?: string;
    family?: string;
    nameIncludes?: string;
    supports?: Partial<
        Pick<
            ModelsDevModel,
            "attachment" | "reasoning" | "tool_call" | "structured_output" | "temperature" | "open_weights"
        >
    >;
    modalities?: Partial<ModelsDevModalities>;
};

export type ModelsDevSearchResult = {
    provider: ModelsDevProvider;
    model: ModelsDevModel;
};

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toLower(s: string): string {
    return s.toLowerCase();
}

function includesAll(haystack: string[], needles: string[]): boolean {
    const set = new Set(haystack.map(toLower));
    for (const n of needles) if (!set.has(toLower(n))) return false;
    return true;
}

export class ModelsDevClient {
    private readonly url: string;
    private readonly ttlMs: number;
    private readonly fetchFn: typeof fetch;

    private cache: { at: number; data: ModelsDevApiResponse } | null = null;
    private inflight: Promise<ModelsDevApiResponse> | null = null;

    constructor(options: ModelsDevClientOptions = {}) {
        this.url = options.url ?? "https://models.dev/api.json";
        this.ttlMs = options.ttlMs ?? 5 * 60_000;
        this.fetchFn = (options.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args))) as typeof fetch;
    }

    async getAll(options: { refresh?: boolean } = {}): Promise<ModelsDevApiResponse> {
        const now = Date.now();
        const refresh = options.refresh === true;

        if (!refresh && this.cache && now - this.cache.at <= this.ttlMs) {
            return this.cache.data;
        }

        if (this.inflight) return this.inflight;

        this.inflight = (async () => {
            const res = await this.fetchFn(this.url, { method: "GET", headers: { accept: "application/json" } });
            if (!res.ok) throw new Error(`models.dev request failed (${res.status})`);
            const json = (await res.json()) as unknown;
            const data = this.validate(json);
            this.cache = { at: Date.now(), data };
            return data;
        })();

        try {
            return await this.inflight;
        } finally {
            this.inflight = null;
        }
    }

    async getProvider(providerId: ModelsDevProviderId, options: { refresh?: boolean } = {}): Promise<ModelsDevProvider | null> {
        const data = await this.getAll(options);
        return data[providerId] ?? null;
    }

    async getModel(
        providerId: ModelsDevProviderId,
        modelId: ModelsDevModelId,
        options: { refresh?: boolean } = {}
    ): Promise<ModelsDevModel | null> {
        const provider = await this.getProvider(providerId, options);
        return provider?.models?.[modelId] ?? null;
    }

    async getModelById(modelId: ModelsDevModelId, options: { refresh?: boolean } = {}): Promise<ModelsDevSearchResult | null> {
        const data = await this.getAll(options);
        for (const provider of Object.values(data)) {
            const model = provider.models?.[modelId];
            if (model) return { provider, model };
        }
        const lowerSearch = modelId.toLowerCase();

        for (const provider of Object.values(data)) {
            const models = provider.models ?? {};
            for (const [id, model] of Object.entries(models)) {
                const lowerId = id.toLowerCase();
                if (lowerSearch.includes(lowerId) || lowerId.includes(lowerSearch)) {
                    return { provider, model };
                }
            }
        }

        return null;
    }

    async listProviders(options: { refresh?: boolean } = {}): Promise<ModelsDevProvider[]> {
        const data = await this.getAll(options);
        return Object.values(data);
    }

    async listModels(providerId?: ModelsDevProviderId, options: { refresh?: boolean } = {}): Promise<ModelsDevSearchResult[]> {
        const data = await this.getAll(options);

        const providers = providerId ? (data[providerId] ? [data[providerId]!] : []) : Object.values(data);
        const out: ModelsDevSearchResult[] = [];

        for (const p of providers) {
            for (const m of Object.values(p.models ?? {})) out.push({ provider: p, model: m });
        }

        return out;
    }

    async search(query: ModelsDevSearchQuery, options: { refresh?: boolean } = {}): Promise<ModelsDevSearchResult[]> {
        const data = await this.getAll(options);
        const out: ModelsDevSearchResult[] = [];

        const providerFilter = query.providerId ? data[query.providerId] : null;
        const providers = providerFilter ? [providerFilter] : Object.values(data);

        const nameIncludes = query.nameIncludes?.trim() ? toLower(query.nameIncludes.trim()) : null;

        for (const provider of providers) {
            if (query.providerId && provider.id !== query.providerId) continue;

            const models = provider.models ?? {};
            for (const model of Object.values(models)) {
                if (query.modelId && model.id !== query.modelId) continue;
                if (query.family && model.family !== query.family) continue;

                if (nameIncludes) {
                    const name = typeof model.name === "string" ? toLower(model.name) : "";
                    const id = typeof model.id === "string" ? toLower(model.id) : "";
                    if (!name.includes(nameIncludes) && !id.includes(nameIncludes)) continue;
                }

                if (query.supports) {
                    let ok = true;
                    for (const [k, v] of Object.entries(query.supports)) {
                        if ((model as any)[k] !== v) {
                            ok = false;
                            break;
                        }
                    }
                    if (!ok) continue;
                }

                if (query.modalities) {
                    const mods = model.modalities;
                    if (!mods) continue;

                    if (query.modalities.input && !includesAll(mods.input ?? [], query.modalities.input)) continue;
                    if (query.modalities.output && !includesAll(mods.output ?? [], query.modalities.output)) continue;
                }

                out.push({ provider, model });
            }
        }

        return out;
    }

    private validate(json: unknown): ModelsDevApiResponse {
        if (!isRecord(json)) throw new Error("models.dev response is not an object");

        const out: ModelsDevApiResponse = {};
        for (const [providerId, providerValue] of Object.entries(json)) {
            if (!isRecord(providerValue)) continue;

            const models = providerValue.models;
            if (!isRecord(models)) continue;

            const normalizedProvider: ModelsDevProvider = {
                ...(providerValue as any),
                id: typeof providerValue.id === "string" ? providerValue.id : providerId,
                models: models as any,
            };

            out[providerId] = normalizedProvider;
        }

        return out;
    }
}

export const modelsDev = new ModelsDevClient();

export async function getModelsDevData(options: { refresh?: boolean } = {}): Promise<ModelsDevApiResponse> {
    return modelsDev.getAll(options);
}

export async function getModelsDevProvider(providerId: string, options: { refresh?: boolean } = {}): Promise<ModelsDevProvider | null> {
    return modelsDev.getProvider(providerId, options);
}

export async function getModelsDevModel(
    providerId: string,
    modelId: string,
    options: { refresh?: boolean } = {}
): Promise<ModelsDevModel | null> {
    return modelsDev.getModel(providerId, modelId, options);
}

export async function findModelsDevModelById(
    modelId: string,
    options: { refresh?: boolean } = {}
): Promise<ModelsDevSearchResult | null> {
    return modelsDev.getModelById(modelId, options);
}

export async function searchModelsDev(query: ModelsDevSearchQuery, options: { refresh?: boolean } = {}): Promise<ModelsDevSearchResult[]> {
    return modelsDev.search(query, options);
}

export async function getModelsDevContextLimit(
    providerId: string,
    modelId: string,
    options: { refresh?: boolean } = {}
): Promise<number | null> {
    try {
        const direct = await getModelsDevModel(providerId, modelId, options);
        const limit = direct?.limit?.context;
        if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) return limit;
    } catch {
    }

    try {
        const byId = await findModelsDevModelById(modelId, options);
        const limit = byId?.model?.limit?.context;
        if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) return limit;
    } catch {
    }

    return null;
}

export async function getModelsDevOutputLimit(
    providerId: string,
    modelId: string,
    options: { refresh?: boolean } = {}
): Promise<number | null> {
    try {
        const direct = await getModelsDevModel(providerId, modelId, options);
        const limit = direct?.limit?.output;
        if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) return limit;
    } catch {
    }

    try {
        const byId = await findModelsDevModelById(modelId, options);
        const limit = byId?.model?.limit?.output;
        if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) return limit;
    } catch {
    }

    return null;
}

export function modelAcceptsImages(model: ModelsDevModel): boolean {
    if (!model.modalities) return false;
    const { input } = model.modalities;
    return Array.isArray(input) && input.includes("image");
}
