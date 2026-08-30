from pathlib import Path
from bs4 import BeautifulSoup
from urllib.parse import urlparse, unquote
import subprocess, tempfile, json, re, csv, itertools, gzip, hashlib
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
errors=[]; warnings=[]; stats={}

def err(msg): errors.append(msg)
def warn(msg): warnings.append(msg)

# JS parse
js_files=sorted((ROOT/'assets/js').glob('*.js'))
for p in js_files:
    r=subprocess.run(['node','--check',str(p)],capture_output=True,text=True)
    if r.returncode: err(f'JS parse: {p.relative_to(ROOT)}: {r.stderr.strip()}')
stats['javascript_files']=len(js_files)

# HTML / metadata / inline scripts / local refs
html_files=sorted(ROOT.rglob('*.html'))
indexable=[]; inline_count=0; asset_ref_count=0
external_script_no_defer=[]
for p in html_files:
    text=p.read_text(errors='ignore')
    soup=BeautifulSoup(text,'html.parser')
    rel=str(p.relative_to(ROOT))
    if not soup.html or soup.html.get('lang')!='en': err(f'HTML lang missing/not en: {rel}')
    ids=[x.get('id') for x in soup.find_all(id=True)]
    dups=sorted({x for x in ids if ids.count(x)>1})
    if dups: err(f'Duplicate ids {rel}: {dups}')
    robots=soup.find('meta',attrs={'name':'robots'})
    rob=(robots.get('content','') if robots else '').lower()
    is_indexable='noindex' not in rob
    if is_indexable:
        title=(soup.title.string.strip() if soup.title and soup.title.string else '')
        desc=soup.find('meta',attrs={'name':'description'})
        desc=(desc.get('content','').strip() if desc else '')
        can=soup.find('link',rel=lambda x:x and 'canonical' in x)
        canon=can.get('href','') if can else ''
        h1=soup.find_all('h1')
        hreflangs={x.get('hreflang') for x in soup.find_all('link',attrs={'hreflang':True})}
        checks={
          'title': bool(title), 'description': bool(desc), 'canonical': bool(canon), 'h1':len(h1)==1,
          'og:title': bool(soup.find('meta',attrs={'property':'og:title'})),
          'og:description': bool(soup.find('meta',attrs={'property':'og:description'})),
          'og:url': bool(soup.find('meta',attrs={'property':'og:url'})),
          'og:image': bool(soup.find('meta',attrs={'property':'og:image'})),
          'twitter:card': bool(soup.find('meta',attrs={'name':'twitter:card'})),
          'hreflang en': 'en' in hreflangs, 'hreflang x-default':'x-default' in hreflangs,
          'jsonld': bool(soup.find('script',attrs={'type':'application/ld+json'})),
        }
        for k,v in checks.items():
            if not v: err(f'SEO {k} missing/invalid: {rel}')
        if not (20 <= len(title) <= 60): err(f'SEO title length {len(title)}: {rel}')
        if not (100 <= len(desc) <= 165): err(f'SEO description length {len(desc)}: {rel}')
        if canon and not canon.startswith('https://brainilab.com/'): err(f'Canonical host: {rel} -> {canon}')
        indexable.append((rel,canon))
    # scripts
    for i,tag in enumerate(soup.find_all('script')):
        typ=(tag.get('type') or '').lower()
        src=tag.get('src')
        if typ=='application/ld+json':
            try: json.loads(tag.string or '')
            except Exception as e: err(f'JSON-LD {rel} #{i}: {e}')
        elif src:
            if src.startswith(('http://','https://','//')) and 'defer' not in tag.attrs and 'async' not in tag.attrs:
                external_script_no_defer.append((rel,src))
        elif (tag.string or '').strip():
            inline_count+=1
            code=tag.string or ''
            with tempfile.NamedTemporaryFile('w',suffix='.js',delete=False) as tf:
                tf.write(code); tmp=tf.name
            r=subprocess.run(['node','--check',tmp],capture_output=True,text=True)
            Path(tmp).unlink(missing_ok=True)
            if r.returncode: err(f'Inline JS parse {rel} #{i}: {r.stderr.strip()}')
    # local refs: src/href excluding canonical/meta route refs that are external
    for tag,attr in [('script','src'),('img','src'),('link','href'),('a','href'),('source','srcset')]:
        for el in soup.find_all(tag):
            val=el.get(attr)
            if not val: continue
            val=val.split(',')[0].strip().split(' ')[0]
            if val.startswith(('#','mailto:','tel:','javascript:','data:','http://','https://','//')): continue
            path=unquote(val.split('?')[0].split('#')[0])
            if not path: continue
            if path.startswith('/'):
                target=ROOT/path.lstrip('/')
            else:
                target=(p.parent/path).resolve()
            # links to directories resolve to index.html
            if target.is_dir(): target=target/'index.html'
            if not target.exists(): err(f'Broken local ref {rel}: {val}')
            asset_ref_count+=1

