import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, home, notify } from "herdr";

// draftcode/attentionset の github-attentionset-server が送るクエリと同じもの。
// herdr の exec には stdin が無いので、gh api graphql の -f で渡す。
const PR_FIELDS = `
fragment PRFields on PullRequest {
  id number title url isDraft state createdAt updatedAt baseRefName headRefName
  author { login }
  repository { nameWithOwner }
  reviewDecision
  reviewThreads(first: 50) { nodes { isResolved } }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
  latestReviews(first: 10) { nodes { author { login __typename } state createdAt } }
  timelineItems(first: 50, itemTypes: [PULL_REQUEST_REVIEW, REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT,
      ISSUE_COMMENT, HEAD_REF_FORCE_PUSHED_EVENT, PULL_REQUEST_COMMIT, READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT]) {
    nodes {
      __typename
      ... on PullRequestReview { author { login __typename } state createdAt }
      ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } ... on Team { slug } } }
      ... on ReviewRequestRemovedEvent { createdAt requestedReviewer { ... on User { login } ... on Team { slug } } }
      ... on IssueComment { author { login __typename } createdAt }
      ... on HeadRefForcePushedEvent { actor { login __typename } createdAt }
      ... on PullRequestCommit { commit { authoredDate } }
      ... on ReadyForReviewEvent { createdAt }
      ... on ConvertToDraftEvent { createdAt }
    }
  }
  commits(last: 1) {
    nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes {
      __typename
      ... on CheckRun { name status conclusion completedAt startedAt
        checkSuite { workflowRun { databaseId createdAt workflow { id } } } }
      ... on StatusContext { context state createdAt }
    } } } } }
  }
}`;

const OVERVIEW_QUERY = `query {
  rateLimit { limit cost remaining resetAt }
  viewer { login }
  authored: search(query: "is:pr is:open archived:false author:@me", type: ISSUE, first: 30) { nodes { ... on PullRequest { id updatedAt } } }
  reviewRequested: search(query: "is:pr is:open archived:false user-review-requested:@me", type: ISSUE, first: 30) { nodes { ... on PullRequest { id updatedAt } } }
  reviewed: search(query: "is:pr is:open archived:false reviewed-by:@me", type: ISSUE, first: 30) { nodes { ... on PullRequest { id updatedAt } } }
}`;

const DETAILS_QUERY = PR_FIELDS + `
query($ids: [ID!]!) {
  rateLimit { limit cost remaining resetAt }
  nodes(ids: $ids) { ... on PullRequest { ...PRFields } }
}`;

const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;

const SECTIONS = [
  { title: "My PRs — Needs Your Action", attention: true },
  { title: "Incoming — Needs Your Review", attention: true },
  { title: "My PRs — Approved", attention: true },
  { title: "My PRs — Waiting on Others", attention: false },
  { title: "Incoming — Not Your Turn", attention: false },
];

const SNOOZED_SECTION = { title: "Snoozed", attention: false };

const FAILED_CONCLUSIONS = ["FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED", "CANCELLED"];

// ---- attention set: attentionset の attention.go を移植 ----

const isBot = (user) => Boolean(user && user.__typename === "Bot");
const requestedId = (rr) => (rr ? rr.login || rr.slug || "" : "");
const eventTime = (e) => (e.__typename === "PullRequestCommit" ? e.commit?.authoredDate || "" : e.createdAt || "");

function reviewerLogins(pr, author) {
  const logins = new Set();
  for (const rr of pr.reviewRequests.nodes) {
    const id = requestedId(rr.requestedReviewer);
    if (id && id !== author) logins.add(id);
  }
  for (const r of pr.latestReviews.nodes) {
    if (r.author?.login && r.author.login !== author && !isBot(r.author)) logins.add(r.author.login);
  }
  return logins;
}

// 誰の番かの Map に、各人の番を最後に動かした時刻（flips）を添えたもの。
// 手動の切り替えは、この時刻より後に行ったものだけを有効にする（attentionset の attentionTracker と同じ）。
class AttentionSet extends Map {
  constructor() { super(); this.flips = {}; }
  set(login, entry) { this.flips[login] = entry.since; return super.set(login, entry); }
  delete(login, at = "") { if (at) this.flips[login] = at; return super.delete(login); }
  clear(at = "") { if (at) for (const login of this.keys()) this.flips[login] = at; super.clear(); }
}

