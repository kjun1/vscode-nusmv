import assert from 'node:assert/strict';
import test from 'node:test';
import { EmptyFileSystem, URI } from 'langium';
import { textDocumentPositionParams } from 'langium/test';
import type { MarkupContent } from 'vscode-languageserver';
import { createNuSMVServices } from '../../src/language/nusmv-module.js';

test('hover and member completion preview the actual included declaration, not a same-named symbol', async () => {
    const { shared, NuSMV } = createNuSMVServices(EmptyFileSystem);
    const documents = shared.workspace.LangiumDocuments;
    const model = documents.createDocument(URI.file('/models/door.smv'),
        'MODULE door(input)\nVAR state : {open, closed};\nDEFINE ready := state = open;');
    const checks = documents.createDocument(URI.file('/models/checks.smv'),
        '#include "door.smv"\nMODULE main\nVAR entry : door(TRUE);\nDEFINE ready := FALSE;\nCTLSPEC EF (entry.ready & entry.state = open)');
    await shared.workspace.DocumentBuilder.build([checks], { validation: true });

    const position = (doc: typeof model, text: string, index = 0) =>
        textDocumentPositionParams(doc, doc.textDocument.getText().indexOf(text) + index);
    const reference = await NuSMV.lsp.HoverProvider.getHoverContent(checks, position(checks, 'entry.ready', 7));
    const declaration = await NuSMV.lsp.HoverProvider.getHoverContent(model, position(model, 'ready :=', 1));
    assert.deepEqual(reference?.contents, declaration?.contents);
    assert.match((reference.contents as MarkupContent).value, /DEFINE ready := state = open/);
    assert.match((reference.contents as MarkupContent).value, /MODULE door · door\.smv:3/);
    assert.equal(checks.textDocument.getText(reference.range), 'ready');

    const enumeration = await NuSMV.lsp.HoverProvider.getHoverContent(checks, position(checks, '= open', 3));
    assert.match((enumeration?.contents as MarkupContent).value, /open — Enum member of state: \{open, closed\}/);
    const completion = await NuSMV.lsp.CompletionProvider.getCompletion(checks, position(checks, 'entry.ready', 6));
    const item = completion.items.find(candidate => candidate.label === 'ready');
    assert.equal(item?.labelDetails?.description, 'state = open');
    assert.deepEqual(item.documentation, reference.contents);
    assert.equal(completion.items.find(candidate => candidate.label === 'state')?.labelDetails?.description, '{open, closed}');
});

test('unresolved names do not acquire previews from unrelated open models', async () => {
    const { shared, NuSMV } = createNuSMVServices(EmptyFileSystem);
    const documents = shared.workspace.LangiumDocuments;
    const unrelated = documents.createDocument(URI.file('/elsewhere/door.smv'), 'MODULE door\nDEFINE ready := TRUE;');
    const local = documents.createDocument(URI.file('/models/main.smv'), 'MODULE main\nCTLSPEC EF ready');
    await shared.workspace.DocumentBuilder.build([unrelated, local], { validation: true });
    const cursor = local.textDocument.getText().indexOf('ready') + 2;
    assert.equal(await NuSMV.lsp.HoverProvider.getHoverContent(local, textDocumentPositionParams(local, cursor)), undefined);
});

test('keeps long multiline definitions bounded and model comments literal in previews', async () => {
    const { shared, NuSMV } = createNuSMVServices(EmptyFileSystem);
    const branches = '    FALSE : TRUE;\n'.repeat(85);
    const text = 'MODULE main\nDEFINE ready := case\n    -- [doc](command:example)\n'
        + branches + '    TRUE : FALSE;\n  esac;\nINIT ready';
    const document = shared.workspace.LangiumDocuments.createDocument(URI.file('/models/large.smv'), text);
    await shared.workspace.DocumentBuilder.build([document], { validation: true });

    const cursor = textDocumentPositionParams(document, text.lastIndexOf('ready') + 2);
    const hover = await NuSMV.lsp.HoverProvider.getHoverContent(document, cursor);
    const markdown = (hover.contents as MarkupContent).value;
    assert.ok(markdown.includes('[doc](command:example)'));
    assert.ok(markdown.split('\n').every(line => line.startsWith('    ')), 'Model text must stay inside the code block.');
    assert.match(markdown, /…/);
    assert.ok(!markdown.includes('esac'));

    const completion = await NuSMV.lsp.CompletionProvider.getCompletion(document, cursor);
    const summary = completion.items.find(item => item.label === 'ready')?.labelDetails?.description;
    assert.ok(summary);
    assert.ok(summary.length <= 90 && !summary.includes('\n'));
});