if external_script_no_defer: err(f'External scripts without defer/async: {external_script_no_defer}')
stats['html_files']=len(html_files); stats['inline_scripts']=inline_count; stats['local_refs']=asset_ref_count; stats['indexable_pages']=len(indexable)

# Sitemap parity
ns={'s':'http://www.sitemaps.org/schemas/sitemap/0.9'}
try:
    tree=ET.parse(ROOT/'sitemap.xml'); urls={x.text for x in tree.findall('.//s:loc',ns)}
except Exception as e:
    err(f'Sitemap XML parse: {e}'); urls=set()
canon_set={u for _,u in indexable}
if urls!=canon_set:
    err(f'Sitemap/canonical mismatch missing={sorted(canon_set-urls)} extra={sorted(urls-canon_set)}')
stats['sitemap_urls']=len(urls)
robots=(ROOT/'robots.txt').read_text()
if 'Sitemap: https://brainilab.com/sitemap.xml' not in robots: err('robots.txt missing sitemap directive')
if 'User-agent: OAI-SearchBot' not in robots: warn('robots.txt has no explicit OAI-SearchBot rule')

# JSON / SVG / CSV
json_files=sorted(ROOT.rglob('*.json'))
for p in json_files:
    try: json.loads(p.read_text())
    except Exception as e: err(f'JSON parse {p.relative_to(ROOT)}: {e}')
stats['json_files']=len(json_files)
svg_files=sorted(ROOT.rglob('*.svg'))
for p in svg_files:
    try: ET.parse(p)
    except Exception as e: err(f'SVG XML {p.relative_to(ROOT)}: {e}')
stats['svg_files']=len(svg_files)
csv_files=sorted((ROOT/'admin').glob('*.csv'))
for p in csv_files:
    with p.open(newline='',encoding='utf-8-sig') as f:
        rows=list(csv.reader(f))
    if not rows or not rows[0]: err(f'Empty CSV: {p.name}'); continue
    width=len(rows[0])
    for n,row in enumerate(rows[1:],2):
        if len(row)!=width: err(f'CSV width {p.name}:{n} expected {width} got {len(row)}')
stats['csv_templates']=len(csv_files)

# Parse starter puzzle arrays from JS
def parse_puzzles(path, prop='PUZZLES'):
    s=(ROOT/path).read_text()
    m=re.search(rf'const {prop}=(\[.*?\]);\s*\n\s*function all',s,re.S)
    if not m: raise RuntimeError(f'Cannot parse {path}')
    return json.loads(m.group(1))

routes=parse_puzzles('assets/js/number-route-puzzles.js')
seqs=parse_puzzles('assets/js/sequence-puzzles.js')
stats['number_routes']=len(routes); stats['sequences']=len(seqs)
OPS=['+','−','×','÷']
def apply(v,op,n):
    if op=='+': return v+n
    if op=='−': return v-n
    if op=='×': return v*n
    if op=='÷':
        if n==0 or v % n !=0: return None
        return v//n

def eval_route(nums,ops):
    v=nums[0]
    for op,n in zip(ops,nums[1:]):
        v=apply(v,op,n)
        if v is None: return None
    return v

if len(routes)!=40: err(f'Expected 40 Number Routes, got {len(routes)}')
for r in routes:
    if len(r['numbers'])!=4 or any(not isinstance(n,int) or n<1 or n>9 for n in r['numbers']): err(f'Invalid route numbers: {r["id"]}')
    sols=[ops for ops in itertools.product(OPS,repeat=3) if eval_route(r['numbers'],ops)==r['target']]
    if len(sols)!=1: err(f'Route not unique {r["id"]}: {len(sols)} solutions')
    if tuple(r['solution'])!=tuple(sols[0]): err(f'Route stored solution mismatch {r["id"]}: {r["solution"]} vs {sols[0]}')
