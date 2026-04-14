/**
 * Static HTML report renderer.
 *
 * Produces a self-contained HTML document (inline CSS, no JavaScript, no
 * external assets) describing the current cycle's recommendations, roll
 * alerts, income summary, and data provenance.
 *
 * The renderer reads the engine's Recommendation type but does NOT depend
 * on any engine internals. Input types for IncomeSummary and DataProvenance
 * are defined here so the renderer stays self-contained and can be tested
 * in isolation.
 */

import type {
  Recommendation,
  RollRecommendation,
  SellCashSecuredPutRecommendation,
  SellCoveredCallRecommendation,
} from '../../types/recommendations.js';

// ---------------------------------------------------------------------------
// Renderer-local types
// ---------------------------------------------------------------------------

export type ReportMode = 'demo' | 'real';

export interface IncomeSummary {
  /** Premium captured from closed trades (realized). */
  readonly captured: number;
  /** Open premium at risk (collected, not yet realized). */
  readonly atRisk: number;
  /** Projected covered-call premium if all primary picks are taken. */
  readonly projectedCC: number;
  /** Projected cash-secured put premium if all primary picks are taken. */
  readonly projectedCSP: number;
  /** atRisk + projectedCC + projectedCSP + captured summary shown in UI. */
  readonly total: number;
}

export interface DataProvenance {
  readonly symbol: string;
  /** Classification of where this symbol's data came from. */
  readonly source: 'polygon' | 'fallback' | 'mock';
  /** Optional human-readable note (e.g. "no price from Polygon — used market.json"). */
  readonly note?: string;
}

export interface HtmlReportInput {
  readonly generatedAt: Date;
  readonly mode: ReportMode;
  readonly recommendations: readonly Recommendation[];
  readonly rollAlerts: readonly Recommendation[];
  readonly incomeSummary: IncomeSummary;
  /** Real mode only. Omit for demo. */
  readonly provenance?: readonly DataProvenance[];
}

// ---------------------------------------------------------------------------
// Safe formatting helpers
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe interpolation into HTML text content or
 * attribute values. Covers the five characters that matter: &, <, >, ", '.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const USD_CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PCT_1 = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const PCT_2 = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PCT_0 = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function fmtMoney(n: number): string {
  return USD.format(n);
}
function fmtMoneyCents(n: number): string {
  return USD_CENTS.format(n);
}
function fmtPct1(n: number): string {
  return PCT_1.format(n);
}
function fmtPct2(n: number): string {
  return PCT_2.format(n);
}
function fmtPct0(n: number): string {
  return PCT_0.format(n);
}

function fmtDateTime(d: Date): string {
  const datePart = d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  // Timezone abbreviation via Intl.
  const tz =
    new Intl.DateTimeFormat('en-US', {
      timeZoneName: 'short',
    })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  return tz ? `${datePart} ${tz}` : datePart;
}

// ---------------------------------------------------------------------------
// Top-level renderer
// ---------------------------------------------------------------------------

export function renderHtmlReport(input: HtmlReportInput): string {
  const {
    generatedAt,
    mode,
    recommendations,
    rollAlerts,
    incomeSummary,
    provenance,
  } = input;

  const titleDate = escapeHtml(
    generatedAt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }),
  );

  const body = [
    renderHeader(generatedAt, mode),
    renderNextCycle(recommendations),
    renderRollAlerts(rollAlerts),
    renderIncomeSummary(incomeSummary),
    mode === 'real' ? renderProvenance(provenance ?? []) : '',
    renderFooter(),
  ].join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ratchet Report — ${titleDate}</title>
<style>${INLINE_CSS}</style>
</head>
<body>
<main class="wrap">
${body}
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Section: header
// ---------------------------------------------------------------------------

