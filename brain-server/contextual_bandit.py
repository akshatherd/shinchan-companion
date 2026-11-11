"""Small persistent LinUCB bandit for propose-now vs stay-quiet decisions."""
import json, math, sqlite3
from pathlib import Path
class LinUCB:
 def __init__(self,path=None,alpha=.65):
  self.alpha=alpha;self.path=path or Path(__file__).with_name('muse_bandit.sqlite3');self.db=sqlite3.connect(self.path,check_same_thread=False);self.db.execute('CREATE TABLE IF NOT EXISTS arm(name TEXT PRIMARY KEY, a TEXT, b TEXT)');self.db.commit()
  for arm in ('propose','quiet'): self._ensure(arm)
 def _ensure(self,arm):
  n=5; self.db.execute('INSERT OR IGNORE INTO arm VALUES(?,?,?)',(arm,json.dumps([[1 if i==j else 0 for j in range(n)] for i in range(n)]),json.dumps([0.]*n)));self.db.commit()
 def _state(self,arm):
  a,b=self.db.execute('SELECT a,b FROM arm WHERE name=?',(arm,)).fetchone();return json.loads(a),json.loads(b)
 def _solve(self,a,b):
  m=[row[:]+[v] for row,v in zip(a,b)];n=len(b)
  for c in range(n):
   pivot=max(range(c,n),key=lambda r:abs(m[r][c]));m[c],m[pivot]=m[pivot],m[c];p=m[c][c] or 1e-9;m[c]=[v/p for v in m[c]]
   for r in range(n):
    if r!=c:
     f=m[r][c];m[r]=[x-f*y for x,y in zip(m[r],m[c])]
  return [r[-1] for r in m]
 def choose(self,context):
  x=self.vector(context); scores={}
  for arm in ('propose','quiet'):
   a,b=self._state(arm);theta=self._solve(a,b);mean=sum(t*v for t,v in zip(theta,x)); inv_cols=[self._solve(a,[1. if i==j else 0. for i in range(5)]) for j in range(5)];unc=math.sqrt(max(0,sum(x[i]*inv_cols[j][i]*x[j] for i in range(5) for j in range(5))));scores[arm]=mean+self.alpha*unc
  return max(scores,key=scores.get)
 def vector(self,c):
  hour=float(c.get('hour',12));minutes=max(0,float(c.get('screen_session_minutes',0)))/60;dismiss=max(0,min(1,float(c.get('recent_dismiss_rate',0))));cat=float(c.get('app_category_id',0))/10
  return [math.sin(2*math.pi*hour/24),math.cos(2*math.pi*hour/24),max(-1,min(1,cat)),max(-1,min(1,minutes)),1-2*dismiss]
 def update(self,context,arm,reward):
  if arm not in ('propose','quiet'):raise ValueError('unknown arm')
  x=self.vector(context);a,b=self._state(arm);r=max(-1,min(1,float(reward)))
  for i in range(5):
   b[i]+=r*x[i]
   for j in range(5):a[i][j]+=x[i]*x[j]
  self.db.execute('UPDATE arm SET a=?,b=? WHERE name=?',(json.dumps(a),json.dumps(b),arm));self.db.commit()