if len(seqs)!=40: err(f'Expected 40 Sequences, got {len(seqs)}')
for s in seqs:
    if len(s['sequence'])!=5: err(f'Sequence length {s["id"]}')
    if len(s['options'])!=4 or len(set(s['options']))!=4: err(f'Sequence options invalid {s["id"]}')
    if s['answer'] not in s['options']: err(f'Sequence answer absent {s["id"]}')

# Daily rotation: JS + SQL parity, 28 unique unordered pairs over 8 games
datajs=(ROOT/'assets/js/data.js').read_text()
m=re.search(r'const DAILY_VARIABLE_PAIRS=\[(.*?)\];',datajs,re.S)
if not m: err('DAILY_VARIABLE_PAIRS missing'); js_pairs=[]
else: js_pairs=[tuple(x) for x in re.findall(r'\["([a-z]+)","([a-z]+)"\]',m.group(1))]
rot_games={'orderup','topicrush','connections','oddoneout','higherlower','mathrush','numberroute','sequence'}
expected={tuple(sorted(x)) for x in itertools.combinations(sorted(rot_games),2)}
actual={tuple(sorted(x)) for x in js_pairs}
if len(js_pairs)!=28 or len(actual)!=28 or actual!=expected: err(f'Daily JS pair coverage invalid: {len(js_pairs)} rows / {len(actual)} unique')
sql=(ROOT/'BRAINILAB_STEP26_SQL_COPY_TO_SUPABASE.txt').read_text()
sql_pairs=[tuple(x) for x in re.findall(r"when \d+ then array\['([a-z]+)','([a-z]+)'\]::text\[\]",sql)]
if js_pairs!=sql_pairs: err('Daily JS and SQL pair order mismatch')
stats['daily_rotation_pairs']=len(js_pairs)

# Math Rush: local generator runtime smoke, SQL one-digit exact division invariant
node_code=f"""
global.window=global; global.location={{search:''}}; global.document={{}};
eval(require('fs').readFileSync({json.dumps(str(ROOT/'assets/js/math-rush.js'))},'utf8'));
let bad=[]; for(let s=0;s<200;s++){{for(const o of BrainiMathRush.localOperations('qa:'+s)){{if(o.a<1||o.a>9||o.b<1||o.b>9)bad.push(o); if(o.op==='÷' && (o.a%o.b!==0||o.answer!==o.a/o.b))bad.push(o);}}}}
console.log(JSON.stringify({{bad:bad.length}}));
"""
r=subprocess.run(['node','-e',node_code],capture_output=True,text=True)
if r.returncode: err(f'Math Rush local runtime QA failed: {r.stderr}')
else:
    try:
        if json.loads(r.stdout.strip())['bad']!=0: err('Math Rush local generator violates one-digit/exact division rule')
    except Exception as e: err(f'Math Rush local QA output invalid: {e}')
if "v_q:=1+(get_byte(h,2)%(9/v_b)); v_a:=v_b*v_q" not in sql: err('Math Rush SQL one-digit division fix missing')
if "v_q:=1+(get_byte(h,2)%9); v_a:=v_b*v_q" in sql: err('Math Rush SQL old multi-digit division generator still present')
if '["24 ÷ 6",4]' in (ROOT/'assets/js/try-first.js').read_text(): err('Try First Math Rush still uses two-digit operand')

# Try first must not submit / verify / health-track scores
tryjs=(ROOT/'assets/js/try-first.js').read_text()
for forbidden in ['submitGameResult','verify_brainilab_','start_brainilab_content_play','complete_brainilab_content_play']:
    if forbidden in tryjs: err(f'Try First records state unexpectedly: {forbidden}')
for gid in ['brainmix','brainiword','orderup','topicrush','connections','oddoneout','higherlower','mathrush','numberroute','sequence']:
    if gid not in tryjs: err(f'Try First missing game: {gid}')

# New cards / game pages / icons
for gid,label in [('math-rush','Math Rush'),('number-route','Number Route'),('sequence','Sequence')]:
    if not (ROOT/f'games/{gid}/index.html').exists(): err(f'Missing game page {gid}')
    for variant in ['standard','mini','card','mono']:
        if not (ROOT/f'assets/icons/games/{variant}/{gid}.svg').exists(): err(f'Missing icon {gid}/{variant}')
    if label not in (ROOT/'index.html').read_text(): err(f'Home missing {label}')
    if label not in (ROOT/'games/index.html').read_text(): err(f'Games missing {label}')

