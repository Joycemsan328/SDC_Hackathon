import assert from "node:assert/strict";
import { test } from "node:test";
import { GeneratedProposalSchema, ProposalGenerator, ProposalPlanASchema, normalizeProposalTotals, parseProposalOutput, validateSubmissionProposal, type RunpodDiagnostic } from "../src/services/proposalGenerator";

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

const submissionProposal = {
  recommendation: "Plan A is the relaxed garden option; Plan B changes the setting and adds a lounge experience.",
  plans: [
    {
      id: "A" as const, title: "Garden supper", concept: "A relaxed outdoor dinner with one shared dining table.",
      theme: "Warm garden", timeline: [
        { time: "5:00 pm", activity: "Setup and sound check" },
        { time: "6:30 pm", activity: "Guest arrival and welcome" },
        { time: "7:30 pm", activity: "Seated dinner" },
      ],
      venue: { name: "Suggested garden dining venue type", setup: "One shared table with simple floral styling." },
      catering: "A three-course set menu for 24 guests.", services: ["Catering", "Simple styling", "Background sound"],
      costBreakdown: [
        { item: "Catering", description: "Set menu allowance for 24 guests", amountMYR: 4_800 },
        { item: "Styling", description: "Table flowers and linens", amountMYR: 1_000 },
        { item: "Sound", description: "Basic background speaker", amountMYR: 400 },
        { item: "Venue allowance", description: "Unconfirmed garden venue estimate", amountMYR: 1_200 },
      ],
      totalEstimatedMYR: 7_400, assumptions: ["The event remains at 24 guests."],
      unconfirmedCosts: ["Venue price and availability require confirmation."],
    },
    {
      id: "B" as const, title: "Conservatory lounge evening", concept: "A social indoor dinner with a separate lounge and acoustic set.",
      theme: "Warm garden", timeline: [
        { time: "4:30 pm", activity: "Lounge and dining setup" },
        { time: "6:00 pm", activity: "Guest arrival and acoustic set" },
        { time: "7:00 pm", activity: "Family-style dinner" },
        { time: "8:30 pm", activity: "Lounge conversation and dessert" },
      ],
      venue: { name: "Suggested conservatory venue type", setup: "Dining area plus a small lounge seating zone." },
      catering: "Family-style sharing menu for 24 guests.", services: ["Catering", "Lounge seating", "Acoustic music"],
      costBreakdown: [
        { item: "Catering", description: "Sharing menu allowance for 24 guests", amountMYR: 4_000 },
        { item: "Lounge seating", description: "Furniture rental estimate", amountMYR: 1_000 },
        { item: "Acoustic set", description: "Unconfirmed performer estimate", amountMYR: 800 },
        { item: "Venue allowance", description: "Unconfirmed indoor venue estimate", amountMYR: 1_000 },
      ],
      totalEstimatedMYR: 6_800, assumptions: ["The venue can accommodate separate dining and lounge areas."],
      unconfirmedCosts: ["Venue and performer pricing and availability require confirmation."],
    },
  ],
};

function fakeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function dependencies(fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>, extras: Record<string, string> = {}) {
  return {
    env: { RUNPOD_API_KEY: "test-key-never-returned", RUNPOD_ENDPOINT_ID: "test-endpoint", RUNPOD_POLL_INTERVAL_MS: "1", RUNPOD_REQUEST_TIMEOUT_MS: "100", ...extras },
    fetchImpl,
    sleepImpl: async () => undefined,
    diagnosticImpl: () => undefined,
  };
}

test("validates both plans and their itemized MYR totals", () => {
  assert.equal(GeneratedProposalSchema.safeParse(proposal).success, true);
  assert.equal(ProposalPlanASchema.safeParse({ ...proposal.plans[0], totalEstimatedMYR: 100 }).success, false);
  assert.equal(GeneratedProposalSchema.safeParse({ ...proposal, plans: [proposal.plans[1], proposal.plans[0]] }).success, false);
});

