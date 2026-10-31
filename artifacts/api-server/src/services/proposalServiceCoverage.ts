import type { GeneratedProposal } from "./proposalGenerator";

type Plan = GeneratedProposal["plans"][number];
type ServiceRule = { label: string; pattern: RegExp };

const rules: Record<string, ServiceRule> = {
  catering: { label: "Catering", pattern: /\b(?:catering|catered|caterers?|buffet|meals?|food(?: and beverages?)?|f b|set menu|sharing menu|refreshments)\b/u },
  decoration: { label: "Decoration", pattern: /\b(?:decor|decoration|decorations|decorative|florals?|flowers?|styling|tablescapes?|backdrops?)\b/u },
  photography: { label: "Photography", pattern: /\b(?:photography|photographers?|photographic|photo coverage|photo service)\b/u },
  "venue setup": { label: "Venue Setup", pattern: /\b(?:venue setup|event setup|room setup|venue preparation|seating|furniture|(?:tables?|chairs?|stage) (?:setup|layout|arrangements?))\b/u },
  equipment: { label: "Equipment", pattern: /\b(?:equipment|audio(?: and)? visual|av|a v|pa system|sound system|audio rental|sound rental|speakers?|microphones?|projectors?|lighting (?:rental|rig|system|equipment))\b/u },
};

function normalize(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("en")
    .replace(/set[\s\-\u2010-\u2015]+up/g, "setup")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Match included scope, not mentions such as "optional photographer" or "no equipment". */
function evidence(text: string, pattern: RegExp): { included: boolean; excluded: boolean } {
  const normalized = normalize(text);
  let included = false;
  let excluded = false;
  for (const match of normalized.matchAll(new RegExp(pattern.source, "gu"))) {
    const before = normalized.slice(0, match.index).slice(-100);
    const after = normalized.slice(match.index + match[0].length);
    const negated = /\b(?:no|without|excluding|excludes|optional|self|(?:customer|client|guest) (?:provided|supplied)|bring your own|(?:guests?|customers?|clients?) (?:provide|bring) (?:their )?own|not (?:include|including|provide|providing|offer|offering))(?:\s+\w+){0,4}\s*$/u.test(before)
      || /^\s*(?:(?:is|are|will be|may be|service|package|coverage|rental|fees?|costs?)\s+){0,2}(?:not (?:included|provided|available|required|needed|offered|covered|budgeted|supplied)|excluded|omitted|unavailable|optional|available on request|(?:provided by|supplied by|from) (?:the )?(?:customer|client))\b/u.test(after);
    if (negated) excluded = true;
    else included = true;
  }
  return { included, excluded };
}

export function normalizeRequestedPlanServices(plan: Plan, requestedServices: string[]): {
  services: string[];
  missing: boolean;
} {
  const requested = [...new Set(requestedServices.map(normalize))].map(key => {
    const rule = rules[key];
    // Unknown legacy labels require their own phrase, never a guessed category.
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return rule ?? { label: requestedServices.find(value => normalize(value) === key)!, pattern: key ? new RegExp(`\\b${escaped}\\b`, "u") : /(?!)/u };
  });
  const covered = requested.filter(rule => {
    const serviceMatches = plan.services.map(source => evidence(source, rule.pattern));
    const dedicated = evidence(rule.label === "Catering" ? plan.catering : plan.venue.setup, rule.pattern);
    const sources = [
      ...plan.costBreakdown.map(line => `${line.item}: ${line.description}`),
      ...plan.timeline.map(item => item.activity),
    ];
    // Disclosures cannot establish inclusion, but explicit exclusions there still matter.
    const matches = [...serviceMatches, dedicated, ...sources.map(source => evidence(source, rule.pattern))];
    const disclosures = [...plan.assumptions, ...plan.unconfirmedCosts].map(source => evidence(source, rule.pattern));
    // "Venue hire excludes catering" must not veto a separately included catering package.
    const exclusions = [...serviceMatches, ...disclosures, ...(rule.label === "Catering" ? [dedicated] : [])];
    return matches.some(match => match.included && !match.excluded) && !exclusions.some(match => match.excluded);
  });

  // Keep descriptive scope verbatim; supplement it with proven canonical labels.
  const services = [...plan.services];
  for (const rule of covered) {
    if (!services.some(service => normalize(service) === normalize(rule.label))) services.push(rule.label);
  }
  return {
    services: services.filter((service, index) => services.findIndex(value => normalize(value) === normalize(service)) === index),
    missing: covered.length !== requested.length,
  };
}