# Admin content studio + analytics hooks
adminjs=(ROOT/'assets/js/admin.js').read_text()
for token in ['numberroute','sequence','Content Pools','Game Analytics','Health']:
    if token not in adminjs and token not in (ROOT/'admin/index.html').read_text(): err(f'Admin missing token {token}')
for template in ['brainilab_number_route_template.csv','brainilab_sequence_template.csv']:
    if template not in adminjs: err(f'Admin import template not wired: {template}')

# SQL structural / required definitions
if not sql.lstrip().startswith('-- BrainiLab Step 26'): err('Step26 header missing')
if not re.search(r'\bbegin\s*;',sql,re.I): err('Step26 BEGIN missing')
if not re.search(r'\bcommit\s*;\s*$',sql,re.I): err('Step26 COMMIT missing/end invalid')
if sql.count('$$')%2: err('Step26 unbalanced $$ delimiters')
for fn in [
 'brainilab_math_rush_operation','get_brainilab_math_rush_game','verify_brainilab_math_rush_result',
 'brainilab_number_route_solutions','get_brainilab_number_route_game','verify_brainilab_number_route_result',
 'get_brainilab_sequence_game','verify_brainilab_sequence_result','brainilab_daily_game_ids',
 'get_brainilab_daily_number_route','get_brainilab_daily_sequence','admin_import_content_pool',
 'admin_content_health_overview','admin_get_game_analytics'
]:
    if f'function public.{fn}' not in sql: err(f'Step26 missing function {fn}')
if len(re.findall(r"select public\._seed_number_route\('route-",sql))!=40: err('Step26 does not seed 40 Number Routes')
if len(re.findall(r"select public\._seed_sequence\('sequence-",sql))!=40: err('Step26 does not seed 40 Sequences')
# canonical SQL copy parity
sql_src=(ROOT/'supabase/step26_math_logic_daily.sql').read_text()
if sql_src!=sql: err('Step26 canonical SQL and copy-to-Supabase file differ')

# Map Hunt must not be active/currently exposed
for rel in ['index.html','games/index.html','sitemap.xml']:
    if 'Map Hunt' in (ROOT/rel).read_text(): err(f'Map Hunt exposed in {rel}')
if "('maphunt'" in sql or "'maphunt'::text" in sql:
    warn('Step26 contains map-hunt token; verify it is only legacy/cleanup')
# Step24 blocking function expected from prior migration retained in package
step24=(ROOT/'BRAINILAB_STEP24_SQL_COPY_TO_SUPABASE.txt').read_text()
if 'brainilab_block_deprecated_game_sessions' not in step24 or "new.game_id='maphunt'" not in step24:
    err('Map Hunt server-side block missing from Step24')

# Build/cache/version markers
pkg=json.loads((ROOT/'package.json').read_text())
if pkg.get('version')!='41.8.0': err('package version not 41.8.0')
if '41.8.0' not in (ROOT/'assets/js/build.js').read_text(): err('BRAINI_BUILD not 41.8.0')
if 'brainilab-static-v41-8-0' not in (ROOT/'sw.js').read_text(): err('Service worker cache version not V41.8.0')
if 'max-age=31536000' not in (ROOT/'_headers').read_text(): warn('Long-lived static asset cache headers missing')
# Production bundles generated from source by checking exact concatenation via rebuild helper, but do not mutate here.
r=subprocess.run(['python3',str(ROOT/'tools/rebuild-bundles.py')],cwd=ROOT,capture_output=True,text=True)
if r.returncode: err(f'Bundle rebuild failed: {r.stderr}')
# re-check bundles after rebuild
for name in ['shell.bundle.js','cloud.bundle.js','quiz.bundle.js','daily.bundle.js','daily-overview.bundle.js','home.bundle.js','games.bundle.js']:
    r=subprocess.run(['node','--check',str(ROOT/'assets/js'/name)],capture_output=True,text=True)
    if r.returncode: err(f'Bundle parse after rebuild {name}: {r.stderr.strip()}')