function renderHeader(generatedAt: Date, mode: ReportMode): string {
  const badge =
    mode === 'real'
      ? `<span class="badge badge-real">LIVE</span>`
      : `<span class="badge badge-demo">DEMO</span>`;
  return `
<header class="hdr">
  <h1>Ratchet Report</h1>
  <div class="hdr-meta">
    ${badge}
    <span class="timestamp">Generated ${escapeHtml(fmtDateTime(generatedAt))}</span>
  </div>
</header>`;
}

// ---------------------------------------------------------------------------
// Section: Next Cycle Setup
// ---------------------------------------------------------------------------

function renderNextCycle(recs: readonly Recommendation[]): string {
  // Only CC/CSP are relevant here. Roll/Hold/Close are handled elsewhere.
  const relevant = recs.filter(
    (r): r is SellCoveredCallRecommendation | SellCashSecuredPutRecommendation =>
      r.action === 'SELL_CC' || r.action === 'SELL_CSP',
  );
  const sorted = [...relevant].sort(
    (a, b) => b.annualizedYield - a.annualizedYield,
  );

  if (sorted.length === 0) {
    return section(
      'Next Cycle Setup',
      `<p class="empty">No recommendations matched current filters.</p>`,
    );
  }

  const rows = sorted
    .map((r) => renderRecRow(r))
    .join('\n');

  return section(
    'Next Cycle Setup',
    `<div class="table-scroll">
<table class="recs">
  <thead>
    <tr>
      <th>Symbol</th>
      <th>Action</th>
      <th>Strike</th>
      <th>Exp</th>
      <th>DTE</th>
      <th>Qty</th>
      <th>Prem/c</th>
      <th>Total</th>
      <th>Cycle %</th>
      <th class="hl-yield">Ann %</th>
      <th>P(asgn)</th>
      <th>Style</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
</div>`,
  );
}

function renderRecRow(
  r: SellCoveredCallRecommendation | SellCashSecuredPutRecommendation,
): string {
  const actionText = r.action === 'SELL_CC' ? 'Sell CC' : 'Sell CSP';
  const cappedBadge = r.positionCapped
    ? ` <span class="tag tag-cap" title="Capped by maxContractsPerTicker">CAP</span>`
    : '';
  const warningBadge =
    r.warnings.length > 0
      ? ` <span class="tag tag-warn" title="${escapeHtml(r.warnings.join(' • '))}">⚠︎</span>`
      : '';

  return `<tr>
  <td class="sym"><strong>${escapeHtml(r.symbol)}</strong>${warningBadge}${cappedBadge}</td>
  <td>${escapeHtml(actionText)}</td>
  <td class="num">${fmtMoneyCents(r.contract.strike)}</td>
  <td>${escapeHtml(r.expiration)}</td>
  <td class="num">${r.contract.dte}</td>
  <td class="num">${r.contractsAvailable}</td>
  <td class="num">${fmtMoney(r.premium)}</td>
  <td class="num">${fmtMoney(r.totalPremium)}</td>
  <td class="num">${fmtPct2(r.cycleYield)}</td>
  <td class="num hl-yield">${fmtPct1(r.annualizedYield)}</td>
  <td class="num">${fmtPct0(r.assignmentProb)}</td>
  <td><span class="style style-${escapeHtml(r.styleTag.toLowerCase())}">${escapeHtml(r.styleTag)}</span></td>
</tr>`;
}

// ---------------------------------------------------------------------------
// Section: Roll Alerts
// ---------------------------------------------------------------------------