function processEvent(e, author, reviewers, set) {
  const toReviewers = (reason, at) => { for (const r of reviewers) set.set(r, { reason, since: at }); };
  switch (e.__typename) {
    case "PullRequestReview": {
      const who = e.author?.login;
      if (!who || isBot(e.author)) return;
      if (who !== author) {
        set.delete(who, e.createdAt);
        const reason = { CHANGES_REQUESTED: `changes requested by ${who}`, COMMENTED: `${who} commented`, APPROVED: `approved by ${who}` }[e.state];
        if (reason) set.set(author, { reason, since: e.createdAt });
      } else {
        set.delete(author, e.createdAt);
        toReviewers("author responded", e.createdAt);
      }
      return;
    }
    case "IssueComment": {
      const who = e.author?.login;
      if (!who || isBot(e.author)) return;
      if (who === author) { set.delete(author, e.createdAt); toReviewers("author commented", e.createdAt); }
      else { set.delete(who, e.createdAt); set.set(author, { reason: `${who} commented`, since: e.createdAt }); }
      return;
    }
    case "PullRequestCommit":
      set.delete(author, e.commit?.authoredDate || "");
      toReviewers("new commits pushed", e.commit?.authoredDate || "");
      return;
    case "HeadRefForcePushedEvent":
      if (isBot(e.actor)) return;
      set.delete(author, e.createdAt);
      toReviewers("new commits pushed", e.createdAt);
      return;
    case "ReviewRequestedEvent": {
      const id = requestedId(e.requestedReviewer);
      if (id) set.set(id, { reason: "review requested", since: e.createdAt });
      return;
    }
    case "ReviewRequestRemovedEvent": {
      const id = requestedId(e.requestedReviewer);
      if (id) set.delete(id, e.createdAt);
      return;
    }
    case "ReadyForReviewEvent":
      toReviewers("PR ready for review", e.createdAt);
      return;
    case "ConvertToDraftEvent":
      set.clear(e.createdAt);
  }
}

function computeAttention(pr, viewer, checks) {
  const author = pr.author?.login || "";
  const set = new AttentionSet();
  if (pr.state !== "OPEN" || !author) return set;
  if (pr.isDraft) {
    const converted = pr.timelineItems.nodes.filter(e => e.__typename === "ConvertToDraftEvent").map(e => e.createdAt).sort().at(-1);
    set.set(author, { reason: "draft", since: converted || pr.createdAt });
    return set;
  }
  const reviewers = reviewerLogins(pr, author);
  const events = [...pr.timelineItems.nodes].sort((a, b) => (eventTime(a) < eventTime(b) ? -1 : eventTime(a) > eventTime(b) ? 1 : 0));
  for (const e of events) processEvent(e, author, reviewers, set);

  if (author === viewer && checks.failing > 0 && !set.has(author)) {
    set.set(author, { reason: "CI failed", since: checks.latestFailure || pr.updatedAt });
  }
  if (pr.reviewDecision === "APPROVED" && !set.has(author)) {
    const since = pr.latestReviews.nodes.filter(r => r.state === "APPROVED").map(r => r.createdAt).sort().at(-1);
    set.set(author, { reason: "PR approved", since: since || pr.updatedAt });
  }
  if (set.size === 0) {
    for (const rr of pr.reviewRequests.nodes) {
      const id = requestedId(rr.requestedReviewer);
      // attentionset は現在時刻を入れるが、それだと更新のたびにスナップショットが変わり snooze が外れる。
      if (id && id !== author) set.set(id, { reason: "review requested", since: pr.updatedAt });
    }
  }
  return set;
}

function computeReviewers(pr, viewer) {
  const author = pr.author?.login || "";
  const states = new Map();
  for (const r of pr.latestReviews.nodes) {
    if (r.author?.login && r.author.login !== author && !isBot(r.author)) states.set(r.author.login, r.state);
  }
  const pending = new Map();
  for (const rr of pr.reviewRequests.nodes) {
    const id = requestedId(rr.requestedReviewer);
    if (id && id !== author) pending.set(id, Boolean(rr.requestedReviewer?.slug));
  }
  const ids = new Set([...states.keys(), ...pending.keys()]);
  return [...ids]
    .map(login => ({ login, state: pending.has(login) ? "PENDING" : states.get(login), isTeam: pending.get(login) || false }))
    .sort((a, b) => (a.login === viewer) !== (b.login === viewer) ? (a.login === viewer ? -1 : 1) : a.login.localeCompare(b.login));
}

