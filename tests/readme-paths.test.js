const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
test('README relative links and backticked paths exist',()=>{
  const md=fs.readFileSync(path.join(root,'README.md'),'utf8');
  const missing=[];
  for(const m of md.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g))
    if(!fs.existsSync(path.join(root,m[1])))missing.push(m[1]);
  assert.deepStrictEqual(missing,[]);
});
