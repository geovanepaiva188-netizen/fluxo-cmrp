"""Store do motor usando o Firestore (Admin SDK). Agrupa as gravações e grava no fim da conta."""
import hashlib
from datetime import datetime, timezone

from google.cloud.firestore_v1.base_query import FieldFilter


class StoreFirestore:
    def __init__(self, db):
        self.db = db
        self._procs, self._resps = {}, {}
        self._sujos_p, self._sujos_r = set(), set()
        self._avisos = {}
        self._chaves_p, self._chaves_r = set(), set()
        self._admins = [d.id for d in db.collection('usuarios')
                        .where(filter=FieldFilter('papel', '==', 'admin'))
                        .where(filter=FieldFilter('status', '==', 'ativo')).stream()]

    # ---- processos
    def _carregar_chave_p(self, k):
        if k in self._chaves_p:
            return
        for d in self.db.collection('processos').where(filter=FieldFilter('chave', '==', k)).stream():
            self._procs[d.id] = dict(d.to_dict(), id=d.id)
        self._chaves_p.add(k)

    def get_proc(self, i):
        if i not in self._procs:
            d = self.db.collection('processos').document(i).get()
            if d.exists:
                self._procs[i] = dict(d.to_dict(), id=i)
        return self._procs.get(i)

    def put_proc(self, p):
        self._procs[p['id']] = p
        self._sujos_p.add(p['id'])

    def procs_por_chave(self, k):
        self._carregar_chave_p(k)
        return [p for p in self._procs.values() if p.get('chave') == k]

    # ---- a responder
    def get_resp(self, i):
        if i not in self._resps:
            d = self.db.collection('responder').document(i).get()
            if d.exists:
                self._resps[i] = dict(d.to_dict(), id=i)
        return self._resps.get(i)

    def put_resp(self, r):
        self._resps[r['id']] = r
        self._sujos_r.add(r['id'])

    def resp_por_chave(self, dono, k):
        if (dono, k) not in self._chaves_r:
            q = (self.db.collection('responder').where(filter=FieldFilter('dono', '==', dono))
                 .where(filter=FieldFilter('chave', '==', k)))
            for d in q.stream():
                self._resps.setdefault(d.id, dict(d.to_dict(), id=d.id))
            self._chaves_r.add((dono, k))
        return [r for r in self._resps.values() if r.get('dono') == dono and r.get('chave') == k]

    # ---- avisos
    def aviso(self, para, titulo, texto, ref=None):
        i = 'a_' + hashlib.sha1(f'{para}|{ref}|{titulo}|{texto}'.encode()).hexdigest()[:18]
        self._avisos[i] = {'para': para, 'titulo': titulo, 'texto': texto, 'ref': ref, 'lido': False,
                           'em': datetime.now(timezone.utc).isoformat()}

    def admins(self):
        return self._admins

    def processos_sujos(self):
        return [self._procs[i] for i in self._sujos_p]

    # ---- gravação
    def gravar(self):
        ops = []
        for i in self._sujos_p:
            d = {k: v for k, v in self._procs[i].items() if k != 'id'}
            ops.append((self.db.collection('processos').document(i), d))
        for i in self._sujos_r:
            d = {k: v for k, v in self._resps[i].items() if k != 'id'}
            ops.append((self.db.collection('responder').document(i), d))
        for i, a in self._avisos.items():
            ref = self.db.collection('avisos').document(i)
            if not ref.get().exists:  # não reabre aviso já lido
                ops.append((ref, a))
        n = 0
        for j in range(0, len(ops), 400):
            b = self.db.batch()
            for ref, d in ops[j:j + 400]:
                b.set(ref, d)  # documento completo (o robô leu a versão atual nesta rodada)
                n += 1
            b.commit()
        self._sujos_p.clear()
        self._sujos_r.clear()
        self._avisos.clear()
        return n
