# SQL-Log-Analyzer

Odoo SQL Log Analyzer
A Chrome extension that turns raw Odoo / PostgreSQL SQL logs into plain-language performance findings. It is built so functional team members can read the results, and developers get a hint on where to look next.
Everything runs locally in your browser. Your log is never uploaded anywhere, and the extension requests no permissions.

What it detects
Area	How it is detected
Slow SQL queries	Queries with duration at or above the slow threshold (default 500 ms), ranked by duration
Repeated SQL / N+1	Queries with the same shape (values replaced by ?) executed 5 or more times
Query count by model	Every table is mapped to a model name (sale_order_line becomes sale.order.line) and counted
Large total duration	Top query patterns by total time and their share of all SQL time
Sequential queries	5 or more identical queries back-to-back, with the starting log line
Large JOIN / GROUP BY	4+ JOINs, 2+ subselects, GROUP BY over several tables, or ORDER BY without LIMIT on joined queries
Missing indexes	Columns filtered on in slow or repeated queries are listed as candidates to investigate
Queries inside loops	Repeated queries are classified as create-in-loop, write-in-loop, search_count in loop, browse-by-id, or search-in-loop, each with a fix hint

Indexes are suggestions to investigate with EXPLAIN, not proof that an index is missing.

Install
1.	Put these files in one folder: manifest.json, background.js, popup.html, popup.js, popup.css.
2.	Open chrome://extensions.
3.	Turn on Developer mode (top right).
4.	Click Load unpacked and choose the folder.
5.	Click the extension icon. The analyzer opens in a full browser tab. It does not use the small popup, because Chrome closes popups when the file picker opens.
After changing any file, click the reload icon on the extension card at chrome://extensions. Always replace all files together, not just one.

How to capture a good log
Odoo SQL log (shows the queries):
odoo-bin ... --log-level=debug_sql

or --log-handler=odoo.sql_db:DEBUG
PostgreSQL slow-query log (adds timings):
log_min_duration_statement = 100   # ms; reload PostgreSQL afterwards

Lines such as duration: 512.3 ms statement: SELECT ... are read automatically.
Tips:
·	Reproduce one slow action only (one screen, one button, one report) so the log stays focused.
·	Without duration: ... ms values the tool still finds repeated, sequential and heavy-shape problems, but slow-query and time-share checks show n/a / 0.

Using the tool
1.	Choose the log: drag a .log, .txt or .sql file onto the drop zone, or click it to browse.
2.	(Optional) Model filter: type a model, e.g. product.template. The box suggests every model found in your log with its query count.
o	Exact match by default: sale.order shows only the sale_order table.
o	Wildcard: sale.order* also includes sale.order.line.
o	Several models: separate with commas, e.g. product.template, sale.order.
o	You can also click any model name in Time & models > Queries per model.
3.	(Optional) Query type: tick or untick SELECT, INSERT (create), UPDATE (write), DELETE (unlink). Each shows how many queries of that type exist for the current model. Odoo's unlink() runs as SQL DELETE, so there is no separate unlink type. Queries starting with WITH count as SELECT.
4.	Set the slow threshold (ms) if 500 is not right for you.
5.	Click Analyze. Changing the model, type or threshold re-runs instantly without re-reading the file.
Reading the results
·	Verdict banner: green (healthy), amber (inefficiencies), red (serious issues).
·	Metric cards (clickable):
o	SQL statements opens All queries
o	Total SQL time opens Time & models
o	Slow queries / Repeated groups / Sequential runs open Queries, scrolled to that section
·	Tabs
o	Findings: plain-language explanation plus a "For the developer" hint. Filter by High / Medium / Low.
o	All queries: every query in the current view, numbered, with type, model, duration, log line, a search box and Show more paging (100 first, then 200 at a time).
o	Time & models: where the time goes, and queries per model with bars.
o	Queries: slowest, repeated, back-to-back, and heavy-shape queries.
o	Indexes: columns to investigate.
·	Copy SQL on any query card, Copy summary for pasting into a ticket, Download report for a .txt file.
Severity rules
Finding	High when
Slow query	Duration is at least 5x the threshold (otherwise Medium)
Repeated query	50+ executions, or total time at or above the threshold (otherwise Medium)
Sequential run	30+ identical queries in a row (otherwise Medium)
Heavy shape	Always Medium
Index candidate	Always Low

