"""Local SQLite memory and per-contact style summaries."""
import json, re, sqlite3, time
from pathlib import Path
DB_PATH=Path(__file__).with_name('muse_memory.sqlite3')

class MemoryStore:
 def __init__(self,path=DB_PATH):
  self.db=sqlite3.connect(path,check_same_thread=False);self.db.row_factory=sqlite3.Row
  self.db.executescript('''CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY, contact TEXT, text TEXT, created REAL); CREATE TABLE IF NOT EXISTS style(contact TEXT PRIMARY KEY, slang TEXT, language_mix REAL, emoji_rate REAL, avg_length REAL, samples INTEGER);''');self.db.commit()
 def remember(self,contact,text):
  self.db.execute('INSERT INTO memories(contact,text,created) VALUES(?,?,?)',(contact,text,time.time()));self.db.commit()
 def recent(self,contact='',limit=12):
  rows=self.db.execute('SELECT contact,text,created FROM memories WHERE contact=? ORDER BY created DESC LIMIT ?', (contact,limit)).fetchall()
  return [dict(r) for r in rows]
 def learn_style(self,contact,text):
  words=re.findall(r"[\w']+",text.lower()); emojis=len(re.findall(r'[\U0001F300-\U0001FAFF]',text)); slang=[w for w in words if w in {'lol','brb','btw','yaar','arre','bro','ikr','idk','pls','thx'}]
  row=self.db.execute('SELECT * FROM style WHERE contact=?',(contact,)).fetchone(); n=(row['samples'] if row else 0)+1
  old=lambda k,d: row[k] if row else d
  avg=(old('avg_length',0)*(n-1)+len(text))/n; er=(old('emoji_rate',0)*(n-1)+emojis/max(1,len(words)))/n; mix=(old('language_mix',0)*(n-1)+sum(1 for w in words if w in {'hai','nahi','kya','haan','yaar','acha'})/max(1,len(words)))/n
  slang_all=set(json.loads(old('slang','[]')))|set(slang)
  self.db.execute('INSERT OR REPLACE INTO style VALUES(?,?,?,?,?,?)',(contact,json.dumps(sorted(slang_all)),mix,er,avg,n));self.db.commit()
  return self.style(contact)
 def style(self,contact):
  r=self.db.execute('SELECT * FROM style WHERE contact=?',(contact,)).fetchone()
  return dict(r) if r else {'contact':contact,'slang':'[]','language_mix':0,'emoji_rate':0,'avg_length':0,'samples':0}
