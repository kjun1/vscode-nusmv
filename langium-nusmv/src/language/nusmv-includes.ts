import * as path from 'node:path';
import {
    AstUtils, DefaultDocumentBuilder, DocumentState, interruptAndCheck, isOperationCancelled, URI,
    type BuildOptions, type LangiumDocument, type ValidationAcceptor
} from 'langium';
import type { CancellationToken } from 'vscode-jsonrpc';
import { isNuSmvModel, type IncludeDirective, type NuSmvModel } from './generated/ast.js';

// Each edge belongs to a particular parsed directive. Keep the document rather
// than its AST so that references always see its most recent parse result.
const targets = new WeakMap<IncludeDirective, LangiumDocument>();

function includePath(directive: IncludeDirective): string {
    return directive.spec.slice(directive.spec.indexOf('"') + 1, -1);
}

function startsLine(directive: IncludeDirective): boolean {
    const token = directive.$cstNode;
    const lineStart = token.offset - token.range.start.character;
    return /^[ \t]*$/.test(token.root.fullText.slice(lineStart, token.offset));
}

function targetUri(directive: IncludeDirective): URI {
    const source = AstUtils.getDocument(directive).uri;
    return URI.file(path.resolve(path.dirname(source.fsPath), includePath(directive)));
}

export function includedModel(directive: IncludeDirective): NuSmvModel | undefined {
    const model = targets.get(directive)?.parseResult.value;
    return isNuSmvModel(model) ? model : undefined;
}

export function* visibleModels(root: NuSmvModel): Iterable<NuSmvModel> {
    const pending = new Set([root]);
    for (const model of pending) {
        yield model;
        for (const directive of model.includes) {
            const target = includedModel(directive);
            if (target) {
                pending.add(target);
            }
        }
    }
}

export function checkIncludes(model: NuSmvModel, accept: ValidationAcceptor): void {
    const seen = new Set<NuSmvModel>();
    for (const directive of model.includes) {
        const info = { node: directive, property: 'spec' } as const;
        if (!startsLine(directive)) {
            accept('error', 'An include directive must start on its own line.', info);
            continue;
        }
        const target = includedModel(directive);
        if (!target) {
            accept('error', `Cannot load included model "${includePath(directive)}".`, info);
            continue;
        }

        const included = [...visibleModels(target)];
        if (included.includes(model)) {
            accept('error', `Cyclic include of "${includePath(directive)}".`, info);
        } else {
            const repeated = included.find(dependency => seen.has(dependency));
            if (repeated) {
                const file = path.basename(AstUtils.getDocument(repeated).uri.fsPath);
                accept('error', `Model "${file}" is included more than once.`, info);
            }
        }
        included.forEach(dependency => seen.add(dependency));
    }
}

export class NuSMVDocumentBuilder extends DefaultDocumentBuilder {
    protected override shouldRelink(document: LangiumDocument, changedUris: Set<string>): boolean {
        const root = document.parseResult.value;
        if (isNuSmvModel(root)) {
            // Include edges are dependencies even when they are missing, or no
            // module from them is currently referenced.
            for (const model of visibleModels(root)) {
                if (model.includes.some(include => changedUris.has(targetUri(include).toString()))) {
                    return true;
                }
            }
        }
        return super.shouldRelink(document, changedUris);
    }

    protected override async buildDocuments(
        documents: LangiumDocument[], options: BuildOptions, cancelToken: CancellationToken
    ): Promise<void> {
        // Discover the whole include closure before Langium starts indexing or
        // linking any of its documents. Do not index unrelated workspace files.
        const build = new Set(documents);
        for (const document of build) {
            await interruptAndCheck(cancelToken);
            if (document.state < DocumentState.Parsed) {
                await this.langiumDocumentFactory.update(document, cancelToken);
                await this.notifyDocumentPhase(document, DocumentState.Parsed, cancelToken);
            }
            const root = document.parseResult.value;
            if (!isNuSmvModel(root) || document.uri.scheme !== 'file') {
                continue;
            }
            for (const directive of root.includes) {
                if (!startsLine(directive)) {
                    continue;
                }
                const target = await this.loadInclude(targetUri(directive), cancelToken);
                if (target) {
                    targets.set(directive, target);
                    if (target.state < DocumentState.Validated) {
                        build.add(target);
                    }
                } else {
                    targets.delete(directive);
                }
            }
        }
        await super.buildDocuments([...build], options, cancelToken);
    }

    private async loadInclude(uri: URI, cancelToken: CancellationToken): Promise<LangiumDocument | undefined> {
        const known = this.langiumDocuments.getDocument(uri);
        if (known) {
            return known;
        }
        if (!this.serviceRegistry.hasServices(uri)) {
            return undefined;
        }
        try {
            if ((await this.fileSystemProvider.stat(uri)).isFile) {
                return await this.langiumDocuments.getOrCreateDocument(uri, cancelToken);
            }
        } catch (err) {
            if (isOperationCancelled(err)) {
                throw err;
            }
            // Missing and unreadable targets are diagnosed at the directive,
            // without preventing the rest of the workspace from being built.
        }
        return undefined;
    }
}