The verdict is red if any finding is High, amber if any is Medium, otherwise green.

Files
File	Purpose
manifest.json	Chrome Manifest V3 definition. No popup, no permissions.
background.js	Opens popup.html in a new tab when the icon is clicked
popup.html	The page layout
popup.css	Styling, including automatic dark mode
popup.js	Log parser, analysis engine, rendering, filters


How parsing works
·	A new log record starts at a line beginning with a timestamp (YYYY-MM-DD hh:mm), a line containing duration: ... ms, or a line starting with SELECT / INSERT / UPDATE / DELETE / WITH. Other lines are treated as continuation of the previous record (multi-line SQL).
·	The SQL is taken from after a marker such as statement:, query: or execute <name>:.
·	Queries are normalised for grouping: string literals, numbers and parameters (%s, $1) become ?, and IN (?, ?, ?) lists collapse to (?).
·	Tables are read from FROM, JOIN, UPDATE and INTO. A query touching several tables counts for every model involved.

Limitations
·	The log contains SQL only, not Python call stacks. The tool can name the model involved but not the exact Python method. Use the Odoo profiler (Developer mode) for method-level attribution.
·	Model names are guessed from table names by replacing _ with .. Models whose real names contain underscores may display slightly differently.
·	SQL extraction is heuristic. Unusual log formats may be missed; if "No SQL statements recognised" appears, check the log level.
·	Findings are hints. Confirm with EXPLAIN (ANALYZE, BUFFERS) on a safe reproduction before changing indexes or code.
·	Very large logs are handled, but the All queries list is paged to keep the page responsive.

Troubleshooting
Problem	Fix
File picker closes the window or nothing happens	Use the full-tab version (this one). Make sure manifest.json has no default_popup.
Red message: "popup.html is out of date (missing: ...)"	popup.html and popup.js are from different versions. Replace all files, then reload the extension.
Cannot read properties of null	Same cause as above.
"Could not load icon" at chrome://extensions	Remove the icons block from the manifest, or add the PNG files it points to.
Total SQL time shows n/a, Slow queries shows 0	The log has no duration: ... ms values. Enable log_min_duration_statement.
"No SQL statements recognised"	Enable --log-level=debug_sql, or check that the file is the right log.
Report text has literal \n	You are on an old popup.js. Replace it.
Changes do not appear	Reload the extension at chrome://extensions and refresh the analyzer tab.


Common fixes the findings point to
Pattern in the log	Typical Odoo fix
Same SELECT ... WHERE id = ? many times	browse(ids) once, or prefetch before the loop
Same SELECT ... WHERE field = ? LIMIT 1 many times	One search() with ('field', 'in', ids), then group in Python
Repeated COUNT(*)	_read_group() instead of search_count() inside a loop
Many single-row INSERT	create() with a list of dicts
Many single-row UPDATE	One write() on the whole recordset
Slow query with a filter column	Check the plan; consider index=True on the field
ILIKE '%text%' on a big table	Consider a pg_trgm GIN index, or avoid contains-search
Heavy GROUP BY / many JOINs	Narrow the domain, use a stored computed field, or a SQL view for reports


Privacy
The log is read with the browser's File API and analysed in memory on your machine. There are no network requests, no external scripts, no analytics, and no stored data. Closing the tab discards everything.

Version history
·	2.1 Redesigned UI (drop zone, tabs, severity chips, dark mode, bars), model filter, query-type filter, clickable metric cards, All queries tab with search and paging, Copy SQL.
·	2.0 Full analysis engine: slow, N+1, sequential, heavy shapes, index candidates, plain-language findings. Runs in a full tab.
·	1.0 Initial popup version.
