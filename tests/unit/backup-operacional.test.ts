import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validarDestinoBackup,compararManifestos} from '../../scripts/backup-financeiro.mjs';
test('backup privado só pode gravar sob C:\\Backup',()=>{
 assert.doesNotThrow(()=>validarDestinoBackup('C:\\Backup\\financeiro-web'));
 for(const p of ['C:\\Claude-Matriz\\Projetos\\financeiro-web','C:\\Backup\\..\\Users','D:\\Backup'])assert.throws(()=>validarDestinoBackup(p));
});
test('restauração precisa coincidir em todas as tabelas, contagens e hashes',()=>{
 const a=[{schema:'public',tabela:'teste',verificacao:'hash-a'}];
 assert.doesNotThrow(()=>compararManifestos(a,a));
 assert.throws(()=>compararManifestos(a,[{...a[0],verificacao:'hash-b'}]));
 assert.throws(()=>compararManifestos(a,[]));
});
