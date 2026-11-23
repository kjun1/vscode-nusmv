import { AstUtils, CstUtils, GrammarUtils, type AstNode, type LangiumDocument, type LeafCstNode } from 'langium';
import { DefaultDefinitionProvider, type DeclarationProvider } from 'langium/lsp';
import { LocationLink, type DeclarationParams, type DefinitionParams, type Position } from 'vscode-languageserver';
import type { CancellationToken } from 'vscode-languageserver/node.js';
import {
    isAsyncProcessType,
    isConstantSymbol,
    isDefineBody,
    isDotSegment,
    isEnumValue,
    isFormalParameter,
    isIncludeDirective,
    isModule,
    isSyncProcessType,
    isVarBody,
    isVariablePath
} from './generated/ast.js';
import type { VariablePath } from './generated/ast.js';
import { includedModel } from './nusmv-includes.js';
import { NuSMVServices } from './nusmv-module.js';
import type { NuSMVSymbol } from './nusmv-symbols.js';
import { resolveContextualEnumLiteral, resolvePathSymbol } from './nusmv-types.js';

/**
 * Navigates include paths to files and symbol references to declarations.
 * Selecting a name in a dotted path resolves that segment, not the entire path.
 */
export class NuSMVDefinitionProvider extends DefaultDefinitionProvider {

    constructor(services: NuSMVServices) {
        super(services);
    }

    override getDefinition(document, params: DefinitionParams, cancelToken?: CancellationToken) {
        return this.getNuSMVDefinition(document, params) ?? super.getDefinition(document, params, cancelToken);
    }

    protected getNuSMVDefinition(document, params: DefinitionParams): LocationLink[] | undefined {
        const source = findNameLeaf(document, params.position, this.grammarConfig.nameRegexp);
        if (!source) {
            return undefined;
        }

        if (isIncludeDirective(source.astNode)) {
            const included = includedModel(source.astNode);
            if (!included) {
                return [];
            }
            const start = { line: 0, character: 0 };
            const range = { start, end: start };
            return [LocationLink.create(AstUtils.getDocument(included).uri.toString(), range, range, source.range)];
        }

        const target = resolveTargetSymbol(source);
        if (!target) {
            return undefined;
        }

        const link = this.createLocationLink(source, target);
        return link ? [link] : undefined;
    }

    protected createLocationLink(source: LeafCstNode, target: NuSMVSymbol): LocationLink | undefined {
        const targetSelection = GrammarUtils.findNodeForProperty(target.$cstNode, 'name') ?? target.$cstNode;
        const targetCst = target.$cstNode ?? targetSelection;
        if (!targetSelection || !targetCst) {
            return undefined;
        }
        const targetDocument = AstUtils.getDocument(target);
        return LocationLink.create(
            targetDocument.textDocument.uri,
            targetCst.range,
            targetSelection.range,
            source.range
        );
    }
}

/** NuSMV declarations introduce their definitions, so both navigation commands use the same target. */
export class NuSMVDeclarationProvider extends NuSMVDefinitionProvider implements DeclarationProvider {

    getDeclaration(document, params: DeclarationParams, cancelToken?: CancellationToken) {
        return this.getDefinition(document, params as DefinitionParams, cancelToken);
    }
}

/** Pick the identifier at the cursor with the same end-of-name rule as Go to Definition. */
export function findNameLeaf(document: LangiumDocument, position: Position, nameRegexp: RegExp): LeafCstNode | undefined {
    const root = document.parseResult.value.$cstNode;
    return root && CstUtils.findDeclarationNodeAtOffset(root, document.textDocument.offsetAt(position), nameRegexp);
}

/** Resolve the selected name, including individual segments and context-dependent enum literals. */
export function resolveTargetSymbol(source: LeafCstNode): NuSMVSymbol | undefined {
    const node = source.astNode;
    if (isNamedSymbol(node) && isSourceForProperty(source, node, 'name')) {
        return node;
    }
    const process = AstUtils.getContainerOfType(node, item => isAsyncProcessType(item) || isSyncProcessType(item));
    if (process && isSourceForProperty(source, process, 'module')) {
        return process.module?.ref;
    }
    const segment = AstUtils.getContainerOfType(node, isDotSegment);
    if (segment && isSourceForProperty(source, segment, 'symbol')) {
        const path = segment.$container as VariablePath;
        const index = path.segments.indexOf(segment);
        return index >= 0 ? resolvePathSymbol(path, index + 1) : undefined;
    }
    const path = AstUtils.getContainerOfType(node, isVariablePath);
    if (path && isSourceForProperty(source, path, 'head')) {
        return resolvePathSymbol(path, 0) ?? resolveContextualEnumLiteral(path);
    }
    return undefined;
}

function isSourceForProperty(source: LeafCstNode, node: AstNode, property: string): boolean {
    const propertyNode = GrammarUtils.findNodeForProperty(node.$cstNode, property);
    return !!propertyNode && (propertyNode === source || CstUtils.isChildNode(source, propertyNode));
}

function isNamedSymbol(node: AstNode): node is NuSMVSymbol {
    return isModule(node)
        || isVarBody(node)
        || isFormalParameter(node)
        || isDefineBody(node)
        || isConstantSymbol(node)
        || isEnumValue(node);
}
