#!/usr/bin/env python3
# usage: check.py submissions.jsonl [mode] -> сводка по типам полей
import json,sys,collections
import os; D=os.path.dirname(os.path.abspath(__file__)); exp=json.load(open(D+'/expected.json',encoding='utf8'))
subs={}
for l in open(sys.argv[1],encoding='utf8'):
    r=json.loads(l); subs[r['page']]=r['data']   # последняя отправка
norm=lambda v:(v or '').strip() if isinstance(v,str) else v
agg=collections.defaultdict(lambda:[0,0]); rows=[]
for page,fields in exp.items():
    got=subs.get(page)
    for k,(typ,want) in fields.items():
        v=None if got is None else got.get(k)
        if typ=='file': ok=isinstance(v,dict) and v.get('filename')==want and v.get('size',0)>0
        elif want is None: ok=got is not None and (v in (None,''))
        else: ok=norm(v)==want
        agg[typ][0]+=ok; agg[typ][1]+=1; rows.append((page,k,typ,want,v,ok))
mode=sys.argv[2] if len(sys.argv)>2 else ''
out={'mode':mode,'submitted':sorted(subs),'by_type':{t:f'{a}/{b}' for t,(a,b) in agg.items()},
     'total':f"{sum(a for a,b in agg.values())}/{sum(b for a,b in agg.values())}",'fields':[dict(page=p,field=k,type=t,want=w,got=g,ok=o) for p,k,t,w,g,o in rows]}
print(json.dumps(out,ensure_ascii=False,indent=1))
