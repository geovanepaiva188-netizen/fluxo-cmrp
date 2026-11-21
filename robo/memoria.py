"""Store em memória (para testes e para simular uma rodada sem Firestore)."""
import hashlib


class StoreMemoria:
    def __init__(self, admins=None):
        self.procs, self.resps, self.avisos = {}, {}, {}
        self._admins = admins or []

    def get_proc(self, i):
        return self.procs.get(i)

    def put_proc(self, p):
        self.procs[p['id']] = p

    def procs_por_chave(self, k):
        return [p for p in self.procs.values() if p.get('chave') == k]

    def get_resp(self, i):
        return self.resps.get(i)

    def put_resp(self, r):
        self.resps[r['id']] = r

    def resp_por_chave(self, dono, k):
        return [r for r in self.resps.values() if r.get('dono') == dono and r.get('chave') == k]

    def aviso(self, para, titulo, texto, ref=None):
        i = 'a_' + hashlib.sha1(f'{para}|{ref}|{titulo}|{texto}'.encode()).hexdigest()[:18]
        self.avisos[i] = {'para': para, 'titulo': titulo, 'texto': texto, 'ref': ref, 'lido': False}

    def admins(self):
        return self._admins