test("derives incorrect AI totals without changing costs, narratives, or input", () => {
  const input = structuredClone(proposal);
  input.plans[0].totalEstimatedMYR = 7_000;
  const before = structuredClone(input);
  const corrected = normalizeProposalTotals(input);
  assert.equal(corrected.plans[0].totalEstimatedMYR, 6_000);
  assert.equal(corrected.plans[1].totalEstimatedMYR, 7_500);
  assert.deepEqual(corrected.plans[0].costBreakdown, input.plans[0].costBreakdown);
  assert.deepEqual(input, before);
  assert.deepEqual(corrected, proposal);
  assert.equal(GeneratedProposalSchema.safeParse(input).success, false);
  assert.equal(GeneratedProposalSchema.safeParse(corrected).success, true);
});

test("offline RunPod array response uses full parsing and total normalization without HTTP", () => {
  const input = structuredClone(proposal);
  input.plans[0].totalEstimatedMYR = 7_000;
  const corrected = parseProposalOutput([{
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(input) } }],
  }]);
  assert.deepEqual(corrected, proposal);
});

test("total normalization still rejects invalid cost items, missing plans, and negative totals", () => {
  const negative = structuredClone(proposal); negative.plans[0].costBreakdown[0].amountMYR = -1;
  assert.throws(() => normalizeProposalTotals(negative));
  const malformed = structuredClone(proposal); malformed.plans[0].title = "";
  assert.throws(() => normalizeProposalTotals(malformed));
  const negativeTotal = structuredClone(proposal); negativeTotal.plans[0].totalEstimatedMYR = -1;
  assert.throws(() => normalizeProposalTotals(negativeTotal));
  assert.throws(() => normalizeProposalTotals({ ...proposal, plans: [proposal.plans[0]] }));
});

test("normalizes line prices to cents before deriving the matching total", () => {
  const input = structuredClone(proposal);
  input.plans[0].costBreakdown[0].amountMYR = 1.005;
  input.plans[0].costBreakdown[1].amountMYR = 0.004;
  const before = structuredClone(input);
  const corrected = normalizeProposalTotals(input);
  assert.equal(corrected.plans[0].costBreakdown[0]?.amountMYR, 1.01);
  assert.equal(corrected.plans[0].costBreakdown[1]?.amountMYR, 0);
  assert.equal(corrected.plans[0].totalEstimatedMYR, 1.01);
  assert.equal(corrected.plans[0].totalEstimatedMYR, corrected.plans[0].costBreakdown.reduce((sum, item) => sum + item.amountMYR, 0));
  assert.deepEqual(input, before);
});

test("submission validation corrects totals and accepts different plans sharing required services", () => {
  const malformedTotal = structuredClone(submissionProposal);
  malformedTotal.plans[0].totalEstimatedMYR = 999;
  const validated = validateSubmissionProposal(malformedTotal, request);
  assert.equal(validated.plans[0].totalEstimatedMYR, 7_400);
  assert.equal(validated.plans[1].totalEstimatedMYR, 6_800);
  assert.deepEqual(validated.plans[0].costBreakdown, submissionProposal.plans[0].costBreakdown);
  assert.ok(validated.plans.every(plan => plan.services.includes("Catering")));
});

test("submission validation accepts honest itemized totals above budget without changing prices or budget", () => {
  for (const planIndex of [0, 1]) {
    const overBudget = structuredClone(submissionProposal);
    const originalPrices = structuredClone(overBudget.plans[planIndex].costBreakdown);
    overBudget.plans[planIndex].costBreakdown[0].amountMYR = 9_000;
    const validated = validateSubmissionProposal(overBudget, request);
    assert.ok(validated.plans[planIndex].totalEstimatedMYR > request.budgetMYR);
    assert.equal(validated.plans[planIndex].costBreakdown[0].amountMYR, 9_000);
    assert.deepEqual(overBudget.plans[planIndex].costBreakdown.slice(1), originalPrices.slice(1));
    assert.equal(request.budgetMYR, 8_000);
  }
});

test("submission accepts an exactly-on-budget decimal total using integer cents", () => {
  const exactBudget = structuredClone(submissionProposal);
  for (const plan of exactBudget.plans) {
    plan.costBreakdown.forEach((item, index) => { item.amountMYR = [0.1, 0.2, 0.3, 0.5][index]!; });
  }
  const validated = validateSubmissionProposal(exactBudget, { ...request, budgetMYR: 1.1 });
  assert.equal(validated.plans[0].totalEstimatedMYR, 1.1);
  assert.equal(validated.plans[1].totalEstimatedMYR, 1.1);
});

