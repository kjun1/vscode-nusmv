import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node.js';
import { specificationUsesRequest, type SpecificationUsesResult } from '../shared/specification-uses.js';

/** Search on demand: jump directly to a single specification, or let the user choose among several. */
export async function showSpecificationUses(client: LanguageClient, editor: vscode.TextEditor): Promise<void> {
    const params = client.code2ProtocolConverter.asTextDocumentPositionParams(editor.document, editor.selection.active);
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, title: 'Finding NuSMV specifications…', cancellable: true
    }, async (_progress, token) => {
        try {
            const files = await vscode.workspace.findFiles('**/*.smv', undefined, undefined, token);
            if (!token.isCancellationRequested) {
                return await client.sendRequest<SpecificationUsesResult>(specificationUsesRequest, {
                    ...params, files: files.filter(f => f.scheme === 'file').map(f => f.toString())
                }, token);
            }
        } catch (error) {
            if (!token.isCancellationRequested) {
                void vscode.window.showErrorMessage(`Could not find NuSMV specifications: ${String(error)}`);
            }
        }
        return undefined;
    });
    if (!result) {
        return;
    }
    if (result.unreadable) {
        void vscode.window.showWarningMessage(`NuSMV could not read ${result.unreadable} candidate file(s).`);
    }
    if (!result.symbol) {
        void vscode.window.showInformationMessage('Place the cursor on a NuSMV declaration or reference.');
        return;
    }
    if (!result.uses.length) {
        void vscode.window.showInformationMessage(`No specifications directly use '${result.symbol}' in the searched files.`);
        return;
    }
    const choices = result.uses.map(use => {
        const uri = vscode.Uri.parse(use.uri);
        return {
            label: use.label, description: `${vscode.workspace.asRelativePath(uri)}:${use.range.start.line + 1}`,
            uri, selection: client.protocol2CodeConverter.asRange(use.range)
        };
    });
    const selected = choices.length === 1 ? choices[0] : await vscode.window.showQuickPick(choices, {
        title: `Specifications using ${result.symbol}`, matchOnDescription: true
    });
    if (selected) {
        await vscode.window.showTextDocument(selected.uri, { selection: selected.selection });
    }
}
