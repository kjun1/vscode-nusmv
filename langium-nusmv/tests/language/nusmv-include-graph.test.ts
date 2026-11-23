import assert from 'node:assert/strict';
import test from 'node:test';
import { EmptyFileSystem, URI } from 'langium';
import { createNuSMVServices } from '../../src/language/nusmv-module.js';

test('reports cycles and repeated transitive includes at their source directives', async () => {
    const { shared } = createNuSMVServices(EmptyFileSystem);
    const documents = shared.workspace.LangiumDocuments;
    const model = (name: string, text: string) => documents.createDocument(URI.file('/models/' + name), text);

    const root = model('main.smv', '#include "left.smv"\n#include "right.smv"\nMODULE main');
    model('left.smv', '#include "child.smv"\nMODULE left');
    model('right.smv', '#include "./child.smv"\nMODULE right');
    model('child.smv', 'MODULE child');
    const loop = model('loop.smv', '#include "back.smv"\nMODULE loop');
    const back = model('back.smv', '#include "loop.smv"\nMODULE back');

    await shared.workspace.DocumentBuilder.build([root, loop], { validation: true });
    assert.deepEqual(root.diagnostics.map(issue => [issue.range.start.line, issue.message]), [
        [1, 'Model "child.smv" is included more than once.']
    ]);
    for (const doc of [loop, back]) {
        assert.equal(doc.diagnostics.length, 1);
        assert.match(doc.diagnostics[0].message, /Cyclic include/);
        assert.equal(doc.diagnostics[0].range.start.line, 0);
    }
});