test("submission validation rejects identical and near-identical plan pairs", () => {
  const identical = structuredClone(submissionProposal);
  identical.plans[1] = { ...identical.plans[0], id: "B" };
  assert.throws(
    () => validateSubmissionProposal(identical, request),
    (error: unknown) => (error as { code?: string }).code === "PLANS_TOO_SIMILAR",
  );

  const nearIdentical = structuredClone(submissionProposal);
  nearIdentical.plans[1] = {
    ...nearIdentical.plans[0],
    id: "B",
    title: "A refined garden supper",
    concept: nearIdentical.plans[0].concept.replace("relaxed", "easygoing"),
    costBreakdown: nearIdentical.plans[0].costBreakdown.map((item, index) => index === 1
      ? { ...item, description: "Simple table flowers and blooms" }
      : item),
  };
  assert.throws(
    () => validateSubmissionProposal(nearIdentical, request),
    (error: unknown) => (error as { code?: string }).code === "PLANS_TOO_SIMILAR",
  );
});

test("a valid estimate one cent above budget is retained without changing the saved budget", () => {
  const input = structuredClone(submissionProposal);
  const original = structuredClone(input);
  const saved = { ...request, budgetMYR: 7_399.99 };
  const validated = validateSubmissionProposal(input, saved);
  assert.equal(validated.plans[0].totalEstimatedMYR, 7_400);
  assert.ok(validated.plans[0].totalEstimatedMYR > saved.budgetMYR);
  assert.deepEqual(input, original);
  assert.equal(saved.budgetMYR, 7_399.99);
});

test("submission validation rejects missing or invalid budget and missing structured fields", () => {
  const missingBudget = { ...request } as Record<string, unknown>;
  delete missingBudget.budgetMYR;
  assert.throws(() => validateSubmissionProposal(submissionProposal, missingBudget), /budget are invalid/);
  assert.throws(() => validateSubmissionProposal(submissionProposal, { ...request, budgetMYR: 0 }), /budget are invalid/);
  const missingField = structuredClone(submissionProposal);
  missingField.plans[0].timeline = [] as typeof missingField.plans[0]["timeline"];
  assert.throws(() => validateSubmissionProposal(missingField, request), /required proposal structure/);
});

test("submission validation requires selected services in both plans", () => {
  const missingService = structuredClone(submissionProposal);
  missingService.plans[1].services = ["Lounge seating", "Acoustic music", "Dessert"];
  missingService.plans[1].catering = "No catering included.";
  missingService.plans[1].costBreakdown[0] = { item: "Room rental", description: "Indoor room allowance", amountMYR: 4_000 };
  assert.throws(
    () => validateSubmissionProposal(missingService, request),
    (error: unknown) => (error as { code?: string }).code === "REQUESTED_SERVICE_MISSING",
  );
});

test("submission service matching accepts common wording variants for Customer service labels", () => {
  const variant = structuredClone(submissionProposal);
  variant.plans[0].services = ["Catered meal", "Floral styling", "Photographic coverage", "Venue set-up assistance", "Audio visual equipment"];
  variant.plans[1].services = ["Catered meal", "Floral styling", "Photographic coverage", "Venue set-up assistance", "Audio visual equipment"];
  const validated = validateSubmissionProposal(variant, {
    ...request,
    selectedServices: ["Catering", "Decoration", "Photography", "Venue Setup", "Equipment"],
  });
  assert.deepEqual(validated.plans[0].services.slice(0, 5), variant.plans[0].services);
  for (const label of ["Catering", "Decoration", "Photography", "Venue Setup", "Equipment"]) {
    assert.ok(validated.plans.every(plan => plan.services.includes(label)));
  }
});

