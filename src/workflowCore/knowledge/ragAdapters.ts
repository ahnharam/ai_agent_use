import {
    RagAdapter,
    RagFilters,
    RagHealth,
    RagHit,
} from './types';
import { searchKnowledge } from './retriever';

export class LocalHybridRagAdapter implements RagAdapter {
    public readonly id = 'local-hybrid';
    public readonly kind = 'local' as const;

    constructor(private readonly cwd: string) {}

    async health(): Promise<RagHealth> {
        return { ok: true, adapter: this.kind, message: 'Local hybrid lexical retrieval is available.' };
    }

    async search(query: string, filters: RagFilters): Promise<RagHit[]> {
        return searchKnowledge(this.cwd, query, filters).hits;
    }

    async read(): Promise<null> {
        return null;
    }
}
