import { DocumentState, URI, isOperationCancelled } from 'langium';
import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, LSPErrorCodes, ProposedFeatures, ResponseError } from 'vscode-languageserver/node.js';
import { specificationUsesRequest, type SpecificationUsesParams } from '../shared/specification-uses.js';
import { createNuSMVServices } from './nusmv-module.js';
import { findSpecificationUses } from './nusmv-specification-uses.js';

const connection = createConnection(ProposedFeatures.all);
const { shared } = createNuSMVServices({
    connection,
    ...NodeFileSystem
});

connection.onRequest(specificationUsesRequest, async (params: SpecificationUsesParams, token) => {
    const snapshots = new Map(shared.workspace.TextDocuments.all()
        .filter(doc => doc.languageId === 'nusmv')
        .map(doc => [URI.parse(doc.uri).toString(), doc.getText()]));
    try {
        return await findSpecificationUses(params, snapshots, token);
    } catch (error) {
        if (isOperationCancelled(error)) {
            throw new ResponseError(LSPErrorCodes.RequestCancelled, 'Search cancelled.');
        }
        throw error;
    }
});

// Serve completions as soon as local scopes are ready rather than waiting for validation.
startLanguageServer(shared, {
    CompletionProvider: DocumentState.ComputedScopes
});