test("structured service evidence normalizes all Customer labels without inventing scope or costs", () => {
  const input = structuredClone(submissionProposal);
  for (const plan of input.plans) {
    plan.services = ["Dining package", "Event support", "Technical support", "Guest welcome", "Coordination", "Cleanup", "Schedule management"];
    plan.costBreakdown[0].item = "Buffet with table flowers";
    plan.costBreakdown[1].item = "Event photographer";
    plan.costBreakdown[1].description = "Two hours of photographic coverage";
    plan.costBreakdown[2].item = "PA system and microphones";
    plan.costBreakdown[3].description = "Venue furniture layout and seating";
  }
  const before = structuredClone(input);
  const savedRequest = { ...request, selectedServices: ["Catering", "Decoration", "Photography", "Venue Setup", "Equipment"] };
  const validated = validateSubmissionProposal(input, savedRequest);
  for (const [index, plan] of validated.plans.entries()) {
    assert.deepEqual(plan.services.slice(0, 7), before.plans[index]!.services);
    for (const label of savedRequest.selectedServices) assert.ok(plan.services.includes(label));
    assert.deepEqual(plan.costBreakdown, before.plans[index]!.costBreakdown);
  }
  assert.deepEqual(input, before, "normalization does not mutate the raw generated data");
  assert.deepEqual(validateSubmissionProposal(validated, savedRequest), validated, "cached revalidation is idempotent");
});

test("optional, excluded, customer-provided or disclaimer-only services are never fabricated", () => {
  for (const label of ["Optional photographer", "Photography is not included", "Photography provided by the customer"]) {
    const input = structuredClone(submissionProposal);
    input.plans[1].services.push(label);
    input.plans[1].concept += " Photography would look good here.";
    input.plans[1].unconfirmedCosts.push("Photographer pricing needs confirmation.");
    assert.throws(
      () => validateSubmissionProposal(input, { ...request, selectedServices: ["Photography"] }),
      (error: unknown) => (error as { code?: string }).code === "REQUESTED_SERVICE_MISSING",
    );
  }
  const contradictory = structuredClone(submissionProposal);
  contradictory.plans[1].services.push("Photography");
  contradictory.plans[1].assumptions.push("Photography is excluded.");
  assert.throws(
    () => validateSubmissionProposal(contradictory, { ...request, selectedServices: ["Photography"] }),
    (error: unknown) => (error as { code?: string }).code === "REQUESTED_SERVICE_MISSING",
  );
});

test("a component-level exclusion does not hide a separately included service", () => {
  const input = structuredClone(submissionProposal);
  input.plans.forEach(plan => { plan.costBreakdown[3].description = "Venue hire excludes catering"; });
  assert.ok(validateSubmissionProposal(input, request).plans.every(plan => plan.services.includes("Catering")));
});

test("guest photos and self-catered food do not establish supplied service coverage", () => {
  const input = structuredClone(submissionProposal);
  input.plans[1].timeline[0].activity = "Guests take event photos";
  assert.throws(
    () => validateSubmissionProposal(input, { ...request, selectedServices: ["Photography"] }),
    (error: unknown) => (error as { code?: string }).code === "REQUESTED_SERVICE_MISSING",
  );
  input.plans[1].catering = "Self-catered food";
  assert.throws(
    () => validateSubmissionProposal(input, request),
    (error: unknown) => (error as { code?: string }).code === "REQUESTED_SERVICE_MISSING",
  );
});

test("shared vocabulary and prices do not reject a concrete alternative venue setup", () => {
  const input = structuredClone(submissionProposal);
  const common = Array.from({ length: 100 }, (_, index) => `shared${index}`).join(" ");
  input.plans[0].concept = common;
  input.plans[0].venue.setup = "Seated banquet tables";
  input.plans[1] = { ...structuredClone(input.plans[0]), id: "B", venue: { ...input.plans[0].venue, setup: "Standing cocktail stations" } };
  const validated = validateSubmissionProposal(input, request);
  assert.notEqual(validated.plans[0].venue.setup, validated.plans[1].venue.setup);
});

