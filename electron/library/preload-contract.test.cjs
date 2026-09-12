const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBridge() {
  const calls = [];
  let bridge;
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, api) => { bridge = api; } },
    ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({}); } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.cjs'), 'utf8'), {
    require: (name) => { assert.equal(name, 'electron'); return electron; }
  });
  return { bridge, calls };
}

test('metadata bridge preserves forced translation for different games', async () => {
  const { bridge, calls } = loadBridge();
  for (const id of ['game-a', 'game-b']) {
    const game = { id };
    const options = { forceTranslation: true };
    await bridge.enrichOnlineMetadata(game, options);
    assert.equal(calls.at(-1)[0], 'game:enrichOnlineMetadata');
    assert.equal(calls.at(-1)[1], game);
    assert.equal(calls.at(-1)[2], options);
  }
});

test('ordinary metadata enrichment does not force translation', async () => {
  const { bridge, calls } = loadBridge();
  await bridge.enrichOnlineMetadata({ id: 'ordinary' });
  assert.equal(calls[0][2], undefined);
});

test('bulk metadata enrichment keeps the batch game identifier in the IPC contract', async () => {
  const { bridge, calls } = loadBridge();
  const game = { id: 'bulk-review-game' };
  await bridge.enrichBulkMetadata(game);
  assert.deepEqual(calls.at(-1), ['game:enrichBulkMetadata', game]);
});

test('window and save operations keep their game and backup identifiers in the IPC contract', async () => {
  const { bridge, calls } = loadBridge();
  const game = { id: 'game-a' };
  await bridge.toggleFullscreen();
  await bridge.saveBackups(game);
  await bridge.createSaveBackup(game);
  await bridge.restoreSaveBackup(game, 'backup-1');
  assert.deepEqual(calls, [
    ['window:toggleFullscreen'],
    ['game:saveBackups', game],
    ['game:createSaveBackup', game],
    ['game:restoreSaveBackup', game, 'backup-1']
  ]);
});

test('enhancement-tool bridge keeps tool ids, paths, and archive options', async () => {
  const { bridge, calls } = loadBridge();
  await bridge.getEnhancementTools();
  await bridge.installEnhancementTool('magpie', { localArchivePath: 'C:\\Downloads\\Magpie.zip' });
  await bridge.selectExistingEnhancementTool('localeEmulator', 'C:\\Tools\\LEProc.exe');
  await bridge.validateEnhancementTool('magpie', 'C:\\Tools\\Magpie.exe');
  await bridge.pickEnhancementToolArchive('localeEmulator');
  await bridge.getMagpiePresets();
  assert.deepEqual(calls, [
    ['tools:status'],
    ['tools:install', 'magpie', { localArchivePath: 'C:\\Downloads\\Magpie.zip' }],
    ['tools:selectExisting', 'localeEmulator', 'C:\\Tools\\LEProc.exe'],
    ['tools:validateExisting', 'magpie', 'C:\\Tools\\Magpie.exe'],
    ['dialog:pickToolArchive', 'localeEmulator'],
    ['tools:magpiePresets']
  ]);
});