# Lightweight transfer budget report (gzip static local core)
def gz(path): return len(gzip.compress((ROOT/path).read_bytes(),9))
stats['home_core_gzip_kb']=round(sum(gz(x) for x in ['assets/css/site.css','assets/css/mobile.css','assets/js/shell.bundle.js','assets/js/cloud.bundle.js','assets/js/home.bundle.js'])/1024,1)
stats['daily_core_gzip_kb']=round(sum(gz(x) for x in ['assets/css/site.css','assets/css/mobile.css','assets/js/shell.bundle.js','assets/js/cloud.bundle.js','assets/js/daily-overview.bundle.js'])/1024,1)
max_asset=max((p.stat().st_size,p) for p in (ROOT/'assets').rglob('*') if p.is_file())
stats['largest_asset_kb']=round(max_asset[0]/1024,1); stats['largest_asset']=str(max_asset[1].relative_to(ROOT))
if stats['home_core_gzip_kb']>130: warn(f'Home local core gzip budget high: {stats["home_core_gzip_kb"]} KB')


# V41.8 specific regression checks
step27=(ROOT/'BRAINILAB_STEP27_SQL_COPY_TO_SUPABASE.txt').read_text()
step27_src=(ROOT/'supabase/step27_daily_replay_stats_numberroute_connections.sql').read_text()
if step27!=step27_src: err('Step27 canonical SQL and copy-to-Supabase file differ')
if not step27.lstrip().startswith('-- BrainiLab Step 27'): err('Step27 header missing')
if not re.search(r'\bbegin\s*;',step27,re.I): err('Step27 BEGIN missing')
if not re.search(r'\bcommit\s*;',step27,re.I): err('Step27 COMMIT missing')
if step27.count('$$')%2: err('Step27 unbalanced $$ delimiters')
for fn in [
 'brainilab_analytics_category','get_brainilab_connections_game','verify_brainilab_connections_result',
 'get_brainilab_daily_number_route','verify_brainilab_number_route_result','submit_brainilab_game_result'
]:
    if f'function public.{fn}' not in step27: err(f'Step27 missing function {fn}')

# Connections: 20 rounds Anytime, 3 Daily.
conn=(ROOT/'assets/js/connections.js').read_text()
if 'const DAILY_ROUNDS=3,ANYTIME_ROUNDS=20' not in conn: err('Connections client round split missing')
if 'limit 20' not in step27: err('Connections SQL Anytime limit 20 missing')
if 'v_expected_rounds:=3' not in step27 or 'v_expected_rounds:=20' not in step27: err('Connections SQL 3/20 verifier split missing')
if '20 rounds in Play Anytime and 3 rounds when selected for the Daily' not in (ROOT/'games/connections/index.html').read_text(): err('Connections page copy not updated')

# Number Route Daily: exactly 3 rounds, speed scoring, 2,500 cap.
nr=(ROOT/'assets/js/number-route.js').read_text()
for token in ['DAILY_ROUNDS=3','ANYTIME_ROUNDS=10','dailySpeedPoints','3 routes · faster solves earn more points']:
    if token not in nr: err(f'Number Route Daily client missing {token}')
if '834 + 833 + 833 = exactly 2,500 maximum Daily points' not in step27: err('Number Route server speed scoring missing 2500 cap')
if "and d.position between 1 and 3" not in step27: err('Number Route Daily SQL does not limit to 3 assignments')

# Daily replay lock: local client idempotency + cloud lock.
datajs=(ROOT/'assets/js/data.js').read_text()
if 'dailyReplayBlocked:true' not in datajs: err('Local Daily replay lock missing')
if 'pg_advisory_xact_lock' not in step27: err('Cloud Daily replay race lock missing')
if "and gs.daily_number=p_daily_number" not in step27: err('Cloud Daily duplicate query missing')

# Daily Journey must hide Try First and Play once a game is complete.
journey=(ROOT/'assets/js/daily-journey.js').read_text()
if 'Completed today · result locked ✓' not in journey: err('Daily completed lock UI missing')
complete_branch=re.search(r'\$\{complete\s*\?\s*`<div class="daily-journey-completed-lock".*?\n\s*:\s*`<div class="daily-journey-actions">',journey,re.S)
if not complete_branch: err('Daily Journey completed branch structure missing')
if 'daily-journey-try' not in journey: err('Try First action missing for unplayed Daily games')
# rebuilt bundle parity for this behavior
for bundle in ['assets/js/daily.bundle.js','assets/js/home.bundle.js','assets/js/daily-overview.bundle.js']:
    bt=(ROOT/bundle).read_text()
    if 'Completed today · result locked ✓' not in bt: err(f'Rebuilt bundle missing completed lock: {bundle}')

