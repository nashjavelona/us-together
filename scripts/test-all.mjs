import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

// Keep browser-global stubs isolated between files. Some managed runtimes do
// not forward child-process stdout, which hides the normal Node runner's case
// events. Native TAP reports on disk preserve those counters and failure details.
const root=fileURLToPath(new URL('../',import.meta.url));
const files=readdirSync(join(root,'tests')).filter(name=>name.endsWith('.test.js')).sort();
const directory=mkdtempSync(join(tmpdir(),'us-together-tests-'));
const totals={tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0};
let failedFiles=0;

try{
  if(!files.length)throw Error('No tests/*.test.js files were found.');
  for(const [index,file]of files.entries()){
    const reportPath=join(directory,`${index}.tap`);
    const result=spawnSync(process.execPath,[
      '--test-reporter=tap',`--test-reporter-destination=${reportPath}`,join(root,'tests',file),
    ],{cwd:root,stdio:'inherit',timeout:60000});
    let report='';
    try{report=readFileSync(reportPath,'utf8');}catch{/* Missing output fails this file below. */}
    const counts=Object.fromEntries([...report.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm)].map(([,key,value])=>[key,Number(value)]));
    const complete=Object.keys(totals).every(key=>Number.isSafeInteger(counts[key]))&&counts.tests>0;
    const passed=complete&&result.status===0&&!result.signal&&!result.error&&counts.fail===0&&counts.cancelled===0;
    if(complete)for(const key of Object.keys(totals))totals[key]+=counts[key];
    console.log(`${passed?'PASS':'FAIL'} ${file}: ${complete?`${counts.pass}/${counts.tests} cases passed`:'no complete native test report'}`);
    if(!passed){
      failedFiles++;
      if(result.error)console.error(result.error.message);
      if(result.signal)console.error(`Stopped by ${result.signal}.`);
      if(report)console.error(report.trimEnd());
      if(result.stdout)console.error(result.stdout.trimEnd());
      if(result.stderr)console.error(result.stderr.trimEnd());
    }
  }
  console.log(`\n${totals.pass}/${totals.tests} cases passed across ${files.length} files; ${totals.fail} failed, ${totals.cancelled} cancelled, ${totals.skipped} skipped, ${totals.todo} todo.`);
  if(failedFiles){console.error(`${failedFiles} test file(s) failed or did not produce a complete report.`);process.exitCode=1;}
}catch(error){
  console.error(error.message);process.exitCode=1;
}finally{
  rmSync(directory,{recursive:true,force:true});
}
