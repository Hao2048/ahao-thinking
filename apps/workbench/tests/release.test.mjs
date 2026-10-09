import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseOptions,notarize,updateManifest} from '../scripts/release.mjs';
test('release preflight requires distribution credentials and rejects insecure feeds',()=>{
  assert.throws(()=>releaseOptions({}),/Developer ID/);
  assert.throws(()=>releaseOptions({AIPM_SIGN_IDENTITY:'Apple Development: Test'}),/Developer ID/);
  assert.throws(()=>releaseOptions({AIPM_SIGN_IDENTITY:'Developer ID Application: Test'}),/NOTARY/);
  const options=releaseOptions({AIPM_SIGN_IDENTITY:'Developer ID Application: Test',AIPM_NOTARY_PROFILE:'test',AIPM_RELEASE_BASE_URL:'https://example.com/releases'});
  assert.equal(options.baseURL,'https://example.com/releases/');
  const manifest=updateManifest({version:'1.0.0',architecture:'x64',baseURL:options.baseURL,digest:{sha256:'fixture',size:100}});
  assert.equal(manifest.currentRelease,'1.0.0');assert.match(manifest.releases[0].updateTo.url,/mac-x64.zip$/);
});
test('notarization only staples accepted artifacts',async()=>{
  const calls=[];const run=async(_binary,args)=>{calls.push(args);return{stdout:JSON.stringify({status:'Accepted',id:'fixture-id'})};};
  const result=await notarize('fixture.zip',{profile:'test'},run);assert.equal(result.status,'Accepted');assert.equal(calls.length,3);
  await assert.rejects(notarize('fixture.zip',{profile:'test'},async()=>({stdout:'{"status":"Invalid"}'})),/未通过/);
});
