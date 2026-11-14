import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Operations} from './operations';
import {installWorkspaces} from './workspaces';

test('MICHAEL self-link endpoint creates missing staging academic fixture and links student',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hiau-self-link-fixture-'));
  const store=new Operations(directory);
  const adminId=crypto.randomUUID();
  const michaelId=crypto.randomUUID();
  store.saveUsers([
    {id:adminId,name:'University Administrator',email:'admin@hiau.example',role:'super_admin',title:'',department:''},
    {id:michaelId,name:'MICHAEL GWOAH',email:'michael.staging@example.com',role:'student',title:'Staging Student',department:''},
  ]);

  const app=express();
  app.use(express.json());
  app.use((_req,res,next)=>{
    res.locals.actor={id:michaelId,email:'michael.staging@example.com',name:'MICHAEL GWOAH',role:'student',title:'Staging Student'};
    next();
  });
  installWorkspaces(app,store);
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();
  if(!address||typeof address==='string')throw Error('No test server');
  const base='http://127.0.0.1:'+address.port;

  try{
    assert.equal(store.one('SELECT COUNT(*) AS n FROM terms').n,0);
    const response=await fetch(base+'/api/workspaces/staging-student-self-link',{
      method:'POST',
      headers:{'content-type':'application/json','host':'hiau-staging.totag.network'},
      body:JSON.stringify({acceptanceTest:true}),
    });
    const data:any=await response.json();
    assert.equal(response.status,201);
    assert.equal(data.success,true);
    assert.equal(data.academicFixture.created,true);
    assert.equal(data.academicFixture.sectionIds.length,3);
    assert.equal(data.result.linked,true);
    assert.equal(data.result.created,true);

    const student=store.one('SELECT * FROM students WHERE user_id=?',michaelId);
    assert.ok(student);
    assert.equal(student.status,'active');
    assert.equal(store.one("SELECT COUNT(*) AS n FROM terms WHERE status='open'").n,1);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM sections').n,3);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM student_course_plans').n,0);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM registrations').n,0);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM invoices').n,0);

    const repeated=await fetch(base+'/api/workspaces/staging-student-self-link',{
      method:'POST',
      headers:{'content-type':'application/json','host':'hiau-staging.totag.network'},
      body:JSON.stringify({acceptanceTest:true}),
    });
    const repeatedData:any=await repeated.json();
    assert.equal(repeated.status,200);
    assert.equal(repeatedData.result.reason,'already-linked');
    assert.equal(store.one('SELECT COUNT(*) AS n FROM students').n,1);
    assert.equal(store.one('SELECT COUNT(*) AS n FROM sections').n,3);
  }finally{
    server.closeAllConnections();
    await new Promise<void>((resolve,reject)=>server.close(error=>error&&
      (error as NodeJS.ErrnoException).code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
    store.close();
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