# Try First uses the actual game route + archive batch, is invisible to results/health/state.
tryjs=(ROOT/'assets/js/try-first.js').read_text()
tryrt=(ROOT/'assets/js/try-first-runtime.js').read_text()
health=(ROOT/'assets/js/content-health.js').read_text()
if 'archive:' not in tryjs or 'try:"1"' not in tryjs: err('Try First does not redirect to full archive-mode game')
if 'Same rules and full gameplay as the scored Daily' not in tryjs: err('Try First full-game copy missing')
if 'get("try")==="1"' not in datajs or 'tryFirst:true' not in datajs: err('Try First result persistence bypass missing')
if 'get("try")==="1"' not in health: err('Try First Health bypass missing')
if 'TRY_FIRST_MODE' not in (ROOT/'assets/js/order-up.js').read_text(): err('Order Up Try First resume-state isolation missing')
if 'TRY_FIRST_MODE' not in (ROOT/'assets/js/topic-rush.js').read_text(): err('Topic Rush Try First resume-state isolation missing')
if 'tryFirstMode' not in (ROOT/'games/brainiword/index.html').read_text(): err('BrainiWord Try First state isolation missing')

# Past Daily replay is integrated into Games cards, not a separate archive grid.
games_html=(ROOT/'games/index.html').read_text()
games_js=(ROOT/'assets/js/games-library.js').read_text()
if 'archive-games-grid' in games_html or 'archive-games-grid' in games_js: err('Old separate Past Daily grid still present')
if 'data-daily-archive-date' not in games_html: err('Games Past Daily date picker missing')
for gid in ['brainmix','brainiword','orderup','topicrush','connections','oddoneout','higherlower','mathrush','numberroute','sequence']:
    if f'data-past-daily-action="{gid}"' not in games_html: err(f'Games card missing Past Daily action: {gid}')
if '#past-dailies' in ''.join((ROOT/p).read_text(errors='ignore') for p in ['games/brain-mix/index.html','games/brainiword/index.html','assets/js/order-up.js','assets/js/topic-rush.js']): err('Obsolete #past-dailies anchor remains')
if 'const DAILY_LAUNCH_DATE="2026-08-29"' not in games_js: err('Past Daily launch date is not official Daily #1')

# Date-dependent local fallbacks for rotating content.
for rel in ['assets/js/connections.js','assets/js/odd-one-out.js','assets/js/higher-lower.js','assets/js/number-route.js','assets/js/sequence.js']:
    txt=(ROOT/rel).read_text()
    if 'seedHash' not in txt or '${key}:${' not in txt: err(f'Date-seeded Daily fallback missing: {rel}')

# My Stats: current game catalogue, no Latest Results block.
statsjs=(ROOT/'assets/js/stats-ui.js').read_text()
profile_bundle=(ROOT/'assets/js/profile.bundle.js').read_text()
for gid in ['connections','survival','oddoneout','higherlower','mathrush','numberroute','sequence','sports']:
    if gid not in statsjs: err(f'My Stats missing current game {gid}')
for forbidden in ['Your latest results','RECENT ACTIVITY','recentMarkup']:
    if forbidden in statsjs or forbidden in profile_bundle: err(f'My Stats obsolete recent results remains: {forbidden}')
if 'GAME PERFORMANCE' not in statsjs or 'Your BrainiLab games' not in statsjs: err('My Stats game-performance section not updated')

# Runtime JS syntax after V41.8 patches.
for rel in ['assets/js/daily-completion-guard.js','assets/js/connections.js','assets/js/odd-one-out.js','assets/js/higher-lower.js','assets/js/number-route.js','assets/js/sequence.js']:
    r=subprocess.run(['node','--check',str(ROOT/rel)],capture_output=True,text=True)
    if r.returncode: err(f'V41.8 JS parse {rel}: {r.stderr.strip()}')

stats['step27_lines']=len(step27.splitlines())
stats['connections_anytime_rounds']=20
stats['connections_daily_rounds']=3
stats['numberroute_daily_rounds']=3

print(json.dumps({'ok':not errors,'errors':errors,'warnings':warnings,'stats':stats},indent=2,ensure_ascii=False))
raise SystemExit(1 if errors else 0)

