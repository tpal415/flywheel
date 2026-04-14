import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  renderHtmlReport,
  type DataProvenance,
  type IncomeSummary,
  type HtmlReportInput,
} from '../src/cli/renderers/html.js';
import type {
  Recommendation,
  SellCoveredCallRecommendation,
  RollRecommendation,
} from '../src/types/recommendations.js';
import type { OptionContract } from '../src/types/chains.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function contract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    strike: 100,
    bid: 1.0,
    ask: 1.2,
    mid: 1.1,
    delta: 0.25,
    iv: 0.4,
    openInterest: 500,
    dte: 30,
    ...overrides,
  };
}

function cc(
  overrides: Partial<SellCoveredCallRecommendation> = {},
): SellCoveredCallRecommendation {
  return {
    symbol: 'TEST',
    action: 'SELL_CC',
    contract: contract(),
    expiration: '2026-05-15',
    currentPrice: 90,
    contractsAvailable: 2,
    premium: 110,
    totalPremium: 220,
    cycleYield: 0.012,
    upsidePct: 0.11,
    annualizedYield: 0.15,
    assignmentProb: 0.25,
    score: 0.45,
    styleTag: 'Balanced',
    rationale: ['Sample rationale line.'],
    warnings: [],
    positionCapped: false,
    ...overrides,
  };
}

function roll(
  overrides: Partial<RollRecommendation> = {},
): RollRecommendation {
  return {
    symbol: 'TSLA',
    action: 'ROLL',
    contract: contract({ strike: 225, delta: 0.5, dte: 45 }),
    expiration: '2026-05-23',
    currentPrice: 240,
    contractsAvailable: 1,
    premium: 1000,
    totalPremium: 1000,
    cycleYield: 0.04,
    upsidePct: -0.06,
    annualizedYield: 0.3,
    assignmentProb: 0.5,
    score: 0.4,
    styleTag: 'Income',
    rationale: ['Roll action line.'],
    warnings: [],
    positionCapped: false,
    relatedPositionId: 'opt-tsla-call-225-0415',
    netCredit: 500,
    triggers: [
      { label: 'DELTA', message: '|delta| 0.81 >= threshold 0.50' },
    ],
    ...overrides,
  };
}

const EMPTY_SUMMARY: IncomeSummary = {
  captured: 0,
  atRisk: 0,
  projectedCC: 0,
  projectedCSP: 0,
  total: 0,
};

