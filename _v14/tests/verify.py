from html.parser import HTMLParser
from pathlib import Path
import json,hashlib,subprocess
class Page(HTMLParser):
 def __init__(self):super().__init__();self.ids=[];self.refs=[];self.links=[];self.tags=[]
 def handle_starttag(self,t,a):
  a=dict(a);self.tags.append(t)
  if 'id'in a:self.ids.append(a['id'])
  for k in ['src','href','poster']:
   if k in a:self.refs.append(a[k])
p=Path('dist');h=Page();h.feed((p/'index.html').read_text());assert len(h.ids)==len(set(h.ids));assert h.tags.count('main')==1
for ref in h.refs:
 if ref.startswith('#'):assert ref[1:] in h.ids,ref
 elif not ref.startswith(('https:','http:')):assert(p/ref).is_file(),ref
m=p/'assets/notch-v13.mp4';sha=hashlib.sha256(m.read_bytes()).hexdigest();assert sha=='6fc253ce2cf495e2ec9f922495da372e4a9ec914146c8546a9dc618c2845f073'
v=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height,nb_frames,r_frame_rate,color_range,color_space,color_transfer,color_primaries','-of','json',str(m)]))['streams'][0]
assert(v['width'],v['height'],v['nb_frames'],v['r_frame_rate'])==(1350,1890,'482','24/1');assert v['color_range']=='pc' and v['color_space']=='bt709' and v['color_transfer']=='iec61966-2-1'
print('PASS local asset/fragment targets, unique IDs, exact V13 master and full-range color metadata')
Path('qa/source-verification.json').write_text(json.dumps({'masterSha256':sha,'video':v,'localTargets':'pass','status':'Source checks only; actual browser QA separate'},indent=2))
html=(p/'index.html').read_text();css=(p/'styles.css').read_text()
import re
assert not re.search(r'<br>(?=\S)',html), 'Responsive line breaks must preserve word whitespace'
assert '.research-index nav{display:grid;grid-template-columns:1fr;gap:0;overflow:visible}' in css
assert 'autoplay' not in html and ' loop' not in html
assert 'clip-path:polygon(' in css
print('PASS responsive text-space, non-scrolling narrow navigation, manual media and non-destructive icon surround crop regressions')
assert 'class="skip" href="#hero-title"' in html and 'h1 id="hero-title" tabindex="-1"' in html
assert '.paper-section a:focus-visible' in css and 'outline-color:var(--rust)' in css
print('PASS skip-navigation focus target and higher-contrast paper focus indicator')
