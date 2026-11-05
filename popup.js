const $ = id => document.getElementById(id);
const REQUIRED = ["logFile","analyzeBtn","threshold","modelFilter","modelMenu","modelChips","menuToggle","clearFilter","status","results","verdict","metrics","findings","timeList","modelTable","slowList","repeatList","seqList","heavyList","indexList","download","copy","drop","fileName","fileMeta","tabs","chips","types","allList","allSearch","allMore","allCount","methodList","endpointList","methodNote","methodHow","opsTable"];
const missing = REQUIRED.filter(id => !document.getElementById(id));
if (missing.length) { document.body.insertAdjacentHTML("afterbegin", `<p style="padding:16px;color:#b3261e;font:14px system-ui">popup.html is out of date (missing: ${missing.join(", ")}). Replace ALL files (manifest, background, popup.html/js/css), then reload the extension.</p>`); throw new Error("Outdated popup.html: " + missing.join(", ")); }
const fileInput = $("logFile"), analyzeBtn = $("analyzeBtn"), thresholdInput = $("threshold");
let sourceText = "", parsed = null, report = null;
const modelInput = $("modelFilter");

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  analyzeBtn.disabled = !f;
  $("fileName").textContent = f ? f.name : "Drop your log here or click to browse";
  $("fileMeta").textContent = f ? `${(f.size / 1024).toFixed(1)} KB · ready to analyze` : ".log · .txt · .sql";
  $("drop").classList.toggle("has", !!f);
  $("results").hidden = true;
});
["dragenter","dragover"].forEach(ev => $("drop").addEventListener(ev, e => { e.preventDefault(); $("drop").classList.add("over"); }));
["dragleave","drop"].forEach(ev => $("drop").addEventListener(ev, e => { e.preventDefault(); $("drop").classList.remove("over"); }));
$("drop").addEventListener("drop", e => { if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; fileInput.dispatchEvent(new Event("change")); } });
function showTab(id) {
  document.querySelectorAll("#tabs button").forEach(x => x.classList.toggle("active", x.dataset.tab === id));
  document.querySelectorAll(".panel").forEach(p => p.hidden = p.id !== id);
}
$("tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab); });
let allLimit = 100;
$("allSearch").addEventListener("input", () => { allLimit = 100; if (report) renderAll(report); });
$("allMore").addEventListener("click", () => { allLimit += 200; if (report) renderAll(report); });
function renderAll(r) {
  const q = $("allSearch").value.trim().toLowerCase();
  const rows = r.statements.map((s, i) => ({ s, n: i + 1 })).filter(x => !q || (x.s.sql + " " + (x.s.method?.label || "") + " " + (x.s.endpoint || "") + " " + x.s.orm).toLowerCase().includes(q));
  const box = $("allList"); box.replaceChildren();
  if (!rows.length) box.append(el("div", "empty", "No queries match."));
  rows.slice(0, allLimit).forEach(({ s, n }) => box.append(item(
    `#${n} · ${typeOf(s).toUpperCase()} · ${s.tables.map(modelName).join(", ") || "n/a"}${s.durationMs != null ? " · " + fmt(s.durationMs) + " ms" : ""} · ${s.method ? "method: " + s.method.label : s.endpoint ? "call: " + s.endpoint : "likely " + s.orm}`, s.sql)));
  $("allCount").textContent = `${Math.min(allLimit, rows.length)} of ${rows.length} shown`;
  $("allMore").hidden = rows.length <= allLimit;
}
let sevFilter = "all";
$("chips").addEventListener("click", e => {
  const b = e.target.closest("button[data-sev]"); if (!b) return; sevFilter = b.dataset.sev;
  document.querySelectorAll("#chips button").forEach(x => x.classList.toggle("active", x === b));
  if (report) renderFindings(report);
});
analyzeBtn.addEventListener("click", async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  try { sourceText = await f.text(); parsed = parseAny(sourceText); fillModelList(); runAnalysis(); }
  catch (e) { $("status").textContent = "Could not read file: " + e.message; }
});
thresholdInput.addEventListener("change", () => { if (parsed) runAnalysis(); });
let ft; modelInput.addEventListener("input", () => { clearTimeout(ft); ft = setTimeout(() => { if (parsed) runAnalysis(); }, 250); });
$("types").addEventListener("change", () => { if (parsed) runAnalysis(); });
$("clearFilter").addEventListener("click", () => { modelInput.value = ""; syncModelUI(); document.querySelectorAll("#types input").forEach(i => i.checked = true); if (parsed) runAnalysis(); });
$("download").addEventListener("click", downloadReport);
$("copy").addEventListener("click", async () => {
  if (!report) return;
  try { await navigator.clipboard.writeText(summaryText(report)); $("status").textContent = "Summary copied."; }
  catch { $("status").textContent = "Copy failed. Use the download button."; }
});