function baseInput(
  over: Partial<HtmlReportInput> = {},
): HtmlReportInput {
  return {
    generatedAt: new Date('2026-04-10T14:30:00Z'),
    mode: 'demo',
    recommendations: [],
    rollAlerts: [],
    incomeSummary: EMPTY_SUMMARY,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('leaves safe text untouched', () => {
    expect(escapeHtml('TSLA')).toBe('TSLA');
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  it('handles the order correctly (& must be first)', () => {
    // If we escaped & after <, we would produce &amp;lt; instead of &lt;.
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
  });
});

// ---------------------------------------------------------------------------
// Document structure
// ---------------------------------------------------------------------------

describe('renderHtmlReport — document structure', () => {
  it('starts with <!doctype html>', () => {
    const html = renderHtmlReport(baseInput());
    expect(html.toLowerCase().startsWith('<!doctype html>')).toBe(true);
  });

  it('includes viewport meta for mobile', () => {
    const html = renderHtmlReport(baseInput());
    expect(html).toContain('name="viewport"');
  });

  it('inlines all CSS (no external stylesheets)', () => {
    const html = renderHtmlReport(baseInput());
    expect(html).toContain('<style>');
    // No <link rel="stylesheet">
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    // No external <script src=>
    expect(html).not.toMatch(/<script\b[^>]*\bsrc=/i);
  });

  it('contains each top-level section heading', () => {
    const html = renderHtmlReport(baseInput());
    expect(html).toContain('Ratchet Report');
    expect(html).toContain('Next Cycle Setup');
    expect(html).toContain('Roll Alerts');
    expect(html).toContain('Income Summary');
  });

  it('footer includes disclaimer', () => {
    const html = renderHtmlReport(baseInput());
    expect(html).toContain('decision support');
  });
});

// ---------------------------------------------------------------------------
// Escaping of untrusted values
// ---------------------------------------------------------------------------

describe('renderHtmlReport — escaping', () => {
  it('escapes a malicious symbol like <script>', () => {
    const html = renderHtmlReport(
      baseInput({
        recommendations: [cc({ symbol: '<script>alert(1)</script>' })],
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes rationale text with HTML chars', () => {
    const html = renderHtmlReport(
      baseInput({
        rollAlerts: [
          roll({
            triggers: [
              {
                label: 'DELTA',
                message: '|delta| > 0.5 & "high"',
              },
            ],
          }),
        ],
      }),
    );
    // The message should appear escaped, not raw.
    expect(html).not.toContain('|delta| > 0.5 & "high"');
    expect(html).toContain('&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('escapes warning text embedded in title attributes', () => {
    const html = renderHtmlReport(
      baseInput({
        recommendations: [
          cc({ warnings: ['Wide spread: "1.00"/"1.50"'] }),
        ],
      }),
    );
    // Unescaped double-quote inside title="..." would break the attribute.
    expect(html).not.toContain('title="Wide spread: "1.00"/"1.50""');
    expect(html).toContain('&quot;');
  });
});

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------

describe('renderHtmlReport — empty states', () => {
  it('empty recommendations renders empty state, not a broken table', () => {
    const html = renderHtmlReport(baseInput({ recommendations: [] }));
    expect(html).toContain('No recommendations matched');
    // Should not have a rec row (just headers).
    expect(html).not.toMatch(/<td class="sym">/);
  });

  it('empty roll alerts renders empty state', () => {
    const html = renderHtmlReport(baseInput({ rollAlerts: [] }));
    expect(html).toContain('No positions are hitting roll triggers');
  });
});

// ---------------------------------------------------------------------------
// Provenance (real mode only)
// ---------------------------------------------------------------------------

describe('renderHtmlReport — provenance', () => {
  it('omits provenance section in demo mode', () => {
    const html = renderHtmlReport(baseInput({ mode: 'demo' }));
    expect(html).not.toContain('Data Provenance');
  });

  it('includes provenance section in real mode', () => {
    const prov: DataProvenance[] = [
      { symbol: 'TSLA', source: 'polygon' },
      { symbol: 'MSFT', source: 'fallback', note: 'no chain' },
    ];
    const html = renderHtmlReport(
      baseInput({ mode: 'real', provenance: prov }),
    );
    expect(html).toContain('Data Provenance');
    expect(html).toContain('TSLA');
    expect(html).toContain('MSFT');
    expect(html).toContain('polygon');
    expect(html).toContain('fallback');
  });

  it('real mode with no provenance entries still shows section', () => {
    const html = renderHtmlReport(
      baseInput({ mode: 'real', provenance: [] }),
    );
    expect(html).toContain('Data Provenance');
    expect(html).toContain('No provenance data available.');
  });
});

// ---------------------------------------------------------------------------
// Content rendering
// ---------------------------------------------------------------------------

describe('renderHtmlReport — content', () => {
  it('renders a CC row with strike, expiration, yield', () => {
    const rec = cc({
      symbol: 'TSLA',
      contract: contract({ strike: 297.5, dte: 45 }),
      expiration: '2026-05-23',
      annualizedYield: 0.103,
      premium: 305,
    });
    const html = renderHtmlReport(
      baseInput({ recommendations: [rec as Recommendation] }),
    );
    expect(html).toContain('TSLA');
    expect(html).toContain('$297.50');
    expect(html).toContain('2026-05-23');
    expect(html).toContain('10.3%');
    expect(html).toContain('$305');
  });

  it('shows CAP tag when positionCapped is true', () => {
    const rec = cc({ positionCapped: true, contractsAvailable: 20 });
    const html = renderHtmlReport(
      baseInput({ recommendations: [rec as Recommendation] }),
    );
    expect(html).toContain('tag-cap');
    expect(html).toContain('CAP');
  });

  it('shows warning marker when warnings exist', () => {
    const rec = cc({ warnings: ['Wide spread: 15% of mid'] });
    const html = renderHtmlReport(
      baseInput({ recommendations: [rec as Recommendation] }),
    );
    expect(html).toContain('tag-warn');
    // Warning text appears in title attribute.
    expect(html).toContain('Wide spread');
  });

  it('renders roll alert with triggers', () => {
    const r = roll();
    const html = renderHtmlReport(
      baseInput({ rollAlerts: [r as Recommendation] }),
    );
    expect(html).toContain('opt-tsla-call-225-0415');
    expect(html).toContain('DELTA');
    expect(html).toContain('$500');
  });

  it('income summary shows all five lines', () => {
    const summary: IncomeSummary = {
      captured: 1400,
      atRisk: 420,
      projectedCC: 2681,
      projectedCSP: 374,
      total: 3055,
    };
    const html = renderHtmlReport(baseInput({ incomeSummary: summary }));
    expect(html).toContain('$1,400');
    expect(html).toContain('$420');
    expect(html).toContain('$2,681');
    expect(html).toContain('$374');
    expect(html).toContain('$3,055');
  });

  it('header badge reflects mode', () => {
    const demoHtml = renderHtmlReport(baseInput({ mode: 'demo' }));
    expect(demoHtml).toContain('badge-demo');
    expect(demoHtml).toContain('DEMO');

    const realHtml = renderHtmlReport(
      baseInput({ mode: 'real', provenance: [] }),
    );
    expect(realHtml).toContain('badge-real');
    expect(realHtml).toContain('LIVE');
  });
});

// ---------------------------------------------------------------------------
// File size sanity check
// ---------------------------------------------------------------------------

describe('renderHtmlReport — file size', () => {
  it('typical report stays under 100 KB', () => {
    // Build a realistic report with 8 symbols, 2 recs each.
    const recs: Recommendation[] = [];
    const symbols = ['TSLA', 'MSFT', 'PLTR', 'IREN', 'OPEN', 'NVDA', 'AMD', 'GOOGL'];
    for (const sym of symbols) {
      recs.push(cc({ symbol: sym }) as Recommendation);
      recs.push(cc({ symbol: sym, contract: contract({ strike: 110 }) }) as Recommendation);
    }
    const html = renderHtmlReport(
      baseInput({
        recommendations: recs,
        rollAlerts: [roll() as Recommendation],
      }),
    );
    const bytes = Buffer.byteLength(html, 'utf-8');
    expect(bytes).toBeLessThan(100_000);
  });
});
