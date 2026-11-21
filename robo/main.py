"""Robô do Fluxo CMRP — roda no GitHub Actions a cada 10 minutos.

Para cada conta LocaWeb conectada pelo app:
  1. decifra a senha (só o robô tem a chave),
  2. lê por IMAP, SOMENTE LEITURA, a Caixa de Entrada e os Enviados desde a última rodada,
  3. aplica as regras do fluxo (fluxo.Motor) e grava no Firestore,
  4. gera o PDF das aprovações novas e atualiza as máquinas.

Os registros (logs) mostram só contagens: nada de assunto, nome, valor ou senha.
"""
import base64
import email
import html
import imaplib
import json
import os
import re
import sys
import traceback
from datetime import datetime, timedelta, timezone
from email import policy
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from zoneinfo import ZoneInfo

import firebase_admin
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from config_padrao import CONFIG_GERAL, OBRAS
from fluxo import Motor, casar_maquina, numero_bm, periodo_texto, proximo_periodo
from store_firestore import StoreFirestore

TZ = ZoneInfo('America/Sao_Paulo')
MAX_POR_PASTA = 400
VERSAO = '1.0'
MESES_IMAP = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def log(*a):
    print(datetime.now(TZ).strftime('%d/%m %H:%M:%S'), *a, flush=True)


# ------------------------------------------------------------------ chaves

def chaves_do_robo(db):
    """Par de chaves RSA do robô. A chave privada fica no Firestore CIFRADA com o segredo ROBO_SEGREDO
    (que só existe no cofre do GitHub). A pública vai para config/robo e o app usa para trancar as senhas."""
    segredo = os.environ['ROBO_SEGREDO'].encode()
    ref = db.collection('segredos').document('robo')
    snap = ref.get()
    if snap.exists:
        d = snap.to_dict()
        key = Scrypt(salt=base64.b64decode(d['salt']), length=32, n=2 ** 15, r=8, p=1).derive(segredo)
        pem = AESGCM(key).decrypt(base64.b64decode(d['nonce']), base64.b64decode(d['cifrado']), None)
        return serialization.load_pem_private_key(pem, password=None)
    log('Gerando chaves do robô (primeira execução)')
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    salt, nonce = os.urandom(16), os.urandom(12)
    key = Scrypt(salt=salt, length=32, n=2 ** 15, r=8, p=1).derive(segredo)
    ref.set({'salt': base64.b64encode(salt).decode(), 'nonce': base64.b64encode(nonce).decode(),
             'cifrado': base64.b64encode(AESGCM(key).encrypt(nonce, pem, None)).decode(), 'criadoEm': firestore.SERVER_TIMESTAMP})
    pub = priv.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
    db.collection('config').document('robo').set({'publicKey': pub, 'algoritmo': 'RSA-OAEP-256'}, merge=True)
    return priv


def decifrar_senha(priv, b64):
    return priv.decrypt(base64.b64decode(b64), padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)).decode()


# ------------------------------------------------------------------ IMAP

def _texto_html(h):
    h = re.sub(r'(?is)<(script|style|head).*?</\1>', ' ', h)
    h = re.sub(r'(?i)<br\s*/?>|</(p|div|tr|li|h\d|table|blockquote)>', '\n', h)
    h = re.sub(r'<[^>]+>', ' ', h)
    h = html.unescape(h)
    h = re.sub(r'[ \t\xa0]+', ' ', h)
    return '\n'.join(l.strip() for l in h.splitlines())


def corpo(msg):
    try:
        parte = msg.get_body(preferencelist=('plain', 'html'))
        if parte is None:
            return ''
        txt = parte.get_content()
        return _texto_html(txt) if parte.get_content_type() == 'text/html' else txt
    except Exception:
        return ''