// 再実行で置き換えられた古い CheckRun を除いてから数える（attention.go の dedupedCheckNodes と同じ）。
function computeChecks(pr) {
  const result = { state: "", failing: 0, pending: 0, inProgress: 0, latestFailure: "" };
  const rollup = pr.commits.nodes[0]?.commit?.statusCheckRollup;
  if (!rollup) return result;
  result.state = rollup.state;
  const nodes = rollup.contexts.nodes;
  const workflowKey = (n) => {
    const wr = n.checkSuite?.workflowRun;
    return wr?.workflow ? { id: wr.workflow.id, createdAt: wr.createdAt, dbId: wr.databaseId } : null;
  };
  const latestRun = new Map();
  for (const n of nodes) {
    const k = n.__typename === "CheckRun" && workflowKey(n);
    if (!k) continue;
    const prev = latestRun.get(k.id);
    if (!prev || prev.createdAt < k.createdAt || (prev.createdAt === k.createdAt && prev.dbId < k.dbId)) latestRun.set(k.id, k);
  }
  const runTime = (n) => n.completedAt || n.startedAt || "";
  const runs = new Map(), statuses = new Map();
  for (const n of nodes) {
    if (n.__typename === "CheckRun") {
      const k = workflowKey(n);
      if (k) { const l = latestRun.get(k.id); if (l.createdAt !== k.createdAt || l.dbId !== k.dbId) continue; }
      const prev = runs.get(n.name);
      if (!prev || runTime(n) > runTime(prev)) runs.set(n.name, n);
    } else if (n.__typename === "StatusContext") {
      const prev = statuses.get(n.context);
      if (!prev || n.createdAt > prev.createdAt) statuses.set(n.context, n);
    }
  }
  for (const n of runs.values()) {
    if (n.status === "IN_PROGRESS") result.inProgress++;
    else if (n.status !== "COMPLETED") result.pending++;
    else if (FAILED_CONCLUSIONS.includes(n.conclusion)) {
      result.failing++;
      if ((n.completedAt || "") > result.latestFailure) result.latestFailure = n.completedAt;
    }
  }
  for (const n of statuses.values()) {
    if (n.state === "FAILURE" || n.state === "ERROR") {
      result.failing++;
      if (n.createdAt > result.latestFailure) result.latestFailure = n.createdAt;
    } else if (n.state === "PENDING" || n.state === "EXPECTED") result.pending++;
  }
  return result;
}

// チェックの完了は PR の updatedAt を動かさないので、走っている途中のPRは毎回取り直す
// （attentionset の hasInFlightChecks と同じ）。
function hasInFlightChecks(raw) {
  const rollup = raw.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  if (!rollup) return false;
  if (rollup.state === "PENDING" || rollup.state === "EXPECTED") return true;
  return rollup.contexts.nodes.some(n =>
    (n.__typename === "CheckRun" && n.status !== "COMPLETED")
    || (n.__typename === "StatusContext" && (n.state === "PENDING" || n.state === "EXPECTED")));
}

// ---- セクション分け: attentionset の lib/pr-list.ts を移植 ----

function isApproved(pr) {
  if (pr.reviewDecision === "APPROVED") return true;
  if (pr.reviewDecision) return false;
  const states = pr.reviewers.map(r => r.state);
  return states.includes("APPROVED") && !states.includes("CHANGES_REQUESTED");
}

function prPriority(pr, viewer) {
  const mine = pr.author === viewer, myTurn = pr.turn.has(viewer), approved = isApproved(pr);
  if (mine && !approved && myTurn) return 0;
  if (!mine && myTurn) return 1;
  if (mine && approved) return 2;
  if (mine) return 3;
  return 4;
}

function toInfo(raw, viewer) {
  const checks = computeChecks(raw);
  const pr = {
    id: raw.id, number: raw.number, title: raw.title, url: raw.url, repo: raw.repository.nameWithOwner,
    author: raw.author?.login || "", isDraft: raw.isDraft, reviewDecision: raw.reviewDecision || "",
    baseRefName: raw.baseRefName, headRefName: raw.headRefName,
    checks, attention: computeAttention(raw, viewer, checks), reviewers: computeReviewers(raw, viewer),
    unresolvedThreads: raw.reviewThreads.nodes.filter(t => !t.isResolved).length, viewer,
  };
  applyOverrides(pr, {});
  return pr;
}

// 手動の切り替えを重ねた、表示上の「誰の番か」（pr.turn）とセクション（pr.priority）を決める。
// pr.attention は GitHub の状態から決めた番のまま残し、snooze の判定に使う。
function applyOverrides(pr, overrides) {
  const turn = new Map(pr.attention);
  for (const [login, o] of Object.entries(overrides[pr.id] || {})) {
    if (!isOverrideLive(pr, login, o)) continue;
    if (!o.active) turn.delete(login);
    else if (!turn.has(login)) turn.set(login, { reason: "手動で番にした", since: o.at, manual: true });
  }
  pr.turn = turn;
  pr.priority = prPriority(pr, pr.viewer);
}

// GitHub 側でその人の番が手動の切り替えより後に動いたら、手動の切り替えは無効になる。
const isOverrideLive = (pr, login, o) => o.at > (pr.attention.flips?.[login] || "");

