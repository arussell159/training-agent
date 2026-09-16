import {createHash} from 'node:crypto'
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const scriptDir=path.dirname(fileURLToPath(import.meta.url))
const backendDir=path.dirname(scriptDir)
const repositoryRoot=path.dirname(backendDir)
const vendorDir=path.join(backendDir,'vendor','section-11')
const metadataPath=path.join(backendDir,'section-11-upstream.json')
const upstream='https://github.com/CrankAddict/section-11.git'

const temporaryRoot=mkdtempSync(path.join(tmpdir(),'section-11-update-'))
const checkout=path.join(temporaryRoot,'upstream')

function sha256(file){return createHash('sha256').update(readFileSync(file)).digest('hex')}

try {
  execFileSync('git',['clone','-c','core.autocrlf=false','--depth','1',upstream,checkout],{stdio:'inherit'})
  const commit=execFileSync('git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
  const installed=existsSync(metadataPath)?JSON.parse(readFileSync(metadataPath,'utf8')):{}
  if(installed.commit===commit&&existsSync(path.join(vendorDir,'SECTION_11.md'))){
    console.log(`Section 11 is already current at ${commit}`)
    process.exitCode=0
  } else {
    const manifest=JSON.parse(readFileSync(path.join(checkout,'manifest.json'),'utf8'))
    for(const [relative,entry] of Object.entries(manifest.files || {})){
      const file=path.resolve(checkout,relative)
      if(!file.startsWith(checkout+path.sep)||!existsSync(file)||sha256(file)!==entry.hash)throw new Error(`Upstream manifest validation failed for ${relative}`)
    }
    const resolvedVendor=path.resolve(vendorDir)
    if(!resolvedVendor.startsWith(repositoryRoot+path.sep))throw new Error('Vendor target escaped the repository')
    rmSync(resolvedVendor,{recursive:true,force:true})
    mkdirSync(resolvedVendor,{recursive:true})
    cpSync(checkout,resolvedVendor,{recursive:true,filter:source=>path.basename(source)!=='.git'})
    writeFileSync(metadataPath,`${JSON.stringify({repository:'CrankAddict/section-11',branch:'main',commit,synced_at:new Date().toISOString()},null,2)}\n`)
    console.log(`Updated Section 11 to ${commit}`)
  }
} finally {
  rmSync(temporaryRoot,{recursive:true,force:true})
}