test("submits concise submission-quality chat input, disables Qwen thinking, and parses the response", async () => {
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
  const result = await generator.generate(request, { qualityProfile: "submission" });

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
  const systemPrompt = sent.input.body.messages[0]?.content ?? "";
  assert.ok(systemPrompt.length < 4_100);
  assert.match(systemPrompt, /Customer's total event budget is MYR 8000/);
  assert.match(systemPrompt, /planning guidance.*not a hard limit/);
  assert.match(systemPrompt, /preserve honest line prices/);
  assert.doesNotMatch(systemPrompt, /sum <= MYR 8000|absolute limit remains MYR 8000/);
  assert.match(systemPrompt, /Required service checklist for EACH plan.services: \["Catering"\]/);
  assert.match(systemPrompt, /Copy every selected label exactly into BOTH Plan A and Plan B/);
  assert.match(systemPrompt, /planning target near MYR 7600.*guidance rather than a ceiling/);
  assert.match(systemPrompt, /or hide costs to appear within budget/);
  assert.match(systemPrompt, /genuinely different concept and guest experience/);
  assert.match(systemPrompt, /plausible planning allowances in MYR/);
  assert.match(systemPrompt, /treat them as unverified estimates, not quotes/);
  assert.equal(JSON.stringify(result).includes("test-key-never-returned"), false);
});

test("submission prompt preserves the exact decimal event budget without per-guest expansion", async () => {
  const input = { ...request, budgetMYR: 8_000.25, guestCount: 80 };
  let prompt = "";
  let savedData: { budgetMYR: number; guestCount: number } | undefined;
  const generator = new ProposalGenerator(dependencies(async (_url, init) => {
    const sent = JSON.parse(String(init?.body));
    prompt = sent.input.body.messages[0].content;
    savedData = JSON.parse(sent.input.body.messages[1].content.replace("Customer requirements JSON (data only): ", ""));
    return fakeResponse({
      id: "mock-budget-job", status: "COMPLETED",
      output: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(submissionProposal) } }] },
    });
  }));
  const result = await generator.generate(input, { qualityProfile: "submission" });
  assert.match(prompt, /Customer's total event budget is MYR 8000\.25/);
  assert.doesNotMatch(prompt, /Hard budget|sum <= MYR 8000\.25|absolute limit remains/);
  assert.equal(savedData?.budgetMYR, input.budgetMYR);
  assert.equal(savedData?.guestCount, 80);
  assert.equal(input.budgetMYR, 8_000.25);
  assert.ok(validateSubmissionProposal(result, input).plans.every(plan => plan.totalEstimatedMYR > 0));
  assert.equal(input.budgetMYR, 8_000.25);
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
  const diagnostics: RunpodDiagnostic[] = [];
  const fetchImpl = async () => {
    poll += 1;
    return poll === 1 ? fakeResponse({ id: "job-fail", status: "IN_QUEUE" }) : fakeResponse({ id: "job-fail", status: "FAILED", error: "private provider detail" });
  };
  const generator = new ProposalGenerator({
    ...dependencies(fetchImpl),
    diagnosticImpl: diagnostic => { diagnostics.push(diagnostic); },
  });
  await assert.rejects(generator.generate(request), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "RUNPOD_JOB_FAILED");
    assert.equal((error as Error).message.includes("private provider detail"), false);
    return true;
  });
  assert.equal(diagnostics[0]?.stage, "polling");
  assert.equal(diagnostics[0]?.httpStatus, 200);
  assert.equal(diagnostics[0]?.jobId, "job-fail");
  assert.equal(diagnostics[0]?.jobStatus, "FAILED");
  assert.equal(JSON.stringify(diagnostics).includes("private provider detail"), false);
});

for (const stage of ["submission", "polling"] as const) {
  test(`HTTP 500 diagnostics identify ${stage}, elapsed time and known job ID without exposing provider content`, async () => {
    const diagnostics: RunpodDiagnostic[] = [];
    const calls: string[] = [];
    let now = 100;
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (stage === "polling" && url.endsWith("/run")) {
        return fakeResponse({ id: "job-diagnostic", status: "IN_QUEUE" }, 202);
      }
      now += 61_000;
      return fakeResponse({
        error: {
          code: "WORKER_UNAVAILABLE", type: "worker_error",
          message: "private-customer-data", details: "test-key-never-returned",
        },
        prompt: "private-prompt", output: "private-generated-proposal",
      }, 500);
    };
    const generator = new ProposalGenerator({
      ...dependencies(fetchImpl),
      nowImpl: () => now,
      diagnosticImpl: diagnostic => { diagnostics.push(diagnostic); },
    });
    await assert.rejects(generator.generate(request), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "RUNPOD_HTTP_ERROR");
      assert.equal((error as Error).message, "Runpod returned HTTP 500.");
      return true;
    });
    assert.equal(calls.length, stage === "submission" ? 1 : 2, "no retry or extra submission");
    assert.deepEqual(diagnostics, [{
      stage, code: "RUNPOD_HTTP_ERROR", httpStatus: 500, elapsedMs: 61_000,
      jobElapsedMs: 61_000, jobId: stage === "submission" ? null : "job-diagnostic",
      providerErrorMetadata: { code: "WORKER_UNAVAILABLE", type: "worker_error" },
    }]);
    const logged = JSON.stringify(diagnostics);
    for (const privateValue of [
      "test-key-never-returned", "private-customer-data", "private-prompt",
      "private-generated-proposal", request.eventName, request.requirements,
    ]) assert.equal(logged.includes(privateValue), false);
  });
}

