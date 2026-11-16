// Token Radar's model (radar-2): what a pre-token protocol's launch could be worth.
//
// The model reads only the sealed snapshot. For every category it takes the median
// market-cap/TVL ratio of the token-bearing protocols in that category (at least three
// of them, and a median inside the sane band [0.02, 1.00]); anything else falls back to
// the snapshot's global median, the median ratio of the fully observed token-bearing
// protocols. A protocol's implied value is its TVL times that category multiple, times
// a growth multiplier from its seven-day TVL change, a maturity multiplier from how
// long it has run with no token on record, and a chain multiplier from how many chains
// it lives on. Nothing here names a protocol: the same function scores every row, so
// running it on a future snapshot finds future launches early.
//
// A protocol is rankable when the snapshot records no token for it (both its gecko_id
// and its symbol are null) and it is not a wrapped, staked or bridged product, not a
// bridge, staking or exchange product by category, not named after an exchange, and
// not carrying a version marker in its name. Protocols whose token already trades are
// set aside, live, with their market caps shown. The snapshot's record is not proof,
// so the board always says a protocol "records no token", never that it has none.

/** One protocol exactly as the snapshot carries it (ten fields, sorted by slug). */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot: its date, its floor, its protocols and its watchlist. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One ranked board row: the gate's fields plus the model's whole breakdown. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  category_multiple: number;
  growth_mult: number;
  maturity_mult: number;
  chain_mult: number;
  watchlist: boolean;
}

/** One protocol whose token already trades, set aside from the board. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  age_days: number | null;
}

/** One derived category multiple, with how many token protocols it rests on. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  token_count: number;
  fallback: boolean;
}

/** Everything the dashboard needs, built from the snapshot alone. */
export interface Radar {
  model: string;
  as_of: string;
  floor_usd: number;
  total_protocols: number;
  watchlist_total: number;
  watchlist_covered: number;
  early_size: number;
  live_size: number;
  early_below_floor: number;
  global_multiple: number;
  multiples: CategoryMultiple[];
  rows: BoardRow[];
  live: LiveRow[];
}

/** Categories that are a wrapped, staked or bridged product by definition. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names: a protocol named after one is that exchange's product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word that marks a wrapped or staked product of a trading token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A version marker at the end of a name: a space, then V2, v3, 2.0 or the like. */
const VERSION_MARKER = /\s(?:[Vv]\d+|\d+\.\d+)\s*$/;

/** The middle value of a sorted copy; NaN when the list is empty. */
function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Days from `listedAt` (a UTC day) to the snapshot's date, or null when unlisted. */
function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000);
}

/** True when the snapshot records no token for this protocol at all. */
function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** True when the protocol is none of the products the radar refuses to rank. */
function isClean(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `))) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  return true;
}

/** True when the protocol belongs on the board: pre-token, and clean. */
function isRankable(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && isClean(p);
}

/**
 * Parse and lightly validate the snapshot text. Anything malformed is refused with
 * a plain message; a protocol missing a field it must carry is refused too.
 */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('token radar: the snapshot is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('token radar: the snapshot is not an object');
  }
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) {
    throw new Error('token radar: the snapshot holds no protocols or watchlist array');
  }
  const protocols: SnapshotProtocol[] = o.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`token radar: protocol ${i} is not an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.slug !== 'string' || typeof e.name !== 'string') {
      throw new Error(`token radar: protocol ${i} has no slug or name`);
    }
    if (typeof e.tvl_usd !== 'number' || !Number.isFinite(e.tvl_usd)) {
      throw new Error(`token radar: protocol ${e.slug} has no TVL`);
    }
    return {
      slug: e.slug,
      name: e.name,
      category: typeof e.category === 'string' ? e.category : null,
      chains: Array.isArray(e.chains) ? e.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: e.tvl_usd,
      change_7d: typeof e.change_7d === 'number' ? e.change_7d : null,
      mcap_usd: typeof e.mcap_usd === 'number' ? e.mcap_usd : null,
      listed_at: typeof e.listed_at === 'string' ? e.listed_at : null,
      gecko_id: typeof e.gecko_id === 'string' ? e.gecko_id : null,
      symbol: typeof e.symbol === 'string' ? e.symbol : null,
    };
  });
  return {
    as_of: typeof o.as_of === 'string' ? o.as_of : '',
    source: typeof o.source === 'string' ? o.source : '',
    floor_usd: typeof o.floor_usd === 'number' ? o.floor_usd : 50_000_000,
    protocols,
    watchlist: o.watchlist.filter((w): w is string => typeof w === 'string'),
  };
}

