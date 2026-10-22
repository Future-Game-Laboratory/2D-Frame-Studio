import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAnalysis,computeBaseComposite,isCompositeSafe} from '../src/composite.js';
import {sortEntries, isImageFile, toFileEntries} from '../src/files.js';
const settings={orientation:'horizontal',scale:100,gap:10,fps:12};
const frames=[{width:100,height:80},{width:60,height:40}];
test('mixed dimensions keep order, gap and centered alignment',()=>{
  const a=buildAnalysis(frames,settings);
  assert.deepEqual([a.width,a.height],[170,80]);
  assert.deepEqual(a.positions.map(p=>[p.x,p.y,p.width,p.height]),[[0,0,100,80],[110,20,60,40]]);
});
test('vertical layout with scaling uses output-pixel gaps',()=>{
  const a=buildAnalysis(frames,{...settings,orientation:'vertical',scale:50});
  assert.deepEqual([a.width,a.height],[50,70]);
  assert.deepEqual(a.positions.map(p=>[p.x,p.y]),[[0,0],[10,50]]);
});
test('empty and tiny frames do not produce zero-size output',()=>{
  assert.equal(buildAnalysis([],settings),null);
  assert.equal(computeBaseComposite([{width:1,height:1}],settings,1).width,1);
});
test('oversized output recommends a verified safe scale',()=>{
  const f=Array.from({length:10},()=>({width:5000,height:5000}));
  const a=buildAnalysis(f,settings); assert.equal(a.exceedsLimit,true); assert.ok(a.recommendedScale>0);
  const safe=buildAnalysis(f,{...settings,scale:a.recommendedScale}); assert.equal(safe.exceedsLimit,false);
  assert.equal(isCompositeSafe(32768,1),false);
});
test('impossible gaps cannot be fixed by scale',()=>{
  const f=Array.from({length:200},()=>({width:1,height:1}));
  const a=buildAnalysis(f,{...settings,gap:300}); assert.equal(a.recommendedScale,0);
});
test('natural sort and Windows path normalization',()=>{
  const entries=toFileEntries([{name:'frame10.png'},{name:'frame2.png'},{name:'frame1.png',webkitRelativePath:'folder\\frame1.png'}]);
  assert.equal(entries[2].relativePath,'folder/frame1.png');
  assert.deepEqual(sortEntries(entries.slice(0,2)).map(e=>e.file.name),['frame2.png','frame10.png']);
  assert.ok(isImageFile({name:'FRAME.PNG'})); assert.equal(isImageFile({name:'notes.txt'}),false);
});
