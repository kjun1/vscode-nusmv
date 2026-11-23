import type { LangiumDocument } from 'langium';
import { MultilineCommentHoverProvider } from 'langium/lsp';
import type { Hover, HoverParams } from 'vscode-languageserver';
import { findNameLeaf, resolveTargetSymbol } from './nusmv-navigation.js';
import { symbolPreview } from './nusmv-symbol-preview.js';

/** Show the declaration for exactly the identifier under the pointer, using Go to Definition's resolution. */
export class NuSMVHoverProvider extends MultilineCommentHoverProvider {
    override async getHoverContent(document: LangiumDocument, params: HoverParams): Promise<Hover | undefined> {
        const source = findNameLeaf(document, params.position, this.grammarConfig.nameRegexp);
        if (source && document.textDocument.offsetAt(params.position) < source.end) {
            const target = resolveTargetSymbol(source);
            if (target) {
                return { contents: symbolPreview(target).documentation, range: source.range };
            }
        }
        return super.getHoverContent(document, params);
    }
}