// 秒までの ISO 時刻。GitHub の時刻（ミリ秒なし）と文字列のまま大小を比べるため、ミリ秒を落とす。
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// 同じリポジトリで、あるPRの head ブランチを base にしているPRを、その上に積まれた子として扱う。
// 戻り値は [{ pr, depth }] の配列（スタック）の配列。
function buildStacks(prs) {
  const byHead = new Map(prs.map(pr => [`${pr.repo}:${pr.headRefName}`, pr]));
  const parentOf = new Map();
  const childrenOf = new Map();
  for (const pr of prs) {
    const parent = byHead.get(`${pr.repo}:${pr.baseRefName}`);
    if (!parent || parent.id === pr.id) continue;
    parentOf.set(pr.id, parent);
    if (!childrenOf.has(parent.id)) childrenOf.set(parent.id, []);
    childrenOf.get(parent.id).push(pr);
  }
  const stacks = [], visited = new Set();
  const walk = (pr, depth, stack) => {
    if (visited.has(pr.id)) return;
    visited.add(pr.id);
    stack.push({ pr, depth });
    for (const child of childrenOf.get(pr.id) || []) walk(child, depth + 1, stack);
  };
  for (const pr of prs) {
    if (parentOf.has(pr.id)) continue;
    const stack = [];
    walk(pr, 0, stack);
    stacks.push(stack);
  }
  // 親子が循環していて根が無いPRも、単独で拾う。
  for (const pr of prs) if (!visited.has(pr.id)) { visited.add(pr.id); stacks.push([{ pr, depth: 0 }]); }
  return stacks;
}

// snooze した時点の attention の状態。これが変わったら snooze を自動で外す（attentionset と同じ）。
function attentionSnapshot(pr) {
  return [...pr.attention].map(([login, a]) => `${login}:${a.reason}:${a.since}`).sort().join("|");
}

const isSnoozed = (pr, snoozed) => snoozed[pr.id] !== undefined && snoozed[pr.id] === attentionSnapshot(pr);

// スタックは、メンバーのうち最も急ぐPRのセクションにまとめて置く。snooze 中のPRは除く。
function buildSections(prs, snoozed = {}, overrides = {}) {
  for (const pr of prs) applyOverrides(pr, overrides);
  const sections = SECTIONS.map(s => ({ ...s, stacks: [], prs: [] }));
  for (const stack of buildStacks(prs.filter(pr => !isSnoozed(pr, snoozed)))) {
    const section = sections[Math.min(...stack.map(m => m.pr.priority))];
    section.stacks.push(stack);
    section.prs.push(...stack.map(m => m.pr));
  }
  return sections;
}

