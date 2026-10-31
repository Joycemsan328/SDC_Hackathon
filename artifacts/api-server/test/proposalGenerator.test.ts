import assert from "node:assert/strict";
import { test } from "node:test";
import { GeneratedProposalSchema, ProposalGenerator, ProposalPlanASchema } from "../src/services/proposalGenerator";

const proposal = {
  recommendation: "Plan A fits the budget; Plan B adds a more elaborate setup.",
  plans: [
    {
      id: "A", title: "Garden supper", concept: "An intimate dinner with seasonal details.", theme: "Garden at dusk",
      timeline: [{ time: "5:00 pm", activity: "Setup" }, { time: "7:00 pm", activity: "Dinner" }],
      venue: { name: "Kuala Lumpur venue", setup: "One dinner table with candles and seasonal flowers." },
      catering: "Three-course set menu with non-alcoholic drinks.", services: ["Catering", "Styling"],
      costBreakdown: [{ item: "Catering", description: "24 guests", amountMYR: 4_800 }, { item: "Styling", description: "Tablescape and flowers", amountMYR: 1_200 }],
      totalEstimatedMYR: 6_000, assumptions: ["Guest count remains 24."], unconfirmedCosts: ["Venue availability is unconfirmed."],
    },
    {
      id: "B", title: "Conservatory evening", concept: "A relaxed dinner with lounge seating.", theme: "Olive and warm gold",
      timeline: [{ time: "4:30 pm", activity: "Setup" }, { time: "6:30 pm", activity: "Guest arrival" }, { time: "7:30 pm", activity: "Dinner" }],
      venue: { name: "Kuala Lumpur venue", setup: "Dinner seating and a small lounge corner." },
      catering: "Family-style dinner with welcome drinks.", services: ["Catering", "Styling", "Lounge furniture"],
      costBreakdown: [{ item: "Catering", description: "24 guests", amountMYR: 5_000 }, { item: "Styling and lounge", description: "Setup and furniture", amountMYR: 2_500 }],
      totalEstimatedMYR: 7_500, assumptions: ["Guest count remains 24."], unconfirmedCosts: [],
    },
  ],
};

const request = {
  eventName: "Garden dinner", eventType: "Birthday", eventDate: "2027-04-15", location: "Kuala Lumpur",
  guestCount: 24, budgetMYR: 8_000, theme: "Warm garden", selectedServices: ["Catering"], requirements: "A relaxed dinner.",
};

function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function dependencies(fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>, extras: Record<string, string> = {}) {
  return {
    env: { RUNPOD_API_KEY: "test-key-never-returned", RUNPOD_ENDPOINT_ID: "test-endpoint", RUNPOD_POLL_INTERVAL_MS: "1", RUNPOD_REQUEST_TIMEOUT_MS: "100", ...extras },
    fetchImpl,
    sleepImpl: async () => undefined,
  };
}

test("validates both plans and their itemized MYR totals", () => {
  assert.equal(GeneratedProposalSchema.safeParse(proposal).success, true);
  assert.equal(ProposalPlanASchema.safeParse({ ...proposal.plans[0], totalEstimatedMYR: 100 }).success, false);
  assert.equal(GeneratedProposalSchema.safeParse({ ...proposal, plans: [proposal.plans[1], proposal.plans[0]] }).success, false);
});

test("submits concise chat-completion input, disables Qwen thinking, and parses the chat response", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/run")) return fakeResponse({ id: "job-123", status: "IN_QUEUE" });
    return fakeResponse({
      id: "job-123",
      status: "COMPLETED",
      output: { choices: [{ finish_reason: "stop", index: 0, message: { role: "assistant", content: JSON.stringify(proposal) } }] },
    });
  };
  const generator = new ProposalGenerator(dependencies(fetchImpl));
  const result = await generator.generate(request);

  assert.deepEqual(result, proposal);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, "https://api.runpod.ai/v2/test-endpoint/run");
  assert.equal(calls[1]?.url, "https://api.runpod.ai/v2/test-endpoint/status/job-123");
  assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), "Bearer test-key-never-returned");
  const sent = JSON.parse(String(calls[0]?.init?.body)) as {
    input: {
      route: string;
      method: string;
      body: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        max_tokens: number;
        n: number;
        chat_template_kwargs: { enable_thinking: boolean };
      };
    };
  };
  assert.equal(sent.input.route, "/v1/chat/completions");
  assert.equal(sent.input.method, "POST");
  assert.match(sent.input.body.messages[1]?.content ?? "", /A relaxed dinner/);
  assert.equal(sent.input.body.model, "Qwen/Qwen3-8B");
  assert.equal(sent.input.body.max_tokens, 2_048);
  assert.equal(sent.input.body.n, 1);
  assert.equal(sent.input.body.chat_template_kwargs.enable_thinking, false);
  assert.ok((sent.input.body.messages[0]?.content.length ?? Infinity) < 1_200);
  assert.equal(JSON.stringify(result).includes("test-key-never-returned"), false);
});

test("continues to parse the RunPod text-completion response format", async () => {
  const fetchImpl = async () => fakeResponse({
    id: "job-text-completion",
    status: "COMPLETED",
    output: [{ choices: [{ finish_reason: "stop", text: JSON.stringify(proposal) }] }],
  });
  const generator = new ProposalGenerator(dependencies(fetchImpl));
  assert.deepEqual(await generator.generate(request), proposal);
});

test("rejects a vLLM completion marked as truncated", async () => {
  const fetchImpl = async () => fakeResponse({
    id: "job-truncated",
    status: "COMPLETED",
    output: { choices: [{ finish_reason: "length", message: { role: "assistant", content: "partial response" } }] },
  });
  const generator = new ProposalGenerator(dependencies(fetchImpl));
  await assert.rejects(generator.generate(request), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "TRUNCATED_MODEL_OUTPUT");
    return true;
  });
});

test("surfaces a safe error for failed Runpod jobs", async () => {
  let poll = 0;
  const fetchImpl = async () => {
    poll += 1;
    return poll === 1 ? fakeResponse({ id: "job-fail", status: "IN_QUEUE" }) : fakeResponse({ id: "job-fail", status: "FAILED", error: "private provider detail" });
  };
  const generator = new ProposalGenerator(dependencies(fetchImpl));
  await assert.rejects(generator.generate(request), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "RUNPOD_JOB_FAILED");
    assert.equal((error as Error).message.includes("private provider detail"), false);
    return true;
  });
});

test("times out and best-effort cancels a pending job", async () => {
  let now = 0;
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/run")) return fakeResponse({ id: "job-slow", status: "IN_QUEUE" });
    if (url.endsWith("/cancel/job-slow")) return fakeResponse({ id: "job-slow", status: "CANCELLED" });
    return fakeResponse({ id: "job-slow", status: "IN_PROGRESS" });
  };
  const generator = new ProposalGenerator({
    ...dependencies(fetchImpl, { RUNPOD_JOB_TIMEOUT_MS: "5" }),
    sleepImpl: async (milliseconds) => { now += milliseconds; },
    nowImpl: () => now,
  });
  await assert.rejects(generator.generate(request), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "RUNPOD_TIMEOUT");
    return true;
  });
  assert.equal(calls.some((url) => url.endsWith("/cancel/job-slow")), true);
});

test("does not accept an unfamiliar completed output shape", async () => {
  const fetchImpl = async () => fakeResponse({ id: "job-shape", status: "COMPLETED", output: { result: "opaque" } });
  const generator = new ProposalGenerator(dependencies(fetchImpl));
  await assert.rejects(generator.generate(request), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "EMPTY_MODEL_OUTPUT");
    return true;
  });
});