function tableOf(m) { return m.trim().toLowerCase().replace(/\./g, "_"); }
function filterStatements(all) {
  const picked = chosenTerms().map(tableOf);
  if (!picked.length) return all;
  const res = picked.map(t => new RegExp("^" + t.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"));
  return all.filter(s => s.tables.some(t => res.some(re => re.test(t))));
}
const typeOf = s => s.type === "with" ? "select" : s.type;
function filterByType(list) {
  const on = new Set([...document.querySelectorAll("#types input:checked")].map(i => i.dataset.type));
  const all = document.querySelectorAll("#types input").length === on.size;
  return all ? list : list.filter(s => on.has(typeOf(s)));
}
function updateTypeCounts(list) {
  const n = { select: 0, insert: 0, update: 0, delete: 0 };
  list.forEach(s => { const t = typeOf(s); if (t in n) n[t]++; });
  for (const k in n) $("cnt-" + k).textContent = n[k].toLocaleString();
}
/* ---------- Model dropdown (custom combobox) ---------- */
let modelStats = [], activeIdx = -1;
const menu = $("modelMenu");
function fillModelList() {
  const c = new Map();
  parsed.forEach(s => s.tables.forEach(t => c.set(t, (c.get(t) || 0) + 1)));
  modelStats = [...c.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ name: modelName(t), n }));
  syncModelUI();
}
const terms = () => modelInput.value.split(",").map(s => s.trim()).filter(Boolean);
function partialText() {
  const last = (modelInput.value.split(",").pop() || "").trim();
  return last && !last.includes("*") && !modelStats.some(m => m.name === last.toLowerCase()) ? last.toLowerCase() : "";
}
function chosenTerms() { const t = terms(); return partialText() ? t.slice(0, -1) : t; }
function syncModelUI() { renderChips(); if (!menu.hidden) renderMenu(); }
function renderChips() {
  const box = $("modelChips"); box.replaceChildren();
  terms().forEach(t => {
    const c = el("span", "mchip", t), x = el("button", "", "×"); x.type = "button"; x.title = "Remove";
    x.addEventListener("click", () => { modelInput.value = terms().filter(v => v !== t).join(", "); syncModelUI(); runAnalysis(); });
    c.append(x); box.append(c);
  });
}
function renderMenu() {
  const q = partialText(), sel = new Set(chosenTerms().map(s => s.toLowerCase()));
  const list = modelStats.filter(m => !q || m.name.includes(q)).slice(0, 80), max = modelStats[0]?.n || 1;
  menu.replaceChildren();
  menu.append(el("div", "menu-head", `${q ? list.length + " match" : modelStats.length + " models"} · click to select`));
  if (!list.length) menu.append(el("div", "menu-empty", modelStats.length ? "No model matches. Your text is used as a filter." : "Load a log to see models."));
  list.forEach((m, i) => {
    const d = el("div", "opt" + (sel.has(m.name) ? " sel" : "") + (i === activeIdx ? " active" : "")); d.setAttribute("role", "option"); d.dataset.name = m.name;
    const tr = el("div", "bar-track"), f = el("div", "bar-fill"); f.style.width = Math.max(3, m.n / max * 100) + "%"; tr.append(f);
    d.append(el("span", "tick", "✓"), el("span", "nm", m.name), el("span", "ct", m.n.toLocaleString() + (m.n === 1 ? " query" : " queries")), tr);
    d.addEventListener("mousedown", e => { e.preventDefault(); e.stopPropagation(); toggleModel(m.name); });
    menu.append(d);
  });
}
function toggleModel(name) {
  const t = chosenTerms(), i = t.findIndex(v => v.toLowerCase() === name);
  if (i >= 0) t.splice(i, 1); else t.push(name);
  modelInput.value = t.join(", "); activeIdx = -1; syncModelUI(); runAnalysis();
}
function openMenu() { if (!parsed) return; menu.hidden = false; modelInput.setAttribute("aria-expanded", "true"); renderMenu(); }
function closeMenu() { menu.hidden = true; modelInput.setAttribute("aria-expanded", "false"); activeIdx = -1; }
modelInput.addEventListener("focus", openMenu);
modelInput.addEventListener("click", openMenu);
modelInput.addEventListener("input", () => { activeIdx = -1; if (menu.hidden) openMenu(); else renderMenu(); renderChips(); });
modelInput.addEventListener("keydown", e => {
  const opts = [...menu.querySelectorAll(".opt")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (menu.hidden) openMenu();
    activeIdx = (activeIdx + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % Math.max(1, opts.length); renderMenu(); menu.querySelector(".opt.active")?.scrollIntoView({ block: "nearest" }); }
  else if (e.key === "Enter" && activeIdx >= 0 && opts[activeIdx]) { e.preventDefault(); toggleModel(opts[activeIdx].dataset.name); }
  else if (e.key === "Escape") closeMenu();
  else if (e.key === "Backspace" && !modelInput.value && false) {}
});
$("menuToggle").addEventListener("click", () => { menu.hidden ? (modelInput.focus(), openMenu()) : closeMenu(); });
document.addEventListener("mousedown", e => { if (!$("combo").contains(e.target)) closeMenu(); });

function runAnalysis() {
  const threshold = Math.max(1, Number(thresholdInput.value) || 500);
  try {
    const byModel = filterStatements(parsed);
    updateTypeCounts(byModel);
    const subset = filterByType(byModel);
    report = analyze(subset, threshold);
    render(report);
    $("results").hidden = false;
    const filtered = modelInput.value.trim();
    $("status").textContent = !parsed.length
      ? "No SQL statements recognised. See 'How do I capture a log?' above."
      : (filtered || subset.length !== parsed.length) ? `Showing ${subset.length} of ${parsed.length} statement(s)${filtered ? ` for "${filtered}"` : ""}.`
      : `Analyzed ${parsed.length} SQL statement(s).`;
  } catch (e) { $("status").textContent = "Analysis failed: " + e.message; }
}

/* ---------- Parsing ---------- */
function parseLog(text) {
  const lines = text.split(/\r?\n/);
  const TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;
  const DUR = /(?:duration|execute[^:\n]*)\s*[:=]\s*([\d.]+)\s*ms/i;
  const SQLSTART = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i;
  const MARK = /(?:statement|query|execute[^:\n]*|bad query)\s*:\s*((?:SELECT|INSERT|UPDATE|DELETE|WITH)\b[\s\S]*)/i;
  const recs = [];
  let cur = null;
  lines.forEach((ln, i) => {
    if (TS.test(ln) || DUR.test(ln) || SQLSTART.test(ln)) { cur = { line: i + 1, text: ln }; recs.push(cur); }
    else if (cur && ln.trim()) cur.text += "\n" + ln;
  });
  const out = []; let pending = [];
  for (const r of recs) {
    const mk = r.text.match(MARK);
    const sql = mk ? mk[1] : (SQLSTART.test(r.text) ? r.text : null);
    if (!sql) { const ep = endpointOf(r.text); if (ep && pending.length) { pending.forEach(s => s.endpoint = ep); pending = []; } continue; }
    const d = r.text.match(DUR);
    const clean = sql.replace(/\s+/g, " ").trim();
    const st = describe({ sql: clean, durationMs: d ? Number(d[1]) : null, line: r.line });
    out.push(st); pending.push(st);
  }
  out.source = "log";
  return out;
}

/* Request line (written AFTER the request's queries) tells us which RPC/method triggered them. */
function endpointOf(text) {
  const c = text.match(/(?:call_kw|call_button)\/([\w.]+)\/(\w+)/);
  if (c) return c[1] + "." + c[2];
  const g = text.match(/\b(?:GET|POST)\s+(\/[^\s"?]*)/);
  return g && !/\/(?:static|assets|websocket|longpolling|bus)\b/.test(g[1]) ? g[1] : null;
}

/* Odoo profiler (ir.profile) JSON: every SQL entry carries a Python stack trace. */
const FRAMEWORK = /[\\/]odoo[\\/](?:models|fields|api|sql_db|osv|http|service|tools|modules|orm|exceptions|netsvc|cli)(?:\.py|[\\/])|site-packages|dist-packages|[\\/]lib[\\/]python|^<|werkzeug|psycopg/i;
function frameOf(f) {
  if (Array.isArray(f)) return { file: String(f[0] || ""), line: Number(f[1]) || 0, func: String(f[2] || "") };
  if (f && typeof f === "object") return { file: String(f.filename || f.file || f.path || ""), line: Number(f.lineno || f.line || 0), func: String(f.name || f.function || f.func || f.method || "") };
  if (typeof f === "string") { const m = f.match(/^(.*?):(\d+)(?::|\s+in\s+)(\w+)/); if (m) return { file: m[1], line: +m[2], func: m[3] }; }
  return null;
}
function methodFromStack(stack) {
  let fr = (Array.isArray(stack) ? stack : []).map(frameOf).filter(Boolean);
  const inner = fr.findIndex(f => /sql_db\.py$/.test(f.file));
  if (inner === 0) fr = fr.reverse();            // make order: outermost -> innermost
  const mine = fr.filter(f => f.file && !FRAMEWORK.test(f.file)).reverse();   // innermost first
  if (!mine.length) return null;
  const shape = f => {
    const p = f.file.split(/[\\/]/), k = Math.max(...["models", "wizard", "wizards", "controllers", "report"].map(x => p.lastIndexOf(x)));
    const mod = k > 0 ? p[k - 1] : (p[p.length - 2] || "?"), short = p.slice(-2).join("/");
    return { module: mod, file: short, line: f.line, func: f.func, label: `${mod}/${short.split("/").pop()}:${f.line} ${f.func}()`, key: `${mod}/${short.split("/").pop()} ${f.func}()` };
  };
  const top = shape(mine[0]); top.chain = mine.slice(0, 4).map(f => shape(f).label); return top;
}
function parseProfile(text) {
  let data; try { data = JSON.parse(text); } catch { return null; }
  const entries = [], isSql = v => typeof v === "string" && /^\s*(select|insert|update|delete|with)\b/i.test(v);
  (function walk(o, d) {
    if (!o || d > 7) return;
    if (typeof o === "string") { const t = o.trim(); if (t[0] === "[" || t[0] === "{") { try { walk(JSON.parse(t), d + 1); } catch {} } return; }
    if (Array.isArray(o)) { o.forEach(x => walk(x, d + 1)); return; }
    if (typeof o === "object") {
      if (isSql(o.full_query) || isSql(o.query)) { entries.push(o); return; }
      Object.values(o).forEach(v => walk(v, d + 1));
    }
  })(data, 0);
  if (!entries.length) return null;
  const times = entries.map(e => Number(e.time)).filter(Number.isFinite), k = times.length && Math.max(...times) > 600 ? 1 : 1000;
  const out = entries.map((e, i) => {
    const sql = String(isSql(e.full_query) ? e.full_query : e.query).replace(/\s+/g, " ").trim();
    const st = describe({ sql, durationMs: Number.isFinite(Number(e.time)) ? Number(e.time) * k : null, line: i + 1 });
    st.method = methodFromStack(e.stack || e.exec_context || e.frames || e.trace);
    return st;
  });
  out.source = "profile"; return out;
}
function parseAny(text) {
  if (/^\s*[\[{]/.test(text)) { const p = parseProfile(text); if (p) return p; }
  return parseLog(text);
}

function guessOrm(s) {
  const q = s.normalized;
  if (s.type === "insert") return "create()";
  if (s.type === "update") return "write()";
  if (s.type === "delete") return "unlink()";
  if (s.hasCount) return "search_count() / _read_group()";
  if (s.hasGroup) return "_read_group() / read_group()";
  if (/where [^ ]*"?id"? in \(\?\)\s*$/.test(q) || /where [^ ]*"?id"? in \(\?\)( order by .*)?$/.test(q)) return "read() / prefetch of a recordset";
  if (/where [^ ]*"?id"? = \?(?: limit \?)?$/.test(q)) return "browse().field (single record read)";
  if (s.hasLimit || s.hasOrder) return "search() / search_read()";
  return "search() / read()";
}

function normalize(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, "?").replace(/\$\d+|%s|%\(\w+\)s/g, "?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, "(?)")
    .replace(/\(\?\)(\s*,\s*\(\?\))+/g, "(?)")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

function describe(s) {
  const q = s.sql, low = q.toLowerCase();
  s.normalized = normalize(q);
  s.type = (low.match(/^\s*(select|insert|update|delete|with)/) || [])[1] || "other";
  s.tables = [...new Set([...low.matchAll(/\b(?:from|join|update|into)\s+"?([a-z_][a-z0-9_]*)"?/g)].map(m => m[1]))];
  s.joins = (low.match(/\bjoin\b/g) || []).length;
  s.subselects = Math.max(0, (low.match(/\(\s*select\b/g) || []).length);
  s.hasGroup = /\bgroup by\b/.test(low);
  s.hasOrder = /\border by\b/.test(low);
  s.hasLimit = /\blimit\b/.test(low);
  s.hasDistinct = /\bdistinct\b/.test(low);
  s.hasCount = /\bcount\s*\(/.test(low);
  s.leadingWildcard = /i?like\s+'%|i?like\s+\(?\s*\?\s*\)?\s*\|\|/.test(low) || /i?like\s+'%/.test(low);
  const where = low.split(/\bwhere\b/)[1] || "";
  s.whereCols = [...new Set([...where.matchAll(/"?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?\s*(?:=|in\b|>=|<=|>|<|i?like\b)/g)]
    .map(m => `${m[1]}.${m[2]}`).filter(c => !c.endsWith(".id")))];
  s.orm = guessOrm(s);
  return s;
}

/* ---------- Analysis ---------- */
const modelName = t => t.replace(/_/g, ".");
const fmt = n => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

function loopHint(p) {
  if (/^insert/.test(p)) return ["Records are created one at a time.", "Batch them: create() accepts a list of dicts (vals_list)."];
  if (/^update/.test(p)) return ["Records are saved one at a time.", "Call write() once on the whole recordset instead of per record."];
  if (/count\s*\(/.test(p)) return ["A count is requested again for every record.", "Use read_group()/_read_group() to count for all records in one query instead of search_count() in a loop."];
  if (/where .*\bid\s*=\s*\?/.test(p) && /^select/.test(p)) return ["Records are fetched one by one by ID.", "Use browse(ids) on the whole list, or prefetch before the loop."];
  if (/limit \?/.test(p) || /=\s*\?/.test(p)) return ["The system runs a separate search for each record.", "Move search() out of the loop: search once with ('field','in',ids), then group results in Python (mapped/filtered)."];
  return ["The same query is repeated with different values.", "Look for ORM calls inside for-loops or non-batched compute methods."];
}

function analyze(statements, thresholdMs) {
  const timed = statements.filter(s => Number.isFinite(s.durationMs));
  const totalMs = timed.reduce((a, s) => a + s.durationMs, 0);
  const slow = timed.filter(s => s.durationMs >= thresholdMs).sort((a, b) => b.durationMs - a.durationMs);

  const groups = new Map();
  for (const s of statements) {
    const g = groups.get(s.normalized) || { pattern: s.normalized, count: 0, totalMs: 0, maxMs: 0, sample: s.sql, tables: s.tables, firstLine: s.line, method: s.method, endpoint: s.endpoint };
    g.count++;
    if (Number.isFinite(s.durationMs)) { g.totalMs += s.durationMs; g.maxMs = Math.max(g.maxMs, s.durationMs); }
    groups.set(s.normalized, g);
  }
  const all = [...groups.values()];
  const repeated = all.filter(g => g.count >= 5).sort((a, b) => b.count - a.count).slice(0, 20);
  const topTime = all.filter(g => g.totalMs > 0).sort((a, b) => b.totalMs - a.totalMs).slice(0, 8);

  const tmap = new Map();
  for (const s of statements) for (const t of s.tables) {
    const x = tmap.get(t) || { table: t, count: 0, totalMs: 0 };
    x.count++; if (Number.isFinite(s.durationMs)) x.totalMs += s.durationMs; tmap.set(t, x);
  }
  const models = [...tmap.values()].sort((a, b) => b.count - a.count).slice(0, 10);

  const sequential = [];
  for (let i = 0; i < statements.length;) {
    let j = i; while (j + 1 < statements.length && statements[j + 1].normalized === statements[i].normalized) j++;
    const len = j - i + 1;
    if (len >= 5) sequential.push({ length: len, line: statements[i].line, sample: statements[i].sql,
      totalMs: statements.slice(i, j + 1).reduce((a, s) => a + (s.durationMs || 0), 0) });
    i = j + 1;
  }
  sequential.sort((a, b) => b.length - a.length);

  const bucket = (keyFn, labelFn) => {
    const m = new Map();
    for (const s of statements) { const k = keyFn(s); if (!k) continue;
      const x = m.get(k) || { key: k, label: labelFn(s), count: 0, totalMs: 0, models: new Set(), sample: s.sql, chain: s.method?.chain };
      x.count++; if (Number.isFinite(s.durationMs)) x.totalMs += s.durationMs; s.tables.forEach(t => x.models.add(modelName(t))); m.set(k, x); }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 25);
  };
  const methods = bucket(s => s.method?.key, s => s.method.label);
  const endpoints = bucket(s => s.endpoint, s => s.endpoint);
  const opsMap = new Map(); statements.forEach(s => { const x = opsMap.get(s.orm) || { op: s.orm, count: 0, totalMs: 0 }; x.count++; x.totalMs += s.durationMs || 0; opsMap.set(s.orm, x); });
  const ops = [...opsMap.values()].sort((a, b) => b.count - a.count);
  const trigger = o => o.method ? ` Triggered by ${o.method.label}.` : o.endpoint ? ` Triggered during ${o.endpoint}.` : "";

  const heavy = statements.filter(s => {
    const shape = s.joins >= 4 || s.subselects >= 2 || (s.hasGroup && (s.joins >= 2 || s.tables.length > 2)) || (s.hasOrder && !s.hasLimit && s.type === "select" && s.joins >= 2);
    return shape && (!Number.isFinite(s.durationMs) || s.durationMs >= thresholdMs / 4);
  }).sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0)).slice(0, 10);

  // index candidates: filter columns used by slow or repeated queries
  const repPatterns = new Set(repeated.map(g => g.pattern));
  const cand = new Map();
  for (const s of statements) {
    const relevant = (Number.isFinite(s.durationMs) && s.durationMs >= thresholdMs) || repPatterns.has(s.normalized);
    if (!relevant) continue;
    for (const c of s.whereCols) {
      const x = cand.get(c) || { col: c, uses: 0, totalMs: 0, wildcard: false };
      x.uses++; x.totalMs += s.durationMs || 0; x.wildcard ||= s.leadingWildcard; cand.set(c, x);
    }
  }
  const indexes = [...cand.values()].sort((a, b) => b.uses - a.uses || b.totalMs - a.totalMs).slice(0, 10);

  // ---- findings in plain language ----
  const findings = [];
  const sev = (cond, hi) => hi ? "high" : cond ? "medium" : "low";
  slow.slice(0, 3).forEach(s => findings.push({
    severity: s.durationMs >= thresholdMs * 5 ? "high" : "medium",
    title: `A single query took ${fmt(s.durationMs)} ms (log line ${s.line})`,
    plain: "One database request was slow on its own. It likely reads a lot of data or has no suitable index.",
    dev: `Run EXPLAIN (ANALYZE, BUFFERS) on it. Tables: ${s.tables.join(", ") || "n/a"}.${trigger(s)}`, sample: s.sql }));
  repeated.slice(0, 5).forEach(g => {
    const [why, fix] = loopHint(g.pattern);
    findings.push({ severity: g.count >= 50 || g.totalMs >= thresholdMs ? "high" : "medium",
      title: `Same query repeated ${g.count} times (${g.tables.map(modelName).join(", ") || "unknown model"})`,
      plain: `${why} This is the classic "N+1" slowdown: the cost grows with every record on screen.`,
      dev: fix + ` Total time: ${fmt(g.totalMs)} ms.${trigger(g)}`, sample: g.sample });
  });
  sequential.slice(0, 2).forEach(q => findings.push({ severity: q.length >= 30 ? "high" : "medium",
    title: `${q.length} identical queries ran back-to-back (from log line ${q.line})`,
    plain: "Records are processed one after another instead of all at once. This is typical of a loop over a recordset.",
    dev: "Find the loop in the method running at this moment and batch the ORM call.", sample: q.sample }));
  heavy.slice(0, 2).forEach(s => findings.push({ severity: "medium",
    title: `Heavy query shape: ${s.joins} JOIN(s)${s.hasGroup ? ", GROUP BY" : ""}${s.hasOrder ? ", ORDER BY" : ""}`,
    plain: "This query combines many tables or aggregates many rows, which is expensive on large data sets.",
    dev: "Check row counts and filters; consider narrowing the domain, a stored computed field, or a SQL view for reporting.", sample: s.sql }));
  indexes.slice(0, 3).forEach(c => findings.push({ severity: "low",
    title: `Possible missing index: ${c.col}`,
    plain: "This column is used for filtering in slow or repeated queries. An index may make those lookups faster.",
    dev: c.wildcard ? "Leading-wildcard ilike/like cannot use a normal index. Consider a pg_trgm GIN index or avoid 'contains' on big tables."
      : `Check with EXPLAIN whether it is a sequential scan. In the model: ${c.col.split(".")[1]} = fields.X(index=True).` }));
  if (!findings.length) findings.push({ severity: "low", title: "No obvious problem found",
    plain: "Nothing exceeded the thresholds. If the screen is still slow, the time may be in Python code or the browser.",
    dev: "Use the Odoo profiler (Developer mode) for Python method attribution." });

  const high = findings.filter(f => f.severity === "high").length;
  const verdict = high ? { cls: "bad", text: `${high} serious issue(s): this action is likely hitting the database too hard.` }
    : findings.some(f => f.severity === "medium") ? { cls: "warn", text: "Some inefficiencies found. Worth reviewing." }
    : { cls: "good", text: "Database activity looks healthy by these checks." };

  return { source: statements.source, methods, endpoints, ops, thresholdMs, statements, timedCount: timed.length, totalMs, slow, repeated, topTime, models, sequential, heavy, indexes, findings, verdict };
}

/* ---------- Rendering ---------- */
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function fill(id, arr, build, emptyMsg) {
  const box = $(id); box.replaceChildren();
  if (!arr.length) box.append(el("div", "empty", emptyMsg));
  arr.forEach(x => box.append(build(x)));
}
function item(meta, sql, cls, pct) {
  const d = el("div", "item" + (cls ? " " + cls : "")); d.append(el("div", "meta", meta));
  if (pct != null) { const t = el("div", "bar-track"), f = el("div", "bar-fill"); f.style.width = Math.max(2, Math.min(100, pct)) + "%"; t.append(f); d.append(t); }
  if (sql) {
    const c = el("button", "copy", "Copy SQL"); c.type = "button";
    c.addEventListener("click", async () => { try { await navigator.clipboard.writeText(sql); c.textContent = "Copied"; setTimeout(() => c.textContent = "Copy SQL", 1200); } catch {} });
    d.append(c, el("pre", "", sql));
  }
  return d;
}
function renderMethods(r) {
  const open = label => { showTab("p-all"); $("allSearch").value = label; allLimit = 100; renderAll(r); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const row = (x, kind) => {
    const d = item(`${x.count} queries · ${fmt(x.totalMs)} ms · ${[...x.models].slice(0, 4).join(", ")}`, x.sample, "", r.statements.length ? x.count / r.statements.length * 100 : null);
    const t = el("div", "title", x.label); t.style.cursor = "pointer"; t.title = "Show these queries"; t.addEventListener("click", () => open(x.label));
    d.insertBefore(t, d.firstChild);
    if (x.chain && x.chain.length > 1) d.insertBefore(el("div", "dev", "Called from: " + x.chain.slice(1).join("  ←  ")), d.children[2]);
    return d;
  };
  const note = $("methodNote");
  note.textContent = r.source === "profile" ? "Exact Python methods, read from the Odoo profiler stack traces." : r.methods.length ? "" :
    "A plain SQL log has no Python stack. Load the Odoo profiler export (JSON) to see the exact method for each query.";
  $("methodHow").hidden = r.methods.length > 0;
  fill("methodList", r.methods, x => row(x, "m"), "No Python methods available for this file.");
  fill("endpointList", r.endpoints, x => row(x, "e"), "No request lines (…/call_kw/model/method) were found in this log.");
  const tb = $("opsTable"); tb.replaceChildren();
  const hr = el("tr"); [["Likely ORM operation", ""], ["Queries", "num"], ["Time (ms)", "num"]].forEach(([h, c]) => hr.append(el("th", c, h))); tb.append(hr);
  r.ops.forEach(o => { const tr = el("tr"); tr.append(el("td", "", o.op), el("td", "num", String(o.count)), el("td", "num", fmt(o.totalMs))); tb.append(tr); });
}
function renderFindings(r) {
  fill("findings", r.findings.filter(f => sevFilter === "all" || f.severity === sevFilter), f => {
    const d = el("div", "item " + f.severity), t = el("div", "title");
    t.append(el("span", "badge " + f.severity, f.severity), document.createTextNode(f.title));
    d.append(t, el("div", "plain", f.plain), el("div", "dev", "For the developer: " + f.dev));
    if (f.sample) d.append(el("pre", "", f.sample)); return d;
  }, "Nothing at this severity.");
}

function render(r) {
  const v = $("verdict"); v.className = "verdict " + r.verdict.cls; v.textContent = r.verdict.text;
  const m = $("metrics"); m.replaceChildren();
  [["SQL statements", r.statements.length, "", "p-all", null], ["Total SQL time", r.totalMs ? fmt(r.totalMs) + " ms" : "n/a", "", "p-time", "timeList"],
   ["Slow queries", r.slow.length, r.slow.length ? "red" : "teal", "p-queries", "slowList"], ["Repeated groups", r.repeated.length, r.repeated.length ? "amber" : "teal", "p-queries", "repeatList"],
   ["Sequential runs", r.sequential.length, r.sequential.length ? "amber" : "teal", "p-queries", "seqList"]]
    .forEach(([k, val, c, tab, anchor]) => {
      const a = el("button", "metric " + c); a.type = "button"; a.title = "Click to view";
      a.append(el("span", "", k), el("strong", "", String(val)), el("small", "", "View →"));
      a.addEventListener("click", () => {
        showTab(tab);
        const t = anchor ? $(anchor).previousElementSibling || $(anchor) : $(tab);
        t.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      m.append(a);
    });
  allLimit = 100; renderAll(r);

  renderFindings(r); renderMethods(r);
  fill("timeList", r.topTime, g => item(`${fmt(g.totalMs)} ms (${r.totalMs ? Math.round(g.totalMs / r.totalMs * 100) : 0}% of SQL time) · ${g.count} runs · max ${fmt(g.maxMs)} ms`, g.sample, "", r.totalMs ? g.totalMs / r.totalMs * 100 : null), "No timing data. Use a log with durations.");
  const tb = $("modelTable"); tb.replaceChildren();
  const hr = el("tr"); [["Model", ""], ["Queries", "num"], ["Time (ms)", "num"], ["", ""]].forEach(([h, c]) => hr.append(el("th", c, h))); tb.append(hr);
  r.models.forEach(x => { const tr = el("tr"); const mc = el("td", "pick", modelName(x.table)); mc.title = "Filter by this model"; mc.addEventListener("click", () => { modelInput.value = modelName(x.table); syncModelUI(); runAnalysis(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    tr.append(mc, el("td", "num", String(x.count)), el("td", "num", fmt(x.totalMs))); const bc = el("td", "bars"), bt = el("div", "bar-track"), bf = el("div", "bar-fill"); bf.style.width = (x.count / r.models[0].count * 100) + "%"; bt.append(bf); bc.append(bt); tr.append(bc); tb.append(tr); });
  fill("slowList", r.slow.slice(0, 10), s => item(`${fmt(s.durationMs)} ms · log line ${s.line}`, s.sql), "No timed query exceeded the threshold.");
  fill("repeatList", r.repeated.slice(0, 10), g => item(`${g.count} executions · total ${fmt(g.totalMs)} ms · max ${fmt(g.maxMs)} ms`, g.sample), "No query repeated 5+ times.");
  fill("seqList", r.sequential.slice(0, 10), q => item(`${q.length} in a row from line ${q.line} · ${fmt(q.totalMs)} ms`, q.sample), "No back-to-back repetition found.");
  fill("heavyList", r.heavy, s => item(`${s.joins} JOIN · ${s.subselects} subselect${s.hasGroup ? " · GROUP BY" : ""}${s.hasOrder ? " · ORDER BY" : ""}${s.durationMs != null ? " · " + fmt(s.durationMs) + " ms" : ""}`, s.sql), "No unusually heavy query shapes.");
  fill("indexList", r.indexes, c => item(`${c.col} · used in ${c.uses} slow/repeated queries${c.wildcard ? " · leading wildcard search" : ""}`, ""), "No candidates.");
}

/* ---------- Report ---------- */
function summaryText(r) {
  return ["Odoo SQL Log Analyzer: summary", r.verdict.text,
    `Statements: ${r.statements.length} | Total SQL time: ${fmt(r.totalMs)} ms | Slow: ${r.slow.length} | Repeated groups: ${r.repeated.length}`, "",
    ...r.findings.map(f => `[${f.severity.toUpperCase()}] ${f.title}\n  ${f.plain}\n  Developer: ${f.dev}`)].join("\n");
}
function downloadReport() {
  if (!report) return;
  const r = report, L = [summaryText(r), "", "TOP TIME CONSUMERS",
    ...r.topTime.map(g => `${fmt(g.totalMs)} ms, ${g.count} runs\n${g.sample}`), "", "MODELS BY QUERY COUNT",
    ...r.models.map(x => `${modelName(x.table)}: ${x.count} queries, ${fmt(x.totalMs)} ms`), "", "SLOW QUERIES",
    ...r.slow.slice(0, 50).map(s => `${s.durationMs} ms (line ${s.line})\n${s.sql}`), "", "REPEATED PATTERNS",
    ...r.repeated.map(g => `${g.count} executions; total ${fmt(g.totalMs)} ms\n${g.sample}`), "", "INDEX CANDIDATES",
    ...r.indexes.map(c => `${c.col} (${c.uses} uses)`), "", "Note: heuristic analysis. Confirm with the Odoo profiler and PostgreSQL EXPLAIN."];
  const url = URL.createObjectURL(new Blob([L.join("\n")], { type: "text/plain" }));
  const a = document.createElement("a"); a.href = url; a.download = "odoo-performance-report.txt"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
