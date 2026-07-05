import { upsertOpportunity } from "@/src/lib/db";
import { GeneratedTask } from "@/src/lib/types";
import { fetchWithUrlSafety } from "@/src/lib/url-safety";

const AUSTENDER_CURRENT_ATM_URL = "https://www.tenders.gov.au/atm";
const RELEVANT_TERMS = [
  "scrap",
  "metal",
  "recycling",
  "waste",
  "demolition",
  "salvage",
  "steel",
  "copper",
  "aluminium"
];

export interface ScannerResult {
  opportunitiesCreated: number;
  tasks: GeneratedTask[];
}

export async function scanAusTenderOpportunities(): Promise<ScannerResult> {
  const response = await fetchWithUrlSafety(AUSTENDER_CURRENT_ATM_URL, {
    headers: {
      "User-Agent": "RoburAutonomousWorker/1.0 compliance-led opportunity scanner"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`AusTender scan failed with HTTP ${response.status}`);
  }

  const html = await response.text();
  const candidates = extractRelevantAusTenderSnippets(html);
  let opportunitiesCreated = 0;
  const tasks: GeneratedTask[] = [];

  for (const candidate of candidates.slice(0, 10)) {
    const created = await upsertOpportunity({
      source: "austender_current_atm",
      sourceUrl: candidate.url,
      description: candidate.description,
      priority: candidate.priority,
      metadata: {
        matched_terms: candidate.matchedTerms,
        scanner: "scanAusTenderOpportunities"
      }
    });

    if (created) {
      opportunitiesCreated += 1;
      tasks.push({
        source: "austender_current_atm",
        description: `Review AusTender opportunity and decide whether Robur should respond: ${candidate.description}`,
        priority_score: candidate.priority === "critical" ? 90 : 72,
        action_type: "web_research",
        action_payload: {
          url: candidate.url,
          research_goal: "Assess relevance to Robur Resources scrap metal, recycling, demolition, or brokering revenue."
        },
        metadata: {
          source: "austender_current_atm",
          matched_terms: candidate.matchedTerms
        },
        external_contact: false
      });
    }
  }

  return { opportunitiesCreated, tasks };
}

interface Candidate {
  description: string;
  url: string;
  priority: "low" | "medium" | "high" | "critical";
  matchedTerms: string[];
}

export function extractRelevantAusTenderSnippets(html: string): Candidate[] {
  const normalized = html.replace(/\s+/g, " ");
  const anchorRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(normalized)) !== null) {
    const href = match[1];
    const text = stripTags(match[2]).trim();

    if (text.length < 8) {
      continue;
    }

    const lower = text.toLowerCase();
    const matchedTerms = RELEVANT_TERMS.filter((term) => lower.includes(term));

    if (matchedTerms.length === 0) {
      continue;
    }

    const url = href.startsWith("http") ? href : new URL(href, AUSTENDER_CURRENT_ATM_URL).toString();
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);

    candidates.push({
      description: text.slice(0, 500),
      url,
      priority: matchedTerms.length >= 2 ? "high" : "medium",
      matchedTerms
    });
  }

  return candidates;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
}
