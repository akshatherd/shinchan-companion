"""Frequent semantic action sequence miner and reusable selector templates."""
from collections import Counter
import re

def normalize_event(event):
 text=(event.get('text') or event.get('contentDescription') or '').strip()
 return {'package':event.get('packageName',''),'view_id':event.get('viewIdResourceName',''),'class':event.get('className',''),'label':text[:120],'event_type':event.get('eventType','')}
def semantic_key(e):
 return e.get('view_id') or (e.get('package','')+'|'+e.get('class','')+'|'+re.sub(r'\d+','{n}',e.get('label','').lower())[:50])
def mine_sequences(traces,min_support=2,max_length=5):
 seqs=[[semantic_key(normalize_event(e)) for e in t] for t in traces];supports=Counter()
 for seq in seqs:
  seen=set()
  for n in range(2,min(max_length,len(seq))+1):
   for i in range(len(seq)-n+1):seen.add(tuple(seq[i:i+n]))
  supports.update(seen)
 return [{'sequence':list(s),'support':count} for s,count in supports.most_common() if count>=min_support]
def synthesize_skill(sequence,labels=None):
 labels=labels or {};steps=[]
 for i,key in enumerate(sequence):
  steps.append({'step':i+1,'action':'select_or_activate','selector':{'semanticKey':key},'input':None,'requiresConfirmation':True})
 return {'skill_name':'_'.join(re.sub(r'[^a-z0-9]+','_',labels.get(k,k).lower()).strip('_')[:18] for k in sequence[:3]),'parameters':{'text':{'type':'string','required':False}},'steps':steps,'source':'recurring_ui_sequence','requiresConfirmation':True}