def para_msg(raw, pasta):
    m = email.message_from_bytes(raw, policy=policy.default)
    try:
        d = parsedate_to_datetime(m['date']).astimezone(TZ)
    except Exception:
        d = datetime.now(TZ)
    nome, de = parseaddr(str(m['from'] or ''))
    return {
        'pasta': pasta, 'de': (de.lower(), nome), 'assunto': str(m['subject'] or ''),
        'para': [a.lower() for _, a in getaddresses([str(x) for x in m.get_all('to', [])]) if a],
        'cc': [a.lower() for _, a in getaddresses([str(x) for x in m.get_all('cc', [])]) if a],
        'data': d.strftime('%Y-%m-%dT%H:%M'), 'corpo': corpo(m),
    }


def _q(nome):
    return '"' + nome.replace('"', '\\"') + '"'


def pastas_imap(M):
    out = []
    typ, data = M.list()
    for ln in data or []:
        s = ln.decode(errors='replace') if isinstance(ln, bytes) else str(ln)
        mm = re.match(r'\((?P<f>[^)]*)\)\s+(?P<d>"[^"]*"|NIL)\s+(?P<n>.+)$', s)
        if mm:
            out.append((mm.group('f'), mm.group('n').strip().strip('"')))
    return out


def pasta_enviados(M, preferida):
    if preferida:
        return preferida
    ps = pastas_imap(M)
    for f, n in ps:
        if '\\Sent' in f:
            return n
    for f, n in ps:
        if re.search(r'(enviad|sent)', n, re.I):
            return n
    return None


def ler_conta(cfg, email_conta, senha, estado):
    imap = cfg.get('imap', {})
    M = imaplib.IMAP4_SSL(imap.get('host', 'email-ssl.com.br'), int(imap.get('porta', 993)), timeout=60)
    try:
        M.login(email_conta, senha)
        sent = pasta_enviados(M, imap.get('pastaEnviados'))
        msgs, novo = [], {}
        desde = datetime.now(TZ) - timedelta(days=int(cfg.get('diasIniciais', 20)))
        for chave_p, nome, tipo in (('INBOX', 'INBOX', 'in'), ('SENT', sent, 'sent')):
            if not nome:
                continue
            typ, _ = M.select(_q(nome), readonly=True)  # EXAMINE: não marca nada como lido
            if typ != 'OK':
                continue
            uv = M.response('UIDVALIDITY')[1]
            uidvalidity = int(uv[0]) if uv and uv[0] else 0
            st = estado.get(chave_p) or {}
            ultimo = int(st.get('ultimoUid') or 0) if st.get('uidvalidity') == uidvalidity else 0
            crit = f'UID {ultimo + 1}:*' if ultimo else f'SINCE {desde.day:02d}-{MESES_IMAP[desde.month - 1]}-{desde.year}'
            typ, data = M.uid('SEARCH', None, crit)
            uids = sorted(int(x) for x in (data[0].split() if data and data[0] else []) if int(x) > ultimo)[-MAX_POR_PASTA:]
            log(f'{chave_p}: {len(uids)} e-mails novos')
            for j in range(0, len(uids), 25):
                lote = ','.join(str(u) for u in uids[j:j + 25])
                typ, data = M.uid('FETCH', lote, '(BODY.PEEK[]<0.150000>)')  # só o começo: texto sem anexos pesados
                for item in data or []:
                    if isinstance(item, tuple) and len(item) == 2:
                        try:
                            msgs.append(para_msg(item[1], tipo))
                        except Exception:
                            pass
            novo[chave_p] = {'uidvalidity': uidvalidity, 'ultimoUid': max(uids) if uids else ultimo, 'nome': nome}
        return msgs, novo
    finally:
        try:
            M.logout()
        except Exception:
            pass


# ------------------------------------------------------------------ PDFs e máquinas

def gerar_pdf(db, p, obras_por_codigo):
    import pdf as gerador
    pasta = (obras_por_codigo.get(p.get('obra')) or {}).get('pasta') or p.get('obra')
    quem = p.get('aprovadoPor') or 'UICF'
    rotulo = 'Ubirajara Filho (UICF)' if quem == 'UICF' else quem
    texto = f'{rotulo}: “{p.get("aprovacao") or "Autorizado"}”'
    nome, dados = gerador.gera(p, texto, pasta)
    ref = db.collection('processos').document(p['id'])
    ref.collection('arquivo').document('pdf').set({'nome': nome, 'base64': base64.b64encode(dados).decode(), 'tamanho': len(dados),
                                                   'criadoEm': firestore.SERVER_TIMESTAMP})
    ref.update({'pdf': {'nome': nome, 'pasta': pasta, 'tamanho': len(dados)}})


