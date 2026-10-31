import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import express from "express";
import { test } from "node:test";
import { createBusinessFirstGenerationRouter } from "../src/routes/businessFirstGeneration";
import { SupabaseBusinessWorkflowRepository, BusinessWorkflowError, businessWorkflowRepository, generateBusinessRevision, type BusinessWorkflowRepository } from "../src/services/businessFirstWorkflow";
import type { GeneratedProposal } from "../src/services/proposalGenerator";
import type { CustomerRequestRow } from "../src/services/customerSupabase";

// ALL network operations in these tests are local HTTP or injected mocks.
const customerId = "56beec8f-5031-44e9-b60c-576c1584042a";
const requestId = "45386295-f36c-4ef6-8f4c-ae9304128015";
const request: CustomerRequestRow = {
  id: requestId,customer_id:customerId,customer_name:"Mock customer",email:null,phone:null,
  event_name:"Mock dinner",event_type:"Birthday",event_date:"2027-04-15",event_time:null,
  guests:20,budget:1000,services:["Catering"],notes:"Location: Kuala Lumpur\n\nOriginal requirements",
  status:"New",created_at:null,venue_id:null,event_end_time:null,
};
const plan = {
  id:"A" as const,title:"Mock A",concept:"Mock concept",theme:"Garden",
  timeline:[{time:"6pm",activity:"Dinner"}],venue:{name:"Unconfirmed",setup:"Tables"},
  catering:"Dinner",services:["Catering"],costBreakdown:[{item:"Dinner",description:"Food",amountMYR:100}],
  totalEstimatedMYR:100,assumptions:["Estimate only"],unconfirmedCosts:[],
};
const mockAI: GeneratedProposal = { recommendation:"Mock recommendation",plans:[plan,{...plan,id:"B",title:"Mock B"}] };
function fixture(state: "claimed"|"exists"|"in_progress"="claimed",revision=1) {
  const calls = {generated:0,stored:0,prepared:0,input:null as unknown,token:""};
  const repository: BusinessWorkflowRepository = {
    prepare:async (actor,id,token) => {
      assert.equal(actor,customerId);assert.equal(id,requestId); calls.prepared++;calls.token=token;
      return {state,revision,workflowState:state==="exists"?"business_review":"generating",
        changeMessage:revision>1?"Revision 2: Add flowers\nRevision 3: Add photography":""};
    },
    store:async (actor,id,rev,token,proposal) => {
      assert.equal(actor,customerId);assert.equal(id,requestId);assert.equal(token,calls.token);
      assert.equal(proposal.plans.length,2);calls.stored++;
      return {requestId:id,revision:rev,persistence:"created",workflowState:"business_review"};
    },
  };
  const generator = {generate:async (input:unknown) => {calls.generated++;calls.input=input;return mockAI;}};
  return {repository,generator,calls};
}
test("mock generation returns metadata only, not unreleased drafts",async()=>{
  const f=fixture();
  const receipt=await generateBusinessRevision({customerId,request,...f});
  assert.deepEqual(receipt,{requestId,revision:1,persistence:"created",workflowState:"business_review"});
  assert.equal(f.calls.generated,1);assert.equal(f.calls.stored,1);
  assert.ok(!JSON.stringify(receipt).includes("Mock A"));
});
test("change revisions use database-owned revision and cumulative change messages",async()=>{
  const f=fixture("claimed",3);
  const receipt=await generateBusinessRevision({customerId,request,...f});
  assert.equal(receipt.revision,3);
  const requirements=(f.calls.input as {requirements:string}).requirements;
  assert.match(requirements,/Original requirements/);assert.match(requirements,/Add flowers/);
  assert.match(requirements,/Add photography/);
});
test("saved drafts and interrupted leases never call mock AI again",async()=>{
  const existing=fixture("exists");
  await generateBusinessRevision({customerId,request,...existing});
  assert.equal(existing.calls.generated,0);assert.equal(existing.calls.stored,0);
  const running=fixture("in_progress");
  await assert.rejects(generateBusinessRevision({customerId,request,...running}),/already in progress/);
  assert.equal(running.calls.generated,0);
});
test("missing migration fails before mock AI",async()=>{
  const f=fixture();
  f.repository.prepare=async()=>{throw new BusinessWorkflowError("WORKFLOW_NOT_READY",503,"Migration missing");};
  await assert.rejects(generateBusinessRevision({customerId,request,...f}),/Migration missing/);
  assert.equal(f.calls.generated,0);
});
test("invalid mock AI output is not persisted",async()=>{
  const f=fixture();
  f.generator.generate=async()=>({ ...mockAI,plans:[plan,plan] } as unknown as GeneratedProposal);
  await assert.rejects(generateBusinessRevision({customerId,request,...f}));
  assert.equal(f.calls.stored,0);
});
test("server-only repository is disabled without explicit activation and credentials",()=>{
  assert.equal(businessWorkflowRepository({VITE_SUPABASE_URL:"https://example.test",SUPABASE_SECRET_KEY:"test-only"}),null);
  assert.equal(businessWorkflowRepository({EVENTFLOW_BUSINESS_FIRST_ENABLED:"true",VITE_SUPABASE_URL:"https://example.test"}),null);
});
test("RPC mocks use backend secret API key, never customer's bearer",async()=>{
  const calls:{url:string;headers:Headers;body:Record<string,unknown>}[]=[];
  const fetchMock:typeof fetch=async(input,init)=>{
    calls.push({url:String(input),headers:new Headers(init?.headers),body:JSON.parse(String(init?.body))});
    return new Response(JSON.stringify({state:"claimed",revision:2,workflowState:"generating",changeMessage:"New flowers"}));
  };
  const repository=new SupabaseBusinessWorkflowRepository("https://example.test","sb_secret_FAKE_TEST_ONLY",fetchMock);
  await repository.prepare(customerId,requestId,"test-token");
  assert.match(calls[0]!.url,/eventflow_prepare_generation$/);
  assert.equal(calls[0]!.headers.get("apikey"),"sb_secret_FAKE_TEST_ONLY");
  assert.equal(calls[0]!.headers.get("authorization"),null);
});
test("missing RPC code is distinguished without leaking Supabase response details",async()=>{
  const repository=new SupabaseBusinessWorkflowRepository("https://example.test","test-only",
    async()=>new Response(JSON.stringify({code:"PGRST202",message:"DO NOT EXPOSE"}),{status:404}));
  await assert.rejects(repository.prepare(customerId,requestId,"test-token"),error=>
    error instanceof BusinessWorkflowError && error.code==="WORKFLOW_NOT_READY" && !error.message.includes("DO NOT EXPOSE"));
});
test("HTTP route rejects browser proposal injection and keeps activation disabled by default",async(context)=>{
  const f=fixture();
  const app=express();app.use(express.json());
  app.use(createBusinessFirstGenerationRouter({
    env:{},repository:f.repository,generator:f.generator,
    customers:{loadOwnedRequest:async()=>({customerId,request})},
  }));
  const server=createServer(app).listen(0,"127.0.0.1");await once(server,"listening");
  context.after(()=>{server.closeAllConnections();server.close();});
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const url=`http://127.0.0.1:${address.port}/proposals/generate-persisted`;
  const post=(body:unknown,token=true)=>fetch(url,{method:"POST",headers:{"content-type":"application/json",
    ...(token?{authorization:"Bearer FAKE_BROWSER_TOKEN"}:{})},body:JSON.stringify(body)});
  assert.equal((await post({requestId},false)).status,401);
  assert.equal((await post({requestId,plans:mockAI.plans})).status,400);
  assert.equal(f.calls.generated,0);
  const response=await post({requestId});
  assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
  assert.ok(!("proposals" in await response.json()));
});
test("migration static guardrails: restricted reads/writes, service-only persistence, Business-first states",()=>{
  const sql=readFileSync(new URL("../../../scripts/sql/eventflow-mvp-workflow.sql",import.meta.url),"utf8");
  assert.match(sql,/set local eventflow\.catalog_reviewed = 'no'/);
  assert.match(sql,/as restrictive for select to anon, authenticated/);
  assert.match(sql,/as restrictive for insert to anon, authenticated with check \(false\)/);
  assert.match(sql,/as restrictive for update to anon, authenticated/);
  assert.match(sql,/as restrictive for delete to anon, authenticated/);
  assert.match(sql,/v\.released_at is not null/);
  assert.match(sql,/v\.state not in \('released','selected'\)/);
  assert.match(sql,/v\.revision\+1,auth\.uid\(\),'queued'/);
  assert.match(sql,/eventflow_store_generated_pair[\s\S]+to service_role/);
  assert.doesNotMatch(sql,/grant execute on function public\.eventflow_store_generated_pair[^;]*to authenticated/);
  assert.doesNotMatch(sql,/\b(update|delete from) public\.proposals\b/i);
  assert.match(sql,/auth\.role\(\) is distinct from 'service_role'/);
});
