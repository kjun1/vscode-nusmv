import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { URI } from 'langium';
import { findSpecificationUses } from '../../src/language/nusmv-specification-uses.js';

test('finds direct specification uses across closed and open importers without crossing declarations', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'nusmv-specs-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const uri = (name: string) => URI.file(join(directory, name)).toString();
    const files = {
        'door.smv': 'MODULE door\nDEFINE old_name := TRUE;',
        'wrapper.smv': '#include "door.smv"\nMODULE wrapper\nVAR d : door;',
        'checks.smv': [
            '#include "wrapper.smv"', 'MODULE main', 'VAR w : wrapper;',
            'DEFINE alias := w.d.ready;', 'LTLSPEC NAME direct := G (w.d.ready & w.d.ready)',
            'CTLSPEC NAME indirect := EF alias', 'CTLSPEC EF w.d.ready'
        ].join('\n'),
        'copy.smv': 'MODULE door\nDEFINE ready := FALSE;',
        'unrelated.smv': '#include "copy.smv"\nMODULE main\nVAR d : door;\nLTLSPEC NAME other := G d.ready',
        'editing.smv': 'MODULE main'
    };
    await Promise.all(Object.entries(files).map(([name, text]) => writeFile(join(directory, name), text)));
    // The declaration only exists in this unsaved buffer. "editing" also has an unsaved new specification.
    const open = new Map([
        [uri('door.smv'), 'MODULE door\nDEFINE ready := TRUE;'],
        [uri('editing.smv'), '#include "wrapper.smv"\nMODULE main\nVAR w : wrapper;\nSPEC NAME editing := EF w.d.ready']
    ]);
    const result = await findSpecificationUses({
        textDocument: { uri: uri('door.smv') }, position: { line: 1, character: 8 },
        files: [uri('checks.smv'), uri('unrelated.smv'), uri('editing.smv'), uri('deleted.smv')]
    }, open);
    assert.equal(result.symbol, 'ready');
    assert.equal(result.unreadable, 1);
    assert.deepEqual(result.uses.map(use => [use.uri, use.label]), [
        [uri('checks.smv'), 'direct'], [uri('checks.smv'), 'CTLSPEC EF w.d.ready'], [uri('editing.smv'), 'editing']
    ]);
    const direct = files['checks.smv'].split('\n')[4].indexOf('ready');
    assert.deepEqual(result.uses[0].range, {
        start: { line: 4, character: direct }, end: { line: 4, character: direct + 5 }
    });
});

test('accepts a local use as the search origin and ignores unresolved names', async () => {
    const uri = URI.file('/models/local.smv').toString();
    const snapshots = new Map([[uri, 'MODULE main\nVAR door : boolean;\nLTLSPEC G door\nLTLSPEC G absent']]);
    const search = (line: number) => findSpecificationUses({
        textDocument: { uri }, position: { line, character: 10 }, files: []
    }, snapshots);
    const result = await search(2);
    assert.equal(result.symbol, 'door');
    assert.deepEqual(result.uses.map(use => use.label), ['LTLSPEC G door']);
    assert.deepEqual(await search(3), { symbol: null, uses: [], unreadable: 0 });
});
