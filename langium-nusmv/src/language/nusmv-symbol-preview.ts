import { AstUtils, UriUtils, type AstNode } from 'langium';
import { MarkupKind, type MarkupContent } from 'vscode-languageserver';
import {
    isDefineBody, isEnumValue, isFormalParameter, isFrozenVariableDeclaration, isIVariableDeclaration,
    isModule, isVarBody, type Module
} from './generated/ast.js';
import { findContainingModule, type NuSMVSymbol } from './nusmv-symbols.js';

const PREVIEW_LIMIT = 1200;
const LABEL_LIMIT = 90;

/** Read from the parsed snapshot (including unsaved edits), without copying an arbitrarily large expression. */
function sourcePreview(node: AstNode | undefined, end?: number): string {
    const cst = node?.$cstNode;
    if (!cst) {
        return '…';
    }
    const endOffset = end ?? cst.end;
    return cst.root.fullText.slice(cst.offset, Math.min(endOffset, cst.offset + PREVIEW_LIMIT))
        + (endOffset - cst.offset > PREVIEW_LIMIT ? '…' : '');
}

function moduleHeader(module: Module): string {
    const lastParameter = module.params.at(-1)?.$cstNode;
    return lastParameter ? sourcePreview(module, lastParameter.end) + ')' : 'MODULE ' + module.name;
}

function declarationPreview(symbol: NuSMVSymbol): { declaration: string; summary: string } {
    if (isDefineBody(symbol)) {
        const value = sourcePreview(symbol.assignment);
        return { declaration: `DEFINE ${symbol.name} := ${value}`, summary: value };
    }
    if (isVarBody(symbol)) {
        const section = isFrozenVariableDeclaration(symbol.$container) ? 'FROZENVAR'
            : isIVariableDeclaration(symbol.$container) ? 'IVAR' : 'VAR';
        const type = sourcePreview(symbol.type);
        return { declaration: `${section} ${symbol.name} : ${type}`, summary: type };
    }
    if (isModule(symbol)) {
        const header = moduleHeader(symbol);
        return { declaration: header, summary: header };
    }
    if (isFormalParameter(symbol)) {
        return { declaration: `-- Parameter: ${symbol.name}\n${moduleHeader(symbol.$container)}`, summary: `Parameter of ${symbol.$container.name}` };
    }
    if (isEnumValue(symbol)) {
        const variable = AstUtils.getContainerOfType(symbol, isVarBody);
        const summary = variable ? `Enum member of ${variable.name}` : 'Enum member';
        return { declaration: `${symbol.name} — ${summary}: ${sourcePreview(symbol.$container)}`, summary };
    }
    return { declaration: `CONSTANTS ${symbol.name}`, summary: 'Constant' };
}

/** Use the same declaration in hover and completion, but keep suggestion rows short and single-line. */
export function symbolPreview(symbol: NuSMVSymbol): { description: string; documentation: MarkupContent } {
    const { declaration, summary } = declarationPreview(symbol);
    const text = summary.replace(/\s+/g, ' ').trim();
    const description = text.length <= LABEL_LIMIT ? text : text.slice(0, LABEL_LIMIT - 1) + '…';
    const module = findContainingModule(symbol);
    const scope = module && module !== symbol ? `MODULE ${module.name} · ` : '';
    const location = UriUtils.basename(AstUtils.getDocument(symbol).uri);
    const line = symbol.$cstNode?.range.start.line;
    const origin = scope + location + (line !== undefined ? ':' + (line + 1) : '');
    // Indent all model text, including filenames and comments, as literal Markdown code.
    const value = (declaration + '\n\n' + origin).split(/\r\n|\r|\n/).map(part => '    ' + part).join('\n');
    return { description, documentation: { kind: MarkupKind.Markdown, value } };
}