// ---------------------------------------------------------------- the value model

/**
 * The snapshot's global multiple: the median market-cap/TVL ratio of the token-bearing
 * protocols that are clean and fully observed (a listing date on record). When the
 * snapshot carries no such protocol, the median over every token-bearing protocol is
 * used instead; only a snapshot with no token-bearing protocol at all falls back to
 * the band's centre, 0.214x, which this snapshot never needs.
 */
function globalMultiple(snapshot: Snapshot): number {
  const observed = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.tvl_usd > 0 && isClean(p) && p.listed_at !== null,
  );
  const ratios = observed.map((p) => p.mcap_usd! / p.tvl_usd);
  const first = median(ratios);
  if (Number.isFinite(first)) return first;
  const any = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd);
  const second = median(any);
  return Number.isFinite(second) ? second : 0.214;
}

/**
 * One multiple per category the board uses. A category keeps its own median when at
 * least three of its protocols trade a token and that median sits inside the sane
 * band [0.02, 1.00]; a median outside the band is not a multiple at all (a token
 * worth a hundredth of its TVL, or more than its TVL, says the category has no
 * comparable yet), so the category falls back to the global multiple like a thin one.
 */
function categoryMultiples(snapshot: Snapshot, global: number, used: Set<string>): CategoryMultiple[] {
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.category === null) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(p.mcap_usd / p.tvl_usd);
    byCategory.set(p.category, list);
  }
  const out: CategoryMultiple[] = [];
  for (const category of [...used].sort()) {
    const ratios = byCategory.get(category) ?? [];
    let multiple = global;
    let fallback = true;
    if (ratios.length >= 3) {
      const m = median(ratios);
      if (m >= 0.02 && m <= 1.0) {
        multiple = m;
        fallback = false;
      }
    }
    out.push({ category, multiple, token_count: ratios.length, fallback });
  }
  return out;
}

/** Growth: half the seven-day TVL change, the change clamped to [-60%, +120%]. */
function growthMultiplier(change7d: number | null): number {
  const frac = change7d === null ? 0 : change7d / 100;
  const clamped = Math.max(-0.6, Math.min(1.2, frac));
  return 1 + 0.5 * clamped;
}

/** Maturity: 0.6 for a protocol listed yesterday, 1.0 once it is three years old. */
function maturityMultiplier(age: number | null): number {
  const days = age === null ? 0 : age;
  return 0.6 + (0.4 * Math.min(days, 1095)) / 1095;
}

/** Chains: 4% per chain past the first, capped at 1.16. */
function chainMultiplier(chainCount: number): number {
  const n = Math.max(1, chainCount);
  return Math.min(1 + 0.04 * (n - 1), 1.16);
}

/** One protocol's implied value and the multipliers behind it. */
function scoreProtocol(
  p: SnapshotProtocol,
  multiple: number,
  asOf: string,
): { value: number; growth: number; maturity: number; chain: number; age: number | null } {
  const age = ageDays(p.listed_at, asOf);
  const growth = growthMultiplier(p.change_7d);
  const maturity = maturityMultiplier(age);
  const chain = chainMultiplier(p.chains.length);
  const value = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity * chain));
  return { value, growth, maturity, chain, age };
}

