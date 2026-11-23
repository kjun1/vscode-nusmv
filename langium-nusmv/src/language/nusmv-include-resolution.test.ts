import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { textDocumentPositionParams } from 'langium/test';
import { createNuSMVServices } from './nusmv-module.js';

async function fixture(t: TestContext, files: Record<string, string>) {
    const directory = await mkdtemp(join(tmpdir(), 'nusmv-includes-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const uri = (path: string) => URI.file(join(directory, path));
    const save = async (path: string, text: string) => {
        await mkdir(dirname(uri(path).fsPath), { recursive: true });
        await writeFile(uri(path).fsPath, text);
    };
    for (const [path, text] of Object.entries(files)) {
        await save(path, text);
    }
    const { NuSMV, shared } = createNuSMVServices(NodeFileSystem);
    const { LangiumDocuments: documents, DocumentBuilder: builder } = shared.workspace;
    const main = await documents.getOrCreateDocument(uri('main.smv'));
    await builder.build([main], { validation: true });
    return { main, documents, builder, NuSMV, uri, save };
}

test('resolves nested module and member definitions at their original URI and range', async t => {
    const mainText = '#include "lib/wrapper.smv"\nMODULE main\nVAR w : wrapper;\n    other : leaf;\nLTLSPEC G (w.part.ready & other.ready)';
    const leafText = 'MODULE leaf\nDEFINE ready := TRUE;';
    const { main, documents, NuSMV, uri } = await fixture(t, {
        'main.smv': mainText,
        'lib/wrapper.smv': '#include "../leaf.smv"\nMODULE wrapper\nVAR part : leaf;',
        'leaf.smv': leafText
    });
    assert.deepEqual(main.diagnostics, []);
    const leaf = documents.getDocument(uri('leaf.smv'));
    assert.deepEqual(leaf?.diagnostics, []);

    for (const name of ['leaf', 'ready']) {
        const links = await NuSMV.lsp.DefinitionProvider.getDefinition(
            main, textDocumentPositionParams(main, mainText.indexOf(name) + 1)
        );
        const start = leafText.indexOf(name);
        assert.deepEqual(links?.map(link => [link.targetUri, link.targetSelectionRange]), [
            [leaf.uri.toString(), {
                start: leaf.textDocument.positionAt(start),
                end: leaf.textDocument.positionAt(start + name.length)
            }]
        ]);
    }
    const directiveLinks = await NuSMV.lsp.DefinitionProvider.getDefinition(
        main, textDocumentPositionParams(main, mainText.indexOf('wrapper.smv'))
    );
    assert.equal(directiveLinks?.[0]?.targetUri, uri('lib/wrapper.smv').toString());
});

test('revalidates importers on creation, member edits and deletion without borrowing unrelated modules', async t => {
    const { main, builder, documents, uri, save } = await fixture(t, {
        'main.smv': '#include "wrapper.smv"\nMODULE main\nVAR w : wrapper;\nINIT w.part.ready',
        'wrapper.smv': '#include "leaf.smv"\nMODULE wrapper\nVAR part : leaf;',
        'unrelated.smv': 'MODULE leaf\nDEFINE ready := TRUE;'
    });
    const unrelated = await documents.getOrCreateDocument(uri('unrelated.smv'));
    await builder.build([unrelated], { validation: true });
    const wrapper = documents.getDocument(uri('wrapper.smv'));
    assert.ok(wrapper.diagnostics.some(d => d.message.includes('leaf.smv')));
    assert.ok(main.diagnostics.some(d => d.message === "Unknown symbol 'ready'."));

    await save('leaf.smv', 'MODULE leaf\nDEFINE ready := TRUE;');
    await builder.update([uri('leaf.smv')], []);
    assert.deepEqual(main.diagnostics, []);
    assert.deepEqual(wrapper.diagnostics, []);

    await save('leaf.smv', 'MODULE leaf\nDEFINE renamed := FALSE;');
    await builder.update([uri('leaf.smv')], []);
    assert.deepEqual(main.diagnostics.map(d => d.message), ["Unknown symbol 'ready'."]);

    await rm(uri('leaf.smv').fsPath);
    await builder.update([], [uri('leaf.smv')]);
    assert.ok(wrapper.diagnostics.some(d => d.message.includes('leaf.smv')));
    assert.ok(main.diagnostics.some(d => d.message === "Unknown symbol 'ready'."));
});

test('reports conflicting module declarations on the include that introduces the conflict', async t => {
    const { main } = await fixture(t, {
        'main.smv': '#include "first.smv"\n#include "second.smv"\nMODULE main',
        'first.smv': 'MODULE worker',
        'second.smv': 'MODULE worker'
    });
    assert.deepEqual(main.diagnostics.map(d => [d.range.start.line, d.message]), [
        [1, "Duplicate module 'worker'."]
    ]);
});
