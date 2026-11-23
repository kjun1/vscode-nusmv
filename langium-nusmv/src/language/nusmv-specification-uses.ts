import { AstUtils, CstUtils, URI, interruptAndCheck } from 'langium';
import { NodeFileSystemProvider } from 'langium/node';
import { CancellationToken } from 'vscode-jsonrpc';
import type { SpecificationUse, SpecificationUsesParams, SpecificationUsesResult } from '../shared/specification-uses.js';
import {
    isComputeSpecification, isCtlSpecification, isInvarSpecification, isLtlSpecification,
    isNuSmvModel, isPslSpecification, type NuSmvModel
} from './generated/ast.js';
import { createNuSMVServices } from './nusmv-module.js';
import { findNameLeaf, resolveTargetSymbol } from './nusmv-navigation.js';
import type { NuSMVSymbol } from './nusmv-symbols.js';

/** Search in a private document graph so unopened files do not enter the editor's diagnostics or index. */
class SearchFileSystem extends NodeFileSystemProvider {
    constructor(private readonly open: ReadonlyMap<string, string>) {
        super();
    }

    override async readFile(uri: URI): Promise<string> {
        return this.open.get(uri.toString()) ?? super.readFile(uri);
    }

    override async stat(uri: URI) {
        return this.open.has(uri.toString()) ? { uri, isFile: true, isDirectory: false } : super.stat(uri);
    }
}

/** Resolve each candidate token exactly as Go to Definition does. Repeated uses count once per specification. */
function collectUses(root: NuSmvModel, target: NuSMVSymbol): SpecificationUse[] {
    const uri = AstUtils.getDocument(root).uri.toString();
    const uses: SpecificationUse[] = [];
    for (const module of root.modules) {
        for (const item of module.elements) {
            if (!isCtlSpecification(item) && !isLtlSpecification(item) && !isInvarSpecification(item)
                && !isPslSpecification(item) && !isComputeSpecification(item)) {
                continue;
            }
            const cst = item.$cstNode;
            if (!cst) {
                continue;
            }
            const match = CstUtils.flattenCst(cst).find(leaf =>
                leaf.text === target.name && resolveTargetSymbol(leaf) === target);
            if (match) {
                const label = 'name' in item && item.name
                    ? item.name
                    : cst.text.replace(/\s+/g, ' ').slice(0, 100);
                uses.push({ uri, range: match.range, label });
            }
        }
    }
    return uses;
}

/**
 * Find specifications that refer directly to the selected declaration, including unsaved edits
 * and unopened workspace files. Text checks only narrow the candidates; identity comes from the AST.
 */
export async function findSpecificationUses(
    params: SpecificationUsesParams, open: ReadonlyMap<string, string>, token = CancellationToken.None
): Promise<SpecificationUsesResult> {
    const files = new SearchFileSystem(open);
    const { shared, NuSMV } = createNuSMVServices({ fileSystemProvider: () => files });
    const { LangiumDocuments: documents, DocumentBuilder: builder } = shared.workspace;
    const source = await documents.getOrCreateDocument(URI.parse(params.textDocument.uri), token);
    await builder.build([source], { validation: false }, token);
    const leaf = findNameLeaf(source, params.position, NuSMV.parser.GrammarConfig.nameRegexp);
    const target = leaf && resolveTargetSymbol(leaf);
    const result: SpecificationUsesResult = { symbol: target?.name ?? null, uses: [], unreadable: 0 };
    if (!target) {
        return result;
    }

    const targetUri = AstUtils.getDocument(target).uri.toString();
    const candidates = new Set([...params.files, ...open.keys(), source.uri.toString(), targetUri]);
    for (const entry of [...candidates].sort()) {
        await interruptAndCheck(token);
        const uri = URI.parse(entry);
        if (uri.scheme !== 'file') {
            continue;
        }
        let doc = documents.getDocument(uri);
        if (!doc) {
            let text: string;
            try {
                text = await files.readFile(uri);
            } catch {
                result.unreadable++;
                continue;
            }
            // A different file can only resolve this declaration through an include.
            if (!text.includes('#') || !text.includes(target.name) || !/SPEC|COMPUTE/.test(text)) {
                continue;
            }
            doc = await documents.createDocument(uri, text, token);
            await builder.build([doc], { validation: false }, token);
        }
        if (isNuSmvModel(doc.parseResult.value)) {
            result.uses.push(...collectUses(doc.parseResult.value, target));
        }
    }
    return result;
}