/**
 * Score every rankable protocol, rank them by implied value (ties broken by slug, so
 * the order is deterministic), and set aside the token-bearing protocols that pass
 * the same cleanliness checks at or above the watchlist floor, livest market cap first.
 */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const global = globalMultiple(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const boardCategories = new Set<string>();
  for (const p of snapshot.protocols) {
    if (isRankable(p) && p.category !== null) boardCategories.add(p.category);
  }
  const multiples = categoryMultiples(snapshot, global, boardCategories);
  const multipleOf = new Map(multiples.map((m) => [m.category, m.multiple]));

  const rows: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const multiple = p.category === null ? global : (multipleOf.get(p.category) ?? global);
    const scored = scoreProtocol(p, multiple, snapshot.as_of);
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: scored.value,
      farm_steps: buildFarmSteps(p, scored.age),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: scored.age,
      category_multiple: multiple,
      growth_mult: scored.growth,
      maturity_mult: scored.maturity,
      chain_mult: scored.chain,
      watchlist: watchlist.has(p.slug),
    });
  }
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((row, i) => {
    row.rank = i + 1;
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && isClean(p) && p.tvl_usd >= snapshot.floor_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      age_days: ageDays(p.listed_at, snapshot.as_of),
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  const radar: Radar = {
    model: 'radar-2',
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    total_protocols: snapshot.protocols.length,
    watchlist_total: snapshot.watchlist.length,
    watchlist_covered: rows.filter((r) => r.watchlist).length,
    early_size: rows.length,
    live_size: live.length,
    early_below_floor: rows.filter((r) => !r.watchlist && r.tvl_usd < snapshot.floor_usd).length,
    global_multiple: global,
    multiples,
    rows,
    live,
  };
  return { board: rows, radar };
}

// ---------------------------------------------------------------- the farm plan

/** What a farm step costs to run, by the protocol's size: bigger TVL, bigger ticket. */
function capitalTier(tvlUsd: number): { amount: string; half: string } {
  if (tvlUsd >= 1_000_000_000) return { amount: '$150', half: '$75' };
  if (tvlUsd >= 100_000_000) return { amount: '$100', half: '$50' };
  if (tvlUsd >= 50_000_000) return { amount: '$75', half: '$40' };
  return { amount: '$50', half: '$25' };
}

/** Fill a step template's {name}, {chain}, {amount} and {half} slots. */
function fill(template: string, vars: { name: string; chain: string; amount: string; half: string }): string {
  return template
    .replaceAll('{name}', vars.name)
    .replaceAll('{chain}', vars.chain)
    .replaceAll('{amount}', vars.amount)
    .replaceAll('{half}', vars.half);
}

/**
 * The category's two characteristic actions, each a concrete thing to do on a chain.
 * The templates name no protocol: they take the row's own name, chain and ticket size.
 */
const CATEGORY_ACTIONS: Record<string, [string, string]> = {
  'Anchor BTC': [
    'Lock {amount} of BTC through {name} on {chain} and hold the receipt token in the farming wallet.',
    'Lock {half} of BTC through a second {name} vault on {chain}.',
  ],
  'Basis Trading': [
    'Deposit {amount} into {name} on {chain} and hold the delta-neutral position it issues.',
    'Add {half} to a second {name} position on {chain}.',
  ],
  CDP: [
    'Open a {name} vault on {chain} with {amount} of collateral and mint a small amount of its stablecoin.',
    'Open a second {name} vault on {chain} with {half} of collateral in a different asset.',
  ],
  'CDP Manager': [
    'Deposit {amount} of collateral into a {name} vault on {chain} and manage the position weekly.',
    'Open a second {name} vault on {chain} with {half} of collateral.',
  ],
  CeDeFi: [
    'Deposit {amount} into {name} on {chain} and keep the position open for the full month.',
    'Deposit {half} into a second {name} product on {chain}.',
  ],
  Chain: [
    'Bridge {amount} to {name} on its own chain and use it in one of its native apps.',
    'Use {half} in a second native app on {name} the following week.',
  ],
  'Collateral Markets': [
    'Supply {amount} of collateral to a {name} market on {chain} and borrow a small amount against it.',
    'Supply {half} to a second {name} market on {chain} in a different asset.',
  ],
  'Cross Chain Bridge': [
    'Bridge {amount} through {name} to {chain} and keep the funds there for the week.',
    'Bridge {half} back through {name} on a different route the following week.',
  ],
  'Crypto Card Issuer': [
    'Spend {amount} through a {name} card on {chain} for a real purchase and keep the receipt.',
    'Spend {half} through the {name} card on {chain} again the following week.',
  ],
  'Decentralized BTC': [
    'Lock {amount} of BTC through {name} on {chain} and hold the receipt token in the farming wallet.',
    'Lock {half} of BTC through a second {name} vault on {chain}.',
  ],
  Derivatives: [
    'Open a {amount} hedged position on {name} on {chain} and hold it through the week.',
    'Open a second {name} position on {chain} in a different market with {half}.',
  ],
  Dexs: [
    'Swap {amount} through {name} on {chain} and add {half} of liquidity to its largest pool.',
    'Add {half} of liquidity to a second {name} pool on {chain} in a different pair.',
  ],
  'Dual-Token Stablecoin': [
    'Mint {amount} of the {name} stablecoin on {chain} and hold it in the farming wallet.',
    'Mint {half} of the second {name} token on {chain} the following week.',
  ],
  Farm: [
    'Deposit {amount} into a {name} farm on {chain} and stake the receipt.',
    'Deposit {half} into a second {name} farm on {chain}.',
  ],
  'Governance Incentives': [
    'Lock {amount} in {name} governance on {chain} and vote on the next live proposal.',
    'Lock {half} in a second {name} governance position on {chain}.',
  ],
  Indexes: [
    'Buy {amount} of a {name} index on {chain} and hold it.',
    'Buy {half} of a second {name} index on {chain}.',
  ],
  Insurance: [
    'Buy {amount} of cover through {name} on {chain} for a position you already hold.',
    'Buy {half} of cover for a second position through {name} on {chain}.',
  ],
  'Interest Rate Derivatives': [
    'Open a {amount} fixed-rate position through {name} on {chain} and hold it to maturity.',
    'Open a second {name} rate position of {half} on {chain} in a different tenor.',
  ],
  Lending: [
    'Supply {amount} to {name} on {chain} as collateral and borrow a small amount against it to show activity.',
    'Supply {half} to a second {name} market on {chain} in a different asset.',
  ],
  'Leveraged Farming': [
    'Open a {amount} leveraged position through {name} on {chain} at low leverage and check it daily.',
    'Open a second {name} leveraged position of {half} on {chain} in a different pair.',
  ],
  'Liquidity Manager': [
    'Deposit {amount} into a {name} managed pool on {chain} and keep the shares.',
    'Deposit {half} into a second {name} managed pool on {chain}.',
  ],
  'OTC Marketplace': [
    'Buy {amount} of an asset through {name} on {chain} in one settled trade and keep the receipt.',
    'Settle a second {name} trade of {half} on {chain} the following week.',
  ],
  'Onchain Capital Allocator': [
    'Deposit {amount} into a {name} vault on {chain} and keep the shares.',
    'Add a second deposit of {half} to a different {name} vault on {chain}.',
  ],
  Payments: [
    'Pay {amount} through {name} on {chain} for a real invoice and keep the receipt.',
    'Make a second {name} payment of {half} on {chain} the following week.',
  ],
  'Prediction Market': [
    'Place a {amount} position on a {name} market on {chain} that resolves after the snapshot window.',
    'Place a second {name} position of {half} on {chain} in a different market.',
  ],
  RWA: [
    'Buy {amount} of a tokenised asset through {name} on {chain} and hold it in the farming wallet.',
    'Buy {half} of a second tokenised asset through {name} on {chain}.',
  ],
  Restaking: [
    'Restake {amount} through {name} on {chain} and keep the receipt token in the farming wallet.',
    'Restake {half} through a second {name} pool on {chain}.',
  ],
  'Risk Curators': [
    'Deposit {amount} into a {name} vault on {chain} and keep the shares.',
    'Add a second deposit of {half} to a different {name} vault on {chain}.',
  ],
  'Stablecoin Wrapper': [
    'Wrap {amount} into the {name} stablecoin on {chain} and hold it in the farming wallet.',
    'Wrap {half} through {name} on {chain} again the following week.',
  ],
  'Staking Pool': [
    'Stake {amount} through {name} on {chain} and keep the receipt token in the farming wallet.',
    'Stake {half} through a second {name} pool on {chain}.',
  ],
  'Uncollateralized Lending': [
    'Lend {amount} through {name} on {chain} to a borrower pool and keep the receipt.',
    'Lend {half} through a second {name} borrower pool on {chain}.',
  ],
  Yield: [
    'Deposit {amount} into a {name} vault on {chain} and keep the shares.',
    'Deposit {half} into a second {name} vault on {chain} with a different strategy.',
  ],
  'Yield Aggregator': [
    'Deposit {amount} into a {name} vault on {chain} and let it route the yield.',
    'Deposit {half} into a second {name} vault on {chain} with a different strategy.',
  ],
};

/** The fallback pair for a category the table does not name. */
const DEFAULT_ACTIONS: [string, string] = [
  "Put {amount} to work in {name}'s main product on {chain} and keep the position open.",
  'Open a second {name} position on {chain} with {half} in a different market.',
];

/**
 * Eight concrete steps to farm one protocol: a fresh wallet, the category's two
 * characteristic actions, the same position on a second chain, holding the position,
 * watching the points trail, the claim warning, and keeping records. Every step names
 * what it costs and how long it takes; the plan never claims the protocol has no
 * token, only that the snapshot records none.
 */
function buildFarmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const tier = capitalTier(p.tvl_usd);
  const firstChain = p.chains[0] ?? 'Ethereum';
  const secondChain = p.chains[1] ?? null;
  const vars = { name: p.name, chain: firstChain, amount: tier.amount, half: tier.half };
  const [first, second] = p.category !== null ? (CATEGORY_ACTIONS[p.category] ?? DEFAULT_ACTIONS) : DEFAULT_ACTIONS;
  const ageText =
    age === null
      ? 'its whole tracked life'
      : age >= 365
        ? `${(age / 365).toFixed(1)} years`
        : `${age} days`;
  const chainStep =
    secondChain !== null
      ? `Repeat the position on ${secondChain} with ${tier.half}, so the wallet is active on two chains. Cost: ${tier.half} of capital and about $4 of gas. Time: 15 minutes to set up.`
      : `Open a second ${p.name} position on ${firstChain} in a different market with ${tier.half}. Cost: ${tier.half} of capital and about $4 of gas. Time: 15 minutes to set up.`;
  return [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    `${fill(first, vars)} Cost: ${tier.amount} of capital and about $8 of gas. Time: 15 minutes to set up.`,
    `${fill(second, vars)} Cost: ${tier.half} of capital and about $4 of gas. Time: 10 minutes.`,
    chainStep,
    'Leave the position open for at least four weeks and do not move the funds between wallets; steady positions are the ones snapshots reward. Cost: no new capital, about $2 of gas if you rebalance. Time: 5 minutes a week.',
    `Check ${p.name}'s points or rewards page every week and note any new campaign. The snapshot records no token for ${p.name} after ${ageText}, so points are the trail to watch. Cost: no gas. Time: 10 minutes a week.`,
    `If a token launches, claim only inside ${p.name}'s own app and check the contract address twice; never pay anyone to claim for you. Cost: only network gas, about $3. Time: 10 minutes when a claim opens.`,
    'Log every deposit, transaction hash and date in a sheet, with the wallet address on top, so you can prove each step later. Cost: nothing. Time: 5 minutes per deposit.',
  ];
}

