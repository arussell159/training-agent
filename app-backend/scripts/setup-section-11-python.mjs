import {existsSync,mkdirSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const scriptDir=path.dirname(fileURLToPath(import.meta.url))
const backendDir=path.dirname(scriptDir)
const environment=path.join(backendDir,'.section11-python')
const bundled=process.platform==='win32'&&process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE,'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe')
  : null
const bootstrap=bundled&&existsSync(bundled)?bundled:(process.platform==='win32'?'python.exe':'python3')
const python=process.platform==='win32'?path.join(environment,'Scripts','python.exe'):path.join(environment,'bin','python3')

mkdirSync(backendDir,{recursive:true})
if(!existsSync(python))execFileSync(bootstrap,['-m','venv',environment],{stdio:'inherit'})
execFileSync(python,['-m','pip','install','--disable-pip-version-check','-r',path.join(backendDir,'requirements-section11.txt')],{stdio:'inherit'})
execFileSync(python,[path.join(backendDir,'vendor','section-11','examples','sync.py'),'--help'],{stdio:'ignore'})
console.log(`Section 11 Python runtime is ready at ${python}`)