function renderRollAlerts(rolls: readonly Recommendation[]): string {
  const relevant = rolls.filter(
    (r): r is RollRecommendation => r.action === 'ROLL',
  );

  if (relevant.length === 0) {
    return section(
      'Roll Alerts',
      `<p class="empty">No positions are hitting roll triggers.</p>`,
    );
  }

  const blocks = relevant
    .map((r) => {
      const triggerList = r.triggers
        .map(
          (t) =>
            `<li><span class="tag tag-trig">${escapeHtml(t.label)}</span> ${escapeHtml(t.message)}</li>`,
        )
        .join('\n      ');
      return `<article class="roll">
  <h3>${escapeHtml(r.symbol)} <small>${escapeHtml(r.relatedPositionId)}</small></h3>
  <p class="roll-action">
    Roll to <strong>${fmtMoneyCents(r.contract.strike)}</strong>
    on <strong>${escapeHtml(r.expiration)}</strong>
    (${r.contract.dte}d) for
    <strong class="pos">${fmtMoney(r.netCredit)}</strong> net credit.
  </p>
  <details open>
    <summary>Triggers (${relevant.length === 1 ? r.triggers.length : r.triggers.length} fired)</summary>
    <ul>
      ${triggerList}
    </ul>
  </details>
</article>`;
    })
    .join('\n');

  return section('Roll Alerts', blocks);
}

// ---------------------------------------------------------------------------
// Section: Income Summary
// ---------------------------------------------------------------------------

function renderIncomeSummary(s: IncomeSummary): string {
  return section(
    'Income Summary',
    `<div class="table-scroll">
<table class="summary">
  <tbody>
    <tr><th>Premium captured (closed trades)</th><td class="num pos">${fmtMoney(s.captured)}</td></tr>
    <tr><th>Open premium at risk</th><td class="num">${fmtMoney(s.atRisk)}</td></tr>
    <tr><th>Projected CC income (primary picks)</th><td class="num">${fmtMoney(s.projectedCC)}</td></tr>
    <tr><th>Projected CSP income (primary picks)</th><td class="num">${fmtMoney(s.projectedCSP)}</td></tr>
    <tr class="total"><th>Total projected this cycle</th><td class="num pos">${fmtMoney(s.total)}</td></tr>
  </tbody>
</table>
</div>`,
  );
}

// ---------------------------------------------------------------------------
// Section: Data Provenance (real mode only)
// ---------------------------------------------------------------------------

function renderProvenance(entries: readonly DataProvenance[]): string {
  if (entries.length === 0) {
    return section(
      'Data Provenance',
      `<p class="empty">No provenance data available.</p>`,
    );
  }

  const counts = {
    polygon: entries.filter((e) => e.source === 'polygon').length,
    fallback: entries.filter((e) => e.source === 'fallback').length,
    mock: entries.filter((e) => e.source === 'mock').length,
  };

  const rows = entries
    .map(
      (e) => `<tr>
  <td><strong>${escapeHtml(e.symbol)}</strong></td>
  <td><span class="src src-${escapeHtml(e.source)}">${escapeHtml(e.source)}</span></td>
  <td class="note">${escapeHtml(e.note ?? '')}</td>
</tr>`,
    )
    .join('\n');

  const summary = `<p class="prov-summary">
  ${counts.polygon} from Polygon,
  ${counts.fallback} fallback,
  ${counts.mock} mock.
</p>`;

  return section(
    'Data Provenance',
    `${summary}
<div class="table-scroll">
<table class="provenance">
  <thead>
    <tr><th>Symbol</th><th>Source</th><th>Note</th></tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
</div>`,
  );
}

// ---------------------------------------------------------------------------
// Section: Footer
// ---------------------------------------------------------------------------

