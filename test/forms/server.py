#!/usr/bin/env python3
# Локальный стенд форм: отдаёт страницы, принимает POST, пишет в submissions.jsonl. Наружу ничего не уходит.
import http.server, json, os, sys, urllib.parse, time
from email.parser import BytesParser
from email.policy import HTTP
D=os.path.dirname(os.path.abspath(__file__)); OUT=os.environ.get('FORMS_OUT', os.path.join(D,'submissions.jsonl'))
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s,*a,**k): super().__init__(*a,directory=os.path.join(D,'pages'),**k)
    def do_POST(s):
        ct=s.headers.get('Content-Type',''); body=s.rfile.read(int(s.headers.get('Content-Length',0)))
        pairs=[]
        if ct.startswith('multipart/'):
            msg=BytesParser(policy=HTTP).parsebytes(b'Content-Type: '+ct.encode()+b'\r\n\r\n'+body)
            for part in msg.iter_parts():
                name=part.get_param('name',header='content-disposition'); fn=part.get_filename()
                pl=part.get_payload(decode=True) or b''
                pairs.append((name, {'filename':fn,'size':len(pl)} if fn is not None else pl.decode('utf8','replace')))
        else:
            pairs=urllib.parse.parse_qsl(body.decode('utf8'),keep_blank_values=True)
        data={}
        for k,v in pairs:
            if k in data: data[k]=(data[k] if isinstance(data[k],list) else [data[k]])+[v]
            else: data[k]=v
        page=urllib.parse.urlparse(s.path).path.strip('/')
        with open(OUT,'a',encoding='utf8') as f: f.write(json.dumps({'page':page,'ts':time.time(),'data':data},ensure_ascii=False)+'\n')
        s.send_response(200); s.send_header('Content-Type','text/html; charset=utf-8'); s.end_headers()
        s.wfile.write(f'<html><head><title>Отправлено</title></head><body><h1>Форма «{page}» отправлена</h1><pre>{json.dumps(data,ensure_ascii=False,indent=1)}</pre></body></html>'.encode())
    def log_message(s,*a): pass
http.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[1]) if len(sys.argv)>1 else 8765),H).serve_forever()
