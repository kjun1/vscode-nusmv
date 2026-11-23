import { DocumentState } from 'langium';
import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { createNuSMVServices } from './nusmv-module.js';

const connection = createConnection(ProposedFeatures.all);
const { shared } = createNuSMVServices({
    connection,
    ...NodeFileSystem
});

// Serve completions as soon as local scopes are ready rather than waiting for validation.
startLanguageServer(shared, {
    CompletionProvider: DocumentState.ComputedScopes
});