function renderFooter(): string {
  return `
<footer class="ftr">
  <p>
    This report is decision support, not trading advice. Every strike,
    premium, and delta must be verified against your broker before any
    order is placed. Market data may be delayed or stale.
  </p>
</footer>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function section(title: string, body: string): string {
  return `
<section>
  <h2>${escapeHtml(title)}</h2>
  ${body}
</section>`;
}

// ---------------------------------------------------------------------------
// CSS (inlined, no external deps)
// ---------------------------------------------------------------------------

const INLINE_CSS = `
  :root {
    --bg: #fafafa;
    --fg: #1a1a1a;
    --muted: #666;
    --border: #e1e1e1;
    --surface: #ffffff;
    --pos: #14863a;
    --neg: #b32a2a;
    --warn: #a06b00;
    --amber: #fff5d6;
    --amber-b: #e6c664;
    --green-soft: #e8f4ec;
    --gray-soft: #f0f0f0;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Oxygen, Ubuntu, Cantarell, "Helvetica Neue", Arial, sans-serif;
    font-size: 15px;
    line-height: 1.45;
  }
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 20px 16px 40px;
  }
  h1 { font-size: 22px; margin: 0; }
  h2 {
    font-size: 17px;
    margin: 28px 0 10px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 6px;
  }
  h3 { font-size: 15px; margin: 10px 0 4px; }
  small { color: var(--muted); font-weight: normal; }
  p { margin: 8px 0; }
  section { margin: 16px 0; }
  .hdr {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 12px;
    border-bottom: 2px solid var(--border);
  }
  .hdr-meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .timestamp { color: var(--muted); font-size: 13px; }
  .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .badge-demo {
    background: var(--gray-soft);
    color: var(--muted);
    border: 1px solid var(--border);
  }
  .badge-real {
    background: var(--green-soft);
    color: var(--pos);
    border: 1px solid var(--pos);
  }
  .table-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  thead th {
    text-align: left;
    font-weight: 600;
    padding: 8px 10px;
    background: var(--gray-soft);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  tbody td, tbody th {
    padding: 7px 10px;
    border-top: 1px solid var(--border);
    white-space: nowrap;
  }
  tbody th {
    text-align: left;
    font-weight: normal;
  }
  tbody tr:hover { background: #fcfcfc; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pos { color: var(--pos); }
  .neg { color: var(--neg); }
  .hl-yield { font-weight: 600; }
  .sym { font-variant-numeric: tabular-nums; }
  .empty {
    color: var(--muted);
    font-style: italic;
    padding: 12px;
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: 4px;
  }
  .style {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 8px;
    font-size: 12px;
    border: 1px solid var(--border);
  }
  .style-safer { background: #eef6ff; color: #1a5eb3; border-color: #b8d6f5; }
  .style-balanced { background: #f4f0e6; color: #665200; border-color: #d8c77f; }
  .style-income { background: #fff0e8; color: #8a3300; border-color: #e8b894; }
  .tag {
    display: inline-block;
    padding: 0 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
    vertical-align: middle;
  }
  .tag-cap { background: var(--gray-soft); color: var(--muted); border: 1px solid var(--border); }
  .tag-warn { background: var(--amber); color: var(--warn); border: 1px solid var(--amber-b); }
  .tag-trig { background: #fff; color: var(--warn); border: 1px solid var(--amber-b); margin-right: 4px; }
  .roll {
    background: var(--surface);
    border: 1px solid var(--amber-b);
    border-left: 4px solid var(--amber-b);
    border-radius: 4px;
    padding: 10px 14px;
    margin-bottom: 10px;
  }
  .roll h3 { margin-top: 0; }
  .roll ul { margin: 6px 0 0; padding-left: 18px; }
  .roll li { margin: 4px 0; }
  .roll-action { margin: 2px 0 4px; }
  details summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 13px;
    margin-top: 6px;
  }
  table.summary tr.total th,
  table.summary tr.total td {
    font-weight: 600;
    border-top: 2px solid var(--border);
  }
  .prov-summary {
    color: var(--muted);
    font-size: 13px;
    margin-bottom: 8px;
  }
  .src {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .src-polygon { background: var(--green-soft); color: var(--pos); }
  .src-fallback { background: var(--amber); color: var(--warn); }
  .src-mock { background: var(--gray-soft); color: var(--muted); }
  .note { color: var(--muted); font-size: 13px; white-space: normal; }
  .ftr {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
  }
  @media (max-width: 640px) {
    .wrap { padding: 12px 10px 30px; }
    h1 { font-size: 20px; }
    table { font-size: 13px; }
    thead th, tbody td, tbody th { padding: 6px 8px; }
  }
`;