function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.floor((now - t) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

const threadsPrompt = (url) => `Please look at the unresolved review threads on the PR at ${url}. Find a local checkout of this repository and check out the PR branch (\`gh pr checkout ${url}\`); tell me before continuing if you cannot. Fetch the unresolved, non-outdated review threads with \`gh api graphql\`. For each thread, suggest what I should do — accept and apply the change, push back with a counter-argument, ask for clarification, or defer — and briefly explain why. Reference the relevant file:line. Don't make code changes yet; I want to triage first based on your suggestions.`;

const checksPrompt = (url) => `Please investigate the failing CI checks on the PR at ${url}. Use \`gh pr checks\` to list check status and \`gh run view --log-failed\` for failing job details. Give me a concise summary of what's failing and the likely root cause, grouped by job. Don't make code changes yet — I want to triage first.`;

export default class MyPRs extends View {
  init(_props, cx) {
    // GitHub から取った PR の生データ。id → PR。再起動すると空から取り直す。
    this.cache = new Map();
    this.prs = []; this.sections = []; this.viewer = ""; this.loading = false; this.loaded = false;
    this.showSnoozed = false;
    try { this.snoozed = JSON.parse(localStorage.getItem("snoozed") ?? "{}"); } catch { this.snoozed = {}; }
    // { [prId]: { [login]: { active, at } } }。attentionset の attentionOverrides と同じ形。
    try { this.overrides = JSON.parse(localStorage.getItem("overrides") ?? "{}"); } catch { this.overrides = {}; }
    this.error = null; this.width = 268; this.closed = false;
    this.refresh(cx);
    cx.timer.every(120000, (cx) => this.refresh(cx));
  }

  close() { this.closed = true; }

  copy(key, text, cx) {
    cx.stop_propagation();
    cx.write_to_clipboard(text);
    this.copied = key;
    const version = this.copyVersion = (this.copyVersion || 0) + 1;
    cx.notify();
    cx.timer.after(1800, (cx) => {
      if (!this.closed && this.copyVersion === version) { this.copied = null; cx.notify(); }
    });
  }

  saveSnoozed() { localStorage.setItem("snoozed", JSON.stringify(this.snoozed)); }

  snooze(pr, cx) {
    cx.stop_propagation();
    this.snoozed[pr.id] = attentionSnapshot(pr);
    this.saveSnoozed();
    this.sections = buildSections(this.prs, this.snoozed, this.overrides);
    cx.notify();
  }

  unsnooze(pr, cx) {
    cx.stop_propagation();
    delete this.snoozed[pr.id];
    this.saveSnoozed();
    this.sections = buildSections(this.prs, this.snoozed, this.overrides);
    cx.notify();
  }

  snoozedPRs() { return this.prs.filter(pr => isSnoozed(pr, this.snoozed)); }

  saveOverrides() { localStorage.setItem("overrides", JSON.stringify(this.overrides)); }

  // その人の番を、今の表示と逆にする。
  toggleTurn(pr, login, cx) {
    cx.stop_propagation();
    const active = !pr.turn.has(login);
    this.overrides[pr.id] = { ...(this.overrides[pr.id] || {}), [login]: { active, at: nowIso() } };
    this.saveOverrides();
    this.sections = buildSections(this.prs, this.snoozed, this.overrides);
    cx.notify();
  }

  async graphql(query, fields = []) {
    const gh = `${home()}/.local/share/mise/installs/github-cli-cli/latest/bin/gh`;
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const f of fields) args.push("-f", f);
    const result = await exec(gh, args, { timeout: 30000 });
    if (result.code !== 0) throw new Error(result.stderr || "GitHub query failed");
    const body = JSON.parse(result.stdout);
    if (!body.data) throw new Error("Unexpected GitHub response");
    return body.data;
  }

  refresh(cx) {
    if (this.loading || this.closed) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const started = Date.now();
      try {
        const overview = await this.graphql(OVERVIEW_QUERY);
        let cost = overview.rateLimit?.cost || 0, rateLimit = overview.rateLimit;
        const updatedAt = new Map();
        for (const n of [overview.authored, overview.reviewRequested, overview.reviewed].flatMap(s => s.nodes)) {
          if (n?.id) updatedAt.set(n.id, n.updatedAt);
        }
        const ids = [...updatedAt.keys()];
        // 詳細は、前回から updatedAt が変わったPRと、チェックが走っている途中のPRだけ取り直す。
        const stale = ids.filter(id => {
          const cached = this.cache.get(id);
          return !cached || cached.updatedAt !== updatedAt.get(id) || hasInFlightChecks(cached);
        });
        const details = stale.length ? await this.graphql(DETAILS_QUERY, stale.map(id => `ids[]=${id}`)) : { nodes: [] };
        if (details.rateLimit) { cost += details.rateLimit.cost || 0; rateLimit = details.rateLimit; }
        for (const raw of details.nodes) if (raw?.id) this.cache.set(raw.id, raw);
        for (const id of [...this.cache.keys()]) if (!updatedAt.has(id)) this.cache.delete(id);
        this.viewer = overview.viewer.login;
        this.prs = ids.map(id => this.cache.get(id)).filter(raw => raw && PR_URL.test(raw.url)).map(raw => toInfo(raw, this.viewer));
        // 一覧から消えた（close・merge された）PRの snooze と、状態が変わって外れた snooze を捨てる。
        const live = new Map(this.prs.map(pr => [pr.id, pr]));
        const kept = Object.fromEntries(Object.entries(this.snoozed).filter(([id]) => live.has(id) && isSnoozed(live.get(id), this.snoozed)));
        if (Object.keys(kept).length !== Object.keys(this.snoozed).length) { this.snoozed = kept; this.saveSnoozed(); }
        // 同じく、消えたPRの手動切り替えと、GitHub 側の動きで無効になった手動切り替えを捨てる。
        const overrides = {};
        for (const [id, byLogin] of Object.entries(this.overrides)) {
          const pr = live.get(id);
          const liveOnes = pr ? Object.entries(byLogin).filter(([login, o]) => isOverrideLive(pr, login, o)) : [];
          if (liveOnes.length) overrides[id] = Object.fromEntries(liveOnes);
        }
        if (JSON.stringify(overrides) !== JSON.stringify(this.overrides)) { this.overrides = overrides; this.saveOverrides(); }
        this.sections = buildSections(this.prs, this.snoozed, this.overrides);
        this.loaded = true; this.error = null;
        this.metrics = { ms: Date.now() - started, cost, rateLimit };
        this.notifyNewTurns();
      } catch (error) {
        this.error = "更新できません。ghの認証・通信を確認してください。";
        console.log("my-prs: " + String(error));
      } finally {
        this.loading = false;
        if (!this.closed) cx.notify();
      }
    });
  }

  // GitHub の状態で新しく自分の番になったPRを、herdr の通知で知らせる。
  // 手動の切り替えは自分でした操作なので通知しない。snooze 中と自分の draft も知らせない。
  // 前回の状態は保存しておき、herdr を閉じている間に自分の番になったPRも次の起動時に知らせる。
  notifyNewTurns() {
    const turns = this.prs
      .map(pr => ({ pr, entry: pr.attention.get(this.viewer) }))
      .filter(({ entry }) => entry && entry.reason !== "draft");
    // snooze 中のPRも覚えておく。外したときに「新しく番になった」と誤って知らせないため。
    const keys = turns.map(({ pr, entry }) => `${pr.id}@${entry.since}`);
    const saved = localStorage.getItem("notifiedTurns");
    localStorage.setItem("notifiedTurns", JSON.stringify(keys));
    // 初回は比べる相手が無いので、今の状態を覚えるだけにする。
    if (saved === null) return;
    let previous;
    try { previous = new Set(JSON.parse(saved)); } catch { return; }
    const fresh = turns.filter(({ pr }, i) => !previous.has(keys[i]) && !isSnoozed(pr, this.snoozed));
    if (!fresh.length) return;
    const lines = fresh.slice(0, 5).map(({ pr, entry }) => `${pr.repo.split("/")[1]} #${pr.number}: ${entry.reason}`);
    if (fresh.length > 5) lines.push(`ほか ${fresh.length - 5}件`);
    notify({ title: `PRがあなたの番になりました（${fresh.length}件）`, body: lines.join("\n"), level: "info" });
  }

  // 見出しのツールチップに出す、前回の取得にかかった時間と GitHub API の残り。
  metricsText() {
    if (!this.metrics) return "";
    const { ms, cost, rateLimit } = this.metrics;
    const parts = [`取得 ${(ms / 1000).toFixed(1)}秒`];
    if (rateLimit) {
      const reset = new Date(rateLimit.resetAt);
      const at = Number.isNaN(reset.getTime()) ? "" : `、${String(reset.getHours()).padStart(2, "0")}:${String(reset.getMinutes()).padStart(2, "0")} にリセット`;
      parts.push(`API 残り ${rateLimit.remaining}/${rateLimit.limit}（今回 −${cost}${at}）`);
    }
    return parts.join("\n");
  }

  open(url, cx) {
    if (!PR_URL.test(url)) return;
    cx.spawn(async (cx) => {
      try {
        const result = await exec("/usr/bin/open", [url]);
        if (result.code !== 0) throw new Error("Browser launch failed");
      } catch {
        this.error = "ブラウザを開けませんでした。";
        if (!this.closed) cx.notify();
      }
    });
  }

  // strong は対応が要るバッジ（T, C）。色付きの地を敷いて、文字だけの P, I より目立たせる。
  badge(id, text, color, tooltip, onClick, strong = false) {
    const t = theme();
    let el = div().id(id).flex_none().px(4).rounded(3).text_size(10.5).font_semibold().text_color(color).child(text).tooltip(tooltip);
    if (strong) el = el.font_bold().bg(color + "2e");
    if (onClick) el = el.cursor_pointer().hover(s => s.bg(t.hover)).on_click(onClick);
    return el;
  }

  badges(pr) {
    const t = theme(), key = `${pr.repo}-${pr.number}`, out = [];
    if (pr.unresolvedThreads > 0) {
      const copied = this.copied === `t:${pr.url}`;
      out.push(this.badge(`t-${key}`, copied ? "Copied" : `Unresolved threads ${pr.unresolvedThreads}`, t.ansi5,
        `未解決のレビュースレッドが ${pr.unresolvedThreads}件あります（クリックでエージェント向けプロンプトをコピー）`,
        (_e, cx) => this.copy(`t:${pr.url}`, threadsPrompt(pr.url), cx), true));
    }
    if (pr.checks.failing > 0) {
      const copied = this.copied === `c:${pr.url}`;
      out.push(this.badge(`c-${key}`, copied ? "Copied" : `Failed checks ${pr.checks.failing}`, t.ansi1,
        `失敗したチェック ${pr.checks.failing}件（クリックでエージェント向けプロンプトをコピー）`,
        (_e, cx) => this.copy(`c:${pr.url}`, checksPrompt(pr.url), cx), true));
    }
    if (pr.checks.pending > 0) out.push(this.badge(`p-${key}`, `Pending checks ${pr.checks.pending}`, t.ansi3, `待機中のチェック ${pr.checks.pending}件`));
    if (pr.checks.inProgress > 0) out.push(this.badge(`i-${key}`, `Running checks ${pr.checks.inProgress}`, t.ansi4, `実行中のチェック ${pr.checks.inProgress}件`));
    if (pr.checks.state && !pr.checks.failing && !pr.checks.pending && !pr.checks.inProgress) {
      out.push(this.badge(`ok-${key}`, "All checks passed", t.ansi2, "すべてのチェックが通過"));
    }
    return out;
  }

  // 自分の番なら理由を、そうでなければ誰の番かを出す。
  turnLine(pr) {
    const mine = pr.turn.get(this.viewer);
    if (mine) {
      const ago = relativeTime(mine.since);
      return `${pr.author === this.viewer ? "" : `${pr.author}: `}${mine.reason}${ago ? ` · ${ago}` : ""}`;
    }
    const others = [...pr.turn.keys()];
    const who = others.length ? `${others.join(", ")} の番` : "誰の番でもない";
    return pr.author === this.viewer ? who : `${pr.author} のPR · ${who}`;
  }

  // 作成者とレビュワーのチップ。番の人は太字、それ以外は薄く出し、クリックで番を切り替える。
  personChips(pr) {
    const t = theme(), key = `${pr.repo}-${pr.number}`;
    const colors = { APPROVED: t.ansi2, CHANGES_REQUESTED: t.ansi1, COMMENTED: t.ansi4, PENDING: t.dim };
    const humans = pr.reviewers.filter(r => !r.isTeam);
    const people = [
      { login: pr.author, label: pr.author, color: t.foreground, role: "作成者" },
      ...(humans.length ? humans : pr.reviewers).map(r => ({
        login: r.login, label: r.isTeam ? `@${r.login}` : r.login, color: colors[r.state] || t.dim,
        role: `${r.isTeam ? "チーム " : ""}${(r.state || "").toLowerCase().replace("_", " ")}`,
      })),
    ];
    return people.map(p => {
      const turn = pr.turn.has(p.login);
      const manual = Object.prototype.hasOwnProperty.call(this.overrides[pr.id] || {}, p.login)
        && isOverrideLive(pr, p.login, this.overrides[pr.id][p.login]);
      let chip = div().id(`turn-${key}-${p.login}`).flex_none().px(3).rounded(3).text_size(10.5).text_color(p.color)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .tooltip(`${p.login}（${p.role}）: ${turn ? "番" : "番ではない"}${manual ? "（手動）" : ""}\nクリックで番を切り替え`)
        .on_click((_event, cx) => this.toggleTurn(pr, p.login, cx))
        .child(p.label);
      chip = turn ? chip.font_bold() : chip.opacity(0.55);
      return chip;
    });
  }

  row(pr, section, compact, depth, snoozed = false) {
    const t = theme(), key = `${pr.repo}-${pr.number}`;
    const urlCopied = this.copied === `u:${pr.url}`;
    const reviewers = pr.reviewers.map(r => `${r.isTeam ? "Team " : ""}${r.login}: ${(r.state || "").toLowerCase().replace("_", " ")}`).join("\n");
    const stacked = depth > 0 ? `\n${pr.baseRefName} の上に積まれたPR` : "";
    // flex_1 は └ の横で幅を埋めるためのもの。縦並びの一覧に直接置く行に付けると、余った高さまで伸びてしまう。
    let body = v_flex().id(`pr-${key}`).flex_none().min_w(0);
    if (depth > 0) body = body.flex_1();
    // CIが落ちている行は赤、未解決スレッドが残る行は紫の地にする。
    const alert = pr.checks.failing > 0 ? t.ansi1 : pr.unresolvedThreads > 0 ? t.ansi5 : null;
    body = body.px(8).py(8).gap(1).rounded(4).cursor_pointer();
    body = alert
      ? body.bg(alert + "17").hover(s => s.bg(alert + "2b"))
      : body.hover(s => s.bg(t.raised));
    body = body
      .tooltip(`${pr.repo} #${pr.number}\n${pr.title}\n作成者: ${pr.author}${stacked}${reviewers ? `\n${reviewers}` : ""}\nブラウザで開く`)
      .on_click((_event, cx) => this.open(pr.url, cx))
      .child(h_flex().items_center().gap(4)
        .child(div().flex_1().min_w(0).text_size(10.5).text_color(t.dim).truncate()
          .child(compact ? `#${pr.number}` : `${pr.repo.split("/")[1]} #${pr.number}${pr.isDraft ? " · Draft" : ""}`))
        .when(!compact, el => el
          .child(div().id(`snooze-pr-${key}`).flex_none().p(3).rounded(4).text_color(t.dim)
            .hover(s => s.bg(t.hover).text_color(t.foreground))
            .tooltip(snoozed ? "snooze を解除" : "snooze（誰かが動くまで一覧から隠す）")
            .on_click((_event, cx) => (snoozed ? this.unsnooze(pr, cx) : this.snooze(pr, cx)))
            .child(svg(snoozed ? "mods/my-prs/unsnooze.svg" : "mods/my-prs/snooze.svg").size(14)))
          .child(div().id(`copy-pr-${key}`).flex_none().p(3).rounded(4).text_color(urlCopied ? t.accent : t.dim)
            .hover(s => s.bg(t.hover).text_color(t.foreground))
            .tooltip(urlCopied ? "URLをコピーしました" : "PRのURLだけをコピー")
            .on_click((_event, cx) => this.copy(`u:${pr.url}`, pr.url, cx))
            .child(svg(urlCopied ? "mods/my-prs/check.svg" : "mods/my-prs/copy.svg").size(14)))))
      .when(!compact, el => {
        // 要対応の欄はタイトルを大きく太くし、理由を色付きで出す。それ以外の欄は控えめにして、目が止まる所を絞る。
        const title = section.attention
          ? div().text_size(13.5).font_bold().text_color(t.foreground).truncate().child(pr.title)
          : div().text_size(12).text_color(t.dim).truncate().child(pr.title);
        const badges = this.badges(pr);
        // バッジは省略しない英語の名前で長いので、1行目に並べず、タイトルの下に折り返せる行として置く。
        return el.child(title)
          .when(badges.length > 0, e => e.child(h_flex().flex_wrap().gap(4).my(2).children(badges)))
          .child(div().text_size(10.5).text_color(section.attention && !pr.isDraft ? t.accent : t.dim).truncate().child(this.turnLine(pr)))
          .child(h_flex().mt(3).gap(3).overflow_hidden().children(this.personChips(pr)));
      });
    if (!depth) return body;
    // 子は親より右へずらし、先頭に └ を置く（attentionset と同じ見せ方）。
    const indent = compact ? 0 : (depth - 1) * 10;
    return h_flex().items_start().pl(indent)
      .child(div().flex_none().w(compact ? 8 : 12).pt(6).text_size(11).text_color(t.dim).child("└"))
      .child(body);
  }

  render() {
    const t = theme(), compact = this.width < 160;
    const visible = this.sections.filter(s => s.prs.length);
    const snoozed = this.snoozedPRs();
    const total = this.sections.reduce((n, s) => n + s.prs.length, 0);
    const urgent = this.sections.filter(s => s.attention).reduce((n, s) => n + s.prs.length, 0);
    const label = this.loaded ? `${urgent}/${total}` : "";
    return v_flex().id("my-prs-root").size_full().min_h(0)
      .on_size_change((size, cx) => {
        if ((this.width < 160) !== (size.width < 160)) { this.width = size.width; cx.notify(); }
      })
      .child(h_flex().px(compact ? 4 : 16).h(36).flex_none().items_center().justify_between()
        .child(div().id("my-prs-count").text_size(11.5).font_medium().text_color(t.dim).tooltip(["要対応 / 全体", this.metricsText()].filter(Boolean).join("\n")).child(compact ? "PR" : `PRs  ${label}`))
        .when(!compact, el => el.child(div().id("my-prs-refresh").p(3).rounded(4)
          .text_color(this.loading ? t.accent : t.dim)
          .cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
          .tooltip(this.loading ? "PRを更新中" : "PR一覧を更新（2分ごとに自動更新）")
          .on_click((_event, cx) => this.refresh(cx)).child(svg("mods/my-prs/refresh.svg").size(14)))))
      .when(Boolean(this.error) && !compact, el => el.child(div().px(12).pb(6).text_size(11)
        .text_color(t.dim).child(this.error + (this.loaded ? " 前回の一覧を表示中。" : ""))))
      .when(!this.loaded && !this.error && !compact, el => el.child(div().px(16).text_size(12).text_color(t.dim).child("読み込み中…")))
      .when(this.loaded && !total && !compact, el => el.child(div().px(16).text_size(12).text_color(t.dim).child("未クローズのPRはありません")))
      .child(v_flex().id("my-prs-list").flex_1().min_h(0).px(compact ? 2 : 8)
        .overflow_y_scrollbar().mode("always")
        .children(visible.flatMap(section => [
          // 見出しには地の色を敷いて、欄の切れ目をはっきりさせる。要対応の欄はアクセント色の地にする。
          h_flex().id(`section-${section.title}`).flex_none().mt(12).mb(4).px(8).py(5).rounded(4).gap(6).items_baseline()
            .bg(section.attention ? t.accent + "2e" : t.raised)
            .child(div().min_w(0).truncate().text_size(section.attention ? 12 : 11).font_bold()
              .text_color(section.attention ? t.foreground : t.dim).child(compact ? `${section.prs.length}` : section.title))
            .when(!compact, el => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`${section.prs.length}`))),
          ...section.stacks.flatMap((stack, i) => [
            // 2つ目以降のスタックの前に区切り線を入れ、どこまでが1つのスタックかを分かるようにする。
            ...(i > 0 && (stack.length > 1 || section.stacks[i - 1].length > 1)
              ? [div().mx(8).my(2).h(1).flex_none().bg(t.border)] : []),
            ...stack.map(({ pr, depth }) => this.row(pr, section, compact, depth)),
          ]),
        ]))
        .when(snoozed.length > 0 && !compact, el => el
          .child(div().id("my-prs-snoozed-toggle").mx(8).mt(8).mb(4).px(8).py(4).rounded(4)
            .text_size(10.5).text_color(t.dim).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_event, cx) => { this.showSnoozed = !this.showSnoozed; cx.notify(); })
            .child(`snooze 中の ${snoozed.length}件を${this.showSnoozed ? "隠す" : "表示"}`))
          .when(this.showSnoozed, el => el.children(snoozed.map(pr => this.row(pr, SNOOZED_SECTION, compact, 0, true))))));
  }
}