test("provider metadata allowlists values as well as fields and never logs unknown codes or raw HTML", async () => {
  for (const response of [
    fakeResponse({ code: "private-secret-token", type: "private-customer-name", message: "private-prompt" }, 500),
    new Response("<html>private-provider-response</html>", { status: 500 }),
  ]) {
    const diagnostics: RunpodDiagnostic[] = [];
    const generator = new ProposalGenerator({
      ...dependencies(async () => response),
      diagnosticImpl: diagnostic => { diagnostics.push(diagnostic); },
    });
    await assert.rejects(generator.generate(request), (error: unknown) => (error as { code?: string }).code === "RUNPOD_HTTP_ERROR");
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.httpStatus, 500);
    assert.equal(JSON.stringify(diagnostics).includes("private-"), false);
  }
});

test("oversized provider error bodies are ignored without changing the HTTP failure", async () => {
  const diagnostics: RunpodDiagnostic[] = [];
  const generator = new ProposalGenerator({
    ...dependencies(async () => fakeResponse({ code: "INTERNAL_SERVER_ERROR", message: "x".repeat(16_384) }, 500)),
    diagnosticImpl: diagnostic => { diagnostics.push(diagnostic); },
  });
  await assert.rejects(generator.generate(request), (error: unknown) => (error as { code?: string }).code === "RUNPOD_HTTP_ERROR");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.httpStatus, 500);
  assert.equal(diagnostics[0]?.providerErrorMetadata, undefined);
});

test("network errors record a safe phase without logging the thrown error", async () => {
  const diagnostics: RunpodDiagnostic[] = [];
  const generator = new ProposalGenerator({
    ...dependencies(async () => { throw new Error("private-network-detail"); }),
    diagnosticImpl: diagnostic => { diagnostics.push(diagnostic); },
  });
  await assert.rejects(generator.generate(request), (error: unknown) => (error as { code?: string }).code === "RUNPOD_NETWORK_ERROR");
  assert.equal(diagnostics[0]?.stage, "submission");
  assert.equal(diagnostics[0]?.httpStatus, null);
  assert.equal(diagnostics[0]?.jobId, null);
  assert.equal(JSON.stringify(diagnostics).includes("private-network-detail"), false);
});

test("polling request timeouts retain the known job ID without starting another job", async () => {
  const diagnostics: RunpodDiagnostic[] = [];
  let submissions = 0;
  const generator = new ProposalGenerator({
    ...dependencies(async (url, init) => {
      if (String(url).endsWith("/run")) {
        submissions++;
        return fakeResponse({ id: "job-timeout", status: "IN_QUEUE" });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("private-timeout-detail")), { once: true });
      });
    }, { RUNPOD_REQUEST_TIMEOUT_MS: "5" }),
    diagnosticImpl: diagnostic => { diagnostics.push(diagnostic); },
  });
  await assert.rejects(generator.generate(request), (error: unknown) => (error as { code?: string }).code === "RUNPOD_REQUEST_TIMEOUT");
  assert.equal(submissions, 1);
  assert.equal(diagnostics[0]?.stage, "polling");
  assert.equal(diagnostics[0]?.jobId, "job-timeout");
  assert.equal(diagnostics[0]?.httpStatus, null);
  assert.equal(JSON.stringify(diagnostics).includes("private-timeout-detail"), false);
});

test("diagnostics cannot mask the original error if logging fails", async () => {
  const generator = new ProposalGenerator({
    ...dependencies(async () => fakeResponse({}, 500)),
    diagnosticImpl: () => { throw new Error("logger unavailable"); },
  });
  await assert.rejects(generator.generate(request), (error: unknown) => (error as { code?: string }).code === "RUNPOD_HTTP_ERROR");
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
