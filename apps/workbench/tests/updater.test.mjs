import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createUpdater,updateSettings} from '../desktop/updater.mjs';
test('updater requires HTTPS, never downloads ad hoc builds and prevents duplicate checks',async()=>{
  for(const feedURL of ['http://example.com/feed','https://user:secret@example.com/feed','https://example.com/feed?key=secret'])assert.throws(()=>updateSettings({feedURL}));
  const native=new EventEmitter();let checks=0,installs=0,prepared=false;
  native.setFeedURL=()=>{};native.checkForUpdates=()=>checks++;native.quitAndInstall=()=>{assert.equal(prepared,true);installs++;};
  const local=createUpdater({autoUpdater:native,supported:false,version:'1.0.0'});
  local.configure({feedURL:'https://example.com/feed',enabled:true});assert.equal(local.check().status,'unsupported');assert.equal(checks,0);local.close();
  const updater=createUpdater({autoUpdater:native,supported:true,version:'1.0.0',prepareInstall:async()=>{prepared=true;}});
  updater.configure({feedURL:'https://example.com/feed',enabled:false});updater.check();updater.check();assert.equal(checks,1);
  assert.throws(()=>updater.configure({feedURL:'https://other.example/feed'}),/进行中/);
  native.emit('update-not-available');assert.equal(updater.status().status,'current');
  updater.check();native.emit('update-available');assert.equal(updater.status().status,'downloading');
  native.emit('update-downloaded',{},'notes','1.1.0');assert.equal(updater.status().status,'ready');await updater.install();assert.equal(installs,1);updater.close();
});