def atualizar_maquina(db, p, maquinas):
    if p.get('tipo') != 'BM':
        return False
    cand = [m for m in maquinas if m.get('obra') == p.get('obra')] or maquinas
    mq = casar_maquina(p['assunto'], cand)
    if not mq:
        return False
    prox = proximo_periodo(p['assunto'], mq.get('periodicidade'))
    upd = {'ultimo': {'bm': numero_bm(p['assunto']), 'periodo': periodo_texto(p['assunto']), 'aprovadoEm': p['aprovadoEm'], 'processo': p['id']},
           'status': 'em_dia', 'atualizadoEm': datetime.now(TZ).strftime('%Y-%m-%dT%H:%M')}
    if prox:
        n = re.search(r'\d+', upd['ultimo']['bm'])
        upd['proximo'] = {'bm': f'BM {int(n.group(0)) + 1:02d}' if n else 'Próximo BM', **prox}
    db.collection('equipamentos').document(mq['id']).update(upd)
    mq.update(upd)
    return True


def manutencao(db, cfg, store):
    hoje = datetime.now(TZ).date()
    tol = int(cfg.get('maquinas', {}).get('diasTolerancia', 5))
    n = 0
    for d in db.collection('equipamentos').where(filter=FieldFilter('status', '==', 'em_dia')).stream():
        mq = d.to_dict()
        fim = (mq.get('proximo') or {}).get('fim')
        if not fim or (mq.get('periodicidade') or '').lower().startswith(('diar', 'avul')):
            continue
        try:
            dt = datetime.strptime(fim, '%d/%m/%Y').date()
        except ValueError:
            continue
        if hoje > dt + timedelta(days=tol):
            d.reference.update({'status': 'faltando'})
            for adm in store.admins():
                store.aviso(adm, 'BM faltando', f'{mq.get("maquina")} — {mq.get("proximo", {}).get("bm", "")} fechou em {fim}', d.id)
            n += 1
    # lembretes de "A responder"
    dias = int(cfg.get('avisos', {}).get('diasLembreteResponder', 2))
    limite = (datetime.now(TZ) - timedelta(days=dias)).strftime('%Y-%m-%dT%H:%M')
    for d in db.collection('responder').where(filter=FieldFilter('status', '==', 'aguardando')).stream():
        r = d.to_dict()
        if r.get('recebidoEm', '9') < limite:
            parado = (datetime.now(TZ).replace(tzinfo=None) - datetime.fromisoformat(r['recebidoEm'])).days
            store.aviso(r['dono'], f'Sem resposta há {parado} dias', f'{r.get("deNome")}: {r.get("assunto")}', d.id)
    # pedidos de acesso pendentes
    for d in db.collection('usuarios').where(filter=FieldFilter('status', '==', 'pendente')).stream():
        u = d.to_dict()
        for adm in store.admins():
            store.aviso(adm, 'Novo pedido de acesso', f'{u.get("nome")} (matrícula {u.get("matricula")})', d.id)
    return n


# ------------------------------------------------------------------ principal

def inicializar(db):
    if not db.collection('config').document('geral').get().exists:
        db.collection('config').document('geral').set(CONFIG_GERAL)
        log('config/geral criada com os valores iniciais')
    if not list(db.collection('obras').limit(1).stream()):
        for o in OBRAS:
            db.collection('obras').document(o['codigo']).set(o)
        log(f'{len(OBRAS)} obras iniciais cadastradas')