// ---------------------------------------------------------------- the dashboard data

/**
 * The dashboard's data file: one assignment the page reads, the radar object as
 * JSON. The key order is fixed by construction and every list is sorted, so two
 * runs write the same bytes.
 */
export function dataScript(radar: Radar): string {
  return `window.TOKEN_RADAR = ${JSON.stringify(radar)};\n`;
}

// ---------------------------------------------------------------- the gate's own checks

/**
 * The board the gate refuses, in the gate's own words, or null when the board is
 * sound: 100 to 4,000 rows of the snapshot's own protocols, ranks exactly 1 to N,
 * implied values that do not rise as rank ascends and are not all the same, farm
 * plans of 3 to 12 steps of 20 to 600 characters, and every watchlist slug covered.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `the board holds ${board.length} rows, not 100 to 4,000`;
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = null;
  let allSame = true;
  let firstValue = null;
  // Rank order, not array order, decides whether values rise: a board is a claim
  // about ranks, and the gate reads it that way too.
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (const row of byRank) {
    if (typeof row.slug !== 'string' || row.slug.length === 0 || /\s/.test(row.slug)) {
      return `a row's slug is empty or holds whitespace`;
    }
    if (!known.has(row.slug)) return `row ${row.slug} names a protocol the snapshot does not hold`;
    if (seen.has(row.slug)) return `row ${row.slug} appears twice`;
    seen.add(row.slug);
    if (typeof row.name !== 'string' || row.name.length === 0) {
      return `row ${row.slug} has no name`;
    }
    if (!Number.isInteger(row.rank) || row.rank < 1 || row.rank > board.length) {
      return `row ${row.slug} has rank ${row.rank}, not 1 to ${board.length}`;
    }
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${row.slug} has implied value ${row.implied_value_usd}, not a positive whole number of dollars at most 100000000000000`;
    }
    if (firstValue === null) firstValue = row.implied_value_usd;
    else if (row.implied_value_usd !== firstValue) allSame = false;
    if (previous !== null && row.implied_value_usd > previous) {
      return `row ${row.slug} is worth more than the row ranked above it`;
    }
    previous = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} holds ${Array.isArray(row.farm_steps) ? row.farm_steps.length : 0} farm steps, not 3 to 12`;
    }
    for (const step of row.farm_steps) {
      if (typeof step !== 'string') return `row ${row.slug} holds a farm step that is not text`;
      const len = step.trim().length;
      if (len < 20 || len > 600) {
        return `row ${row.slug} holds a farm step of ${len} characters, not 20 to 600`;
      }
    }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `the ranks are not exactly 1 to ${board.length}`;
  }
  if (allSame) return 'every row carries the same implied value, so the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `the watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}
