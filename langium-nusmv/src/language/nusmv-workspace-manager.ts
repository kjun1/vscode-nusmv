import { DefaultWorkspaceManager, URI, type LangiumDocument } from 'langium';
import { DefaultDocumentUpdateHandler } from 'langium/lsp';
import type { WorkspaceFolder } from 'vscode-languageserver-types';
import { CancellationToken } from 'vscode-jsonrpc';

export class NuSMVDocumentUpdateHandler extends DefaultDocumentUpdateHandler {
    didCloseDocument({ document }: { document: { uri: string } }): void {
        // Drop the editor snapshot (including discarded edits). If an open
        // model still includes this URI, the builder reloads it from disk.
        this.fireDocumentUpdate([], [URI.parse(document.uri)]);
    }
}

/**
 * Avoid eagerly indexing every .smv file in the workspace at startup.
 * Large benchmark models can keep the language server busy long enough
 * that live diagnostics appear stale in the editor.
 */
export class NuSMVWorkspaceManager extends DefaultWorkspaceManager {
    override async initializeWorkspace(
        folders: WorkspaceFolder[],
        cancelToken: CancellationToken = CancellationToken.None
    ): Promise<void> {
        const documents: LangiumDocument[] = [];
        const collector = (document: LangiumDocument): void => {
            documents.push(document);
            if (!this.langiumDocuments.hasDocument(document.uri)) {
                this.langiumDocuments.addDocument(document);
            }
        };

        await this.loadAdditionalDocuments(folders, collector);
        this._ready.resolve();
        await this.documentBuilder.build(documents, this.initialBuildOptions, cancelToken);
    }
}