def main():
    cred = credentials.Certificate(json.loads(os.environ['FIREBASE_SERVICE_ACCOUNT']))
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    inicializar(db)
    priv = chaves_do_robo(db)
    cfg = db.collection('config').document('geral').get().to_dict()
    obras = [dict(d.to_dict(), codigo=d.id) for d in db.collection('obras').stream()]
    obras_cod = {o['codigo']: o for o in obras}
    usuarios = {d.id: d.to_dict() for d in db.collection('usuarios').stream()}
    contas = {d.id: d.to_dict() for d in db.collection('contas').stream()}
    contas_por_email = {}
    for uid, c in contas.items():
        u = usuarios.get(uid) or {}
        if u.get('status') == 'ativo' and c.get('emailLocaweb'):
            contas_por_email[c['emailLocaweb'].lower()] = {'uid': uid, 'nome': u.get('nome') or c['emailLocaweb'].split('@')[0],
                                                          'email': c['emailLocaweb'].lower(), 'incluirCopia': c.get('incluirCopia', True)}
    store = StoreFirestore(db)
    maquinas = [dict(d.to_dict(), id=d.id) for d in db.collection('equipamentos').stream()]
    total_msgs = total_aprov = total_pdf = total_maq = erros = 0

    for uid, c in contas.items():
        u = usuarios.get(uid) or {}
        if u.get('status') != 'ativo' or not u.get('podeConectar') or not c.get('senhaCifrada'):
            continue
        ref = db.collection('contas').document(uid)
        try:
            senha = decifrar_senha(priv, c['senhaCifrada'])
            msgs, novo_estado = ler_conta(cfg, c['emailLocaweb'], senha, c.get('pastas') or {})
            del senha
            conta = contas_por_email[c['emailLocaweb'].lower()]
            motor = Motor(cfg, obras, store, conta, contas_por_email)
            for m in sorted(msgs, key=lambda x: x['data']):
                try:
                    motor.processar(m)
                except Exception:
                    erros += 1
                    log('erro ao processar uma mensagem:', traceback.format_exc().splitlines()[-1])
            store.gravar()
            for pid in dict.fromkeys(motor.novos_aprovados):
                p = store.get_proc(pid)
                if p and not p.get('pdf'):
                    try:
                        gerar_pdf(db, p, obras_cod)
                        p['pdf'] = True
                        total_pdf += 1
                    except Exception:
                        log('erro ao gerar PDF:', traceback.format_exc().splitlines()[-1])
                if p and atualizar_maquina(db, p, maquinas):
                    total_maq += 1
            total_msgs += len(msgs)
            total_aprov += len(set(motor.novos_aprovados))
            ref.update({'pastas': novo_estado, 'estado': 'ok', 'erro': firestore.DELETE_FIELD,
                        'ultimaLeitura': datetime.now(TZ).strftime('%Y-%m-%dT%H:%M')})
            log(f'conta ok: {len(msgs)} e-mails lidos')
        except imaplib.IMAP4.error:
            erros += 1
            ref.update({'estado': 'erro', 'erro': 'A LocaWeb recusou o login. A senha mudou? Reconecte em Minha conta.'})
            store.aviso(uid, 'Falha ao ler seu e-mail', 'A LocaWeb recusou o login. Reconecte sua conta no app.', 'conta')
            store.gravar()
            log('conta com falha de login')
        except Exception:
            erros += 1
            ref.update({'estado': 'erro', 'erro': 'Não foi possível ler o e-mail nesta rodada. O robô tenta de novo em 10 minutos.'})
            log('conta com erro:', traceback.format_exc().splitlines()[-1])

    faltando = manutencao(db, cfg, store)
    store.gravar()
    db.collection('config').document('robo').set({
        'ultimaRodada': datetime.now(TZ).strftime('%Y-%m-%dT%H:%M'), 'versao': VERSAO,
        'resumo': {'emails': total_msgs, 'aprovacoes': total_aprov, 'pdfs': total_pdf, 'maquinas': total_maq,
                   'faltando': faltando, 'erros': erros, 'contas': len(contas_por_email)}}, merge=True)
    log(f'fim: {total_msgs} e-mails, {total_aprov} aprovações, {total_pdf} PDFs, {total_maq} máquinas, {erros} erros')
    return 0


if __name__ == '__main__':
    sys.exit(main())
