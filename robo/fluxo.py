"""Regras do fluxo de aprovação (sem IMAP e sem Firestore, para poder testar).

O Motor recebe mensagens já lidas (dicionários) de UMA conta conectada e aplica
as mudanças num "store" (Firestore em produção, dicionário nos testes).
"""
import hashlib
import re
import unicodedata
from datetime import datetime, timedelta

# ---------------------------------------------------------------- texto

PREFIXO = re.compile(r'^\s*((re|res|enc|fw|fwd|tr|rv|ref)\s*:\s*)+', re.I)
REV = re.compile(r'[\s\-–—(]*\brev\.?\s*0*(\d{1,3})\)?\s*$', re.I)
MESES = {'janeiro': 1, 'fevereiro': 2, 'marco': 3, 'abril': 4, 'maio': 5, 'junho': 6, 'julho': 7,
         'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12,
         'jan': 1, 'feb': 2, 'fev': 2, 'mar': 3, 'apr': 4, 'abr': 4, 'may': 5, 'mai': 5, 'jun': 6,
         'jul': 7, 'aug': 8, 'ago': 8, 'sep': 9, 'set': 9, 'oct': 10, 'out': 10, 'nov': 11, 'dec': 12, 'dez': 12}


def sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s or '') if unicodedata.category(c) != 'Mn')


def norm(s):
    s = sem_acento(s or '').lower()
    s = re.sub(r'[–—_·•|]', '-', s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def eh_resposta(assunto):
    return bool(PREFIXO.match(assunto or ''))


def chave(assunto):
    """Assunto sem RE:/ENC:/Fwd:, sem 'REV05' no fim, normalizado. Liga e-mails da mesma cadeia."""
    s = PREFIXO.sub('', assunto or '')
    s = norm(s)
    s = PREFIXO.sub('', s)
    s = REV.sub('', s)
    s = re.sub(r'[^a-z0-9/]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def revisao(assunto):
    m = REV.search(norm(PREFIXO.sub('', assunto or '')))
    return int(m.group(1)) if m else None


def limpar_assunto(assunto):
    return re.sub(r'\s+', ' ', PREFIXO.sub('', assunto or '')).strip()


MARCAS_CITACAO = [
    r'^\s*(de|from)\s*:\s*\S',
    r'^\s*-{2,}\s*(mensagem original|original message|mensagem encaminhada|forwarded message)',
    r'^\s*em .{3,120}escreveu\s*:?\s*$',
    r'^\s*on .{3,120}wrote\s*:?\s*$',
    r'^\s*in[ií]cio da mensagem encaminhada',
    r'^\s*begin forwarded message',
    r'^\s*>',
]
_CIT = re.compile('|'.join(MARCAS_CITACAO), re.I)
ASSINATURA = re.compile(r'^\s*(atenciosamente|att\.?,?|abs\.?,?|grato|obrigad[oa]|--\s*$|enviado (do|via|pelo)|sent from|ubirajara filho\s*$)', re.I)


def topo(texto):
    """Texto escrito pela pessoa, antes do e-mail citado."""
    linhas = []
    for ln in (texto or '').splitlines():
        if _CIT.match(ln):
            break
        linhas.append(ln)
    return '\n'.join(linhas).strip()


def recado(texto, limite=400):
    """Topo sem assinatura, em uma linha."""
    out = []
    for ln in topo(texto).splitlines():
        if ASSINATURA.match(ln):
            break
        if ln.strip():
            out.append(ln.strip())
    s = ' '.join(out)
    return (s[:limite] + '…') if len(s) > limite else s


def tem_palavra(texto_norm, palavras):
    for p in palavras:
        p = norm(p)
        if not p:
            continue
        if re.search(r'(?<![a-z0-9])' + re.escape(p) + r'(?![a-z0-9])', texto_norm):
            return p
    return None


NEGACAO = re.compile(r'\b(nao|sem)\s+(esta\s+)?(autorizad|aprovad|liberad)')


def classificar(texto_topo, cfg):
    """'aprovado' | 'devolvido' | None"""
    t = norm(texto_topo)
    if not t:
        return None
    if NEGACAO.search(t):
        return 'devolvido'
    if tem_palavra(t, cfg.get('palavrasAprovacao', [])):
        return 'aprovado'
    if len(t) <= 20 and re.fullmatch(r'\W*(ok|okay|ciente)\W*', t):
        return 'aprovado'
    if tem_palavra(t, cfg.get('palavrasDevolucao', [])):
        return 'devolvido'
    return None


PEDIDO = re.compile(r'(solicit\w*\s+(a\s+|sua\s+)?(aprova|autoriza|avalia)|para\s+(aprova|autoriza|avalia)|segue\s+para\s+(aprova|autoriza)|peco\s+(a\s+)?(aprova|autoriza)|solicito\s+aprova)')


def eh_pedido(texto):
    return bool(PEDIDO.search(norm(texto)))


VALOR = [
    re.compile(r'valor\s+total\s*[:=]?\s*(r\$\s*[\d\.]+,\d{2})', re.I),
    re.compile(r'total\s+do\s+dd\s*[:=]?\s*(r\$\s*[\d\.]+,\d{2})', re.I),
    re.compile(r'total\s+geral\s*[:=]?\s*(r\$\s*[\d\.]+,\d{2})', re.I),
    re.compile(r'^\s*valor\s*[:=]?\s*(r\$\s*[\d\.]+,\d{2})\s*$', re.I | re.M),
]


def extrair_valor(texto):
    t = topo(texto) or texto or ''
    for rx in VALOR:
        m = rx.search(t)
        if m:
            v = re.sub(r'\s+', ' ', m.group(1)).upper().replace('R$ ', 'R$ ').replace('R$', 'R$ ').replace('  ', ' ')
            return v
    return None


def para_data(s):
    """Lê datas escritas em português/inglês nos cabeçalhos citados. Devolve 'aaaa-mm-ddThh:mm' ou None."""
    t = norm(s)
    m = re.search(r'(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})\D+(\d{1,2}):(\d{2})', t)
    if m and m.group(2) in MESES:
        return f"{int(m.group(3)):04d}-{MESES[m.group(2)]:02d}-{int(m.group(1)):02d}T{int(m.group(4)):02d}:{m.group(5)}"
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})\D+(\d{1,2}):(\d{2})', t)
    if m:
        return f"{int(m.group(3)):04d}-{int(m.group(2)):02d}-{int(m.group(1)):02d}T{int(m.group(4)):02d}:{m.group(5)}"
    m = re.search(r'(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})\D+(\d{1,2}):(\d{2})', t)
    if m and m.group(2) in MESES:
        return f"{int(m.group(3)):04d}-{MESES[m.group(2)]:02d}-{int(m.group(1)):02d}T{int(m.group(4)):02d}:{m.group(5)}"
    m = re.search(r'([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\D+(\d{1,2}):(\d{2})', t)
    if m and m.group(1) in MESES:
        return f"{int(m.group(3)):04d}-{MESES[m.group(1)]:02d}-{int(m.group(2)):02d}T{int(m.group(4)):02d}:{m.group(5)}"
    return None


EMAIL = re.compile(r'[\w\.\-+]+@[\w\.\-]+\.\w+')


def cabecalhos_citados(texto):
    """[(quem_texto, email_ou_None, data_iso)] dos e-mails citados no corpo (cadeia encaminhada)."""
    linhas = (texto or '').splitlines()
    res = []
    for i, ln in enumerate(linhas):
        m = re.match(r'^\s*(de|from)\s*:\s*(.+)$', ln, re.I)
        if m:
            quem = m.group(2)
            em = EMAIL.search(quem)
            data = None
            for nxt in linhas[i + 1:i + 6]:
                if re.match(r'^\s*(data|date|enviada em|enviado em|sent)\s*:', nxt, re.I):
                    data = para_data(nxt)
                    break
            if data:
                res.append((quem, em.group(0).lower() if em else None, data))
            continue
        m = re.match(r'^\s*em\s+(.+?\d{1,2}:\d{2}),?\s+(.+?)\s+escreveu', ln, re.I)
        if m:
            data = para_data(m.group(1))
            em = EMAIL.search(m.group(2))
            if data:
                res.append((m.group(2), em.group(0).lower() if em else None, data))
    return res


def detectar_obra(assunto, obras):
    """obras: [{codigo, aliases:[...]}]. Devolve codigo ou None (maior apelido encontrado vence)."""
    t = ' ' + re.sub(r'[^a-z0-9]+', ' ', norm(assunto)) + ' '
    melhor, tam = None, 0
    for o in obras:
        if o.get('ativa') is False:
            continue
        for a in [o.get('codigo', '')] + list(o.get('aliases') or []):
            a2 = re.sub(r'[^a-z0-9]+', ' ', norm(a)).strip()
            if a2 and (' ' + a2 + ' ') in t and len(a2) > tam:
                melhor, tam = o['codigo'], len(a2)
    return melhor


TIPOS_PADRAO = [
    ('DD', r'\bdd\b'), ('BM', r'\b(bm|boletim de medicao|medicao)\b'), ('OC', r'\b(oc|ordem de compra)\b'),
    ('Caução', r'(caucao|controle de (combustivel|abastecimento)|prestacao de contas)'),
    ('Admissão', r'(admiss|mudanca de funcao|insalubridade|contratacao)'),
    ('Locação', r'(locacao|aluguel)'), ('NF', r'\b(nf|nfs-?e|nota fiscal|fatura|faturas|reembolso)\b'),
    ('Acesso', r'\bacesso'), ('Ajuste SGN', r'ajuste de sgn'),
]


def detectar_tipo(assunto, tipos=None):
    t = norm(assunto)
    for nome, rx in (tipos or TIPOS_PADRAO):
        if re.search(rx, t):
            return nome
    return 'Outros'


RH = re.compile(r'(admiss|mudanca de funcao|insalubridade|exame|aso\b|dispensa|demiss|afastamento|ferias|salario|rescis)')


def eh_rh(assunto, tipo):
    return tipo == 'Admissão' or bool(RH.search(norm(assunto)))


# ---------------------------------------------------------------- documentos do DP / RH

DP_PADRAO = {
    'remetentes': ['dp@cearamendes.com.br', 'rh@cearamendes.com.br'],
    'diasIniciais': 120,
    'tipos': [
        {'nome': 'Contracheque', 'palavras': ['contracheque', 'contracheques', 'contra-cheque', 'contra cheque', 'holerite',
                                              'recibo de pagamento', 'folha de pagamento', 'adiantamento quinzenal',
                                              'adiantamento salarial']},
        {'nome': 'Ponto', 'palavras': ['folha de ponto', 'folhas de ponto', 'espelho de ponto', 'espelhos de ponto',
                                       'cartao de ponto', 'cartoes de ponto', 'ponto eletronico', 'registro de ponto']},
        {'nome': 'Rescisão', 'palavras': ['rescisao', 'rescisorio', 'rescisorios', 'documentos rescisorios', 'aviso previo',
                                          'comunicado de dispensa']},
    ],
}
# termos curtos para a busca no servidor (o classificador acima confirma depois)
DP_BUSCA = ['contracheque', 'contra-cheque', 'contra cheque', 'holerite', 'ponto', 'adiantamento', 'rescis', 'aviso pr', 'dispensa',
            'folha de pagamento', 'recibo de pagamento']


def cfg_dp(cfg):
    c = dict(DP_PADRAO)
    c.update({k: v for k, v in (cfg.get('documentosDP') or {}).items() if v not in (None, [], '')})
    return c


def tipos_dp(assunto, corpo, de, cfg):
    """Lista de tipos (ex.: ['Contracheque', 'Ponto']) ou [] se não for documento do DP/RH."""
    c = cfg_dp(cfg)
    t = norm(limpar_assunto(assunto))
    achados = [tp['nome'] for tp in c['tipos'] if tem_palavra(t, tp.get('palavras') or [])]
    if not achados and (de or '').lower() in {e.lower() for e in c.get('remetentes') or []}:
        inicio = norm((topo(corpo) or corpo or '')[:400])
        achados = [tp['nome'] for tp in c['tipos'] if tem_palavra(inicio, tp.get('palavras') or [])]
    return achados


MESES_NOMES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro',
               'novembro', 'dezembro']


def competencia(assunto, corpo=''):
    """Mês de referência 'aaaa-mm' escrito no assunto (ou no começo do texto)."""
    for txt in (assunto or '', (topo(corpo) or corpo or '')[:500]):
        t = norm(txt)
        m = re.search(r'(?<![\d/])(0?[1-9]|1[0-2])\s*/\s*(20\d{2})(?!\d)', t)
        if m:
            return f'{m.group(2)}-{int(m.group(1)):02d}'
        m = re.search(r'\b(' + '|'.join(MESES_NOMES) + r')\b\s*(?:de|/|-)?\s*(20\d{2})', t)
        if m:
            return f'{m.group(2)}-{MESES_NOMES.index(m.group(1)) + 1:02d}'
    return None


def did(mid, de, data, assunto):
    return 'd_' + hashlib.sha1((mid or f'{de}|{data}|{assunto}').encode(errors='replace')).hexdigest()[:18]


def pid(chave_, solicitante, ciclo=''):
    return 'p_' + hashlib.sha1(f'{chave_}|{solicitante}|{ciclo}'.encode()).hexdigest()[:18]


def rid(dono, chave_, remetente):
    return 'r_' + hashlib.sha1(f'{dono}|{chave_}|{remetente}'.encode()).hexdigest()[:18]


def agora_iso():
    return datetime.now().strftime('%Y-%m-%dT%H:%M')


# ---------------------------------------------------------------- motor

FINAIS = ('aprovado', 'encerrado')


class Motor:
    def __init__(self, cfg, obras, store, conta, contas_por_email):
        """
        cfg: config/geral
        conta: {'uid','email','nome','incluirCopia'}
        contas_por_email: {email: {'uid','nome'}} de todas as contas conectadas
        store: objeto com get_proc, put_proc, procs_por_chave, get_resp, put_resp, resp_por_chave, aviso
        """
        self.cfg, self.obras, self.s, self.conta, self.contas = cfg, obras, store, conta, contas_por_email
        self.etapas_base = [a['nome'] for a in cfg.get('aprovadores', [])]
        self.mapa = {}  # email -> nome da etapa
        for a in cfg.get('aprovadores', []) + cfg.get('etapasIniciais', []):
            for e in a.get('emails', []):
                self.mapa[e.lower()] = a['nome']
        hoje = datetime.now().strftime('%Y-%m-%d')
        for sub in cfg.get('substitutos', []):
            if (sub.get('de') or '0000') <= hoje <= (sub.get('ate') or '9999'):
                for e in sub.get('emails', []):
                    self.mapa[e.lower()] = sub['titular']
        self.iniciais = [a['nome'] for a in cfg.get('etapasIniciais', [])]
        resp = cfg.get('responder', {})
        self.remetentes = {e.lower() for e in resp.get('remetentes', [])}
        self.modo_resp = resp.get('modo', 'tudo')
        self.palavras_resp = resp.get('palavras', ['?', 'favor', 'solicito', 'pendente', 'precisamos', 'preciso', 'poderia', 'urgente'])
        self.novos_aprovados = []

    # ----- utilidades
    def etapa_de(self, email):
        return self.mapa.get((email or '').lower())

    def _quem_nome(self, email, nome):
        c = self.contas.get((email or '').lower())
        return (c or {}).get('nome') or nome or (email or '').split('@')[0]

    def _visiveis(self, p):
        p.setdefault('copias', [])
        if self.conta.get('incluirCopia', True) and self.conta['uid'] not in p['copias'] and p.get('dono') != self.conta['uid']:
            p['copias'].append(self.conta['uid'])

    def _avisar(self, p, titulo, texto):
        alvos = {p.get('dono')} | set(p.get('copias') or [])
        for a in alvos:
            if a:
                self.s.aviso(a, titulo, texto, p.get('id'))

    def _etapa(self, p, nome):
        for e in p['etapas']:
            if e['quem'] == nome:
                return e
        return None

    def _idx(self, p, nome):
        for i, e in enumerate(p['etapas']):
            if e['quem'] == nome:
                return i
        return -1

    # ----- entrada
    def processar(self, m):
        """m: {pasta:'in'|'sent', de:(email,nome), para:[emails], cc:[emails], data:'aaaa-mm-ddThh:mm', assunto, corpo, id}"""
        de = (m['de'][0] or '').lower()
        dest = [d.lower() for d in m.get('para', []) + m.get('cc', [])]
        k = chave(m['assunto'])
        if not k:
            return
        if m.get('soDP'):  # busca retroativa: só documentos do DP, sem mexer nos fluxos
            tipos = tipos_dp(m['assunto'], m['corpo'], de, self.cfg)
            if tipos:
                self._doc_dp(m, de, k, tipos)
            return
        # 1) mensagem de um aprovador ligada a um pedido existente
        if self.etapa_de(de):
            self._resposta_aprovador(m, de, dest, k)
            return
        # 2) pedido novo (enviado pela conta OU recebido em cópia)
        primeiras = ([self.etapas_base[0]] if self.etapas_base else []) + self.iniciais
        para_primeira = [d for d in dest if self.etapa_de(d) in primeiras]
        if para_primeira and (not eh_resposta(m['assunto']) or revisao(m['assunto'])) and eh_pedido(topo(m['corpo']) or m['corpo']):
            self._pedido(m, de, k, self.etapa_de(para_primeira[0]))
            return
        # 3) solicitante respondendo um pedido devolvido (reenvio pela mesma conversa)
        if eh_resposta(m['assunto']) and any(self.etapa_de(d) for d in dest):
            for p in self.s.procs_por_chave(k):
                if p.get('solicitanteEmail') == de and p.get('status') in ('devolvido', 'conferir'):
                    self._reenvio(p, m, 'Reenviado pela mesma conversa')
                    return
        # 4) contracheques, folhas de ponto e rescisões: aba própria, não entram em "A responder"
        tipos = tipos_dp(m['assunto'], m['corpo'], de, self.cfg)
        if tipos:
            self._doc_dp(m, de, k, tipos)
        # 5) "A responder"
        elif m['pasta'] == 'in' and de in self.remetentes:
            self._responder_entrada(m, de, k)
        if m['pasta'] == 'sent' and eh_resposta(m['assunto']):
            self._responder_saida(m, k, dest)

    # ----- pedidos
    def _pedido(self, m, de, k, primeira):
        solicitante = de
        existentes = [p for p in self.s.procs_por_chave(k) if p.get('solicitanteEmail') == solicitante]
        mesmo = [p for p in existentes if p.get('envio') == m['data'] or p.get('reenviadoEm') == m['data']]
        if mesmo:  # mesmo e-mail visto por outra conta: só passa a aparecer para esta conta também
            p = mesmo[0]
            antes = list(p.get('copias') or [])
            self._visiveis(p)
            if p['copias'] != antes:
                self.s.put_proc(p)
            return
        abertos = [p for p in existentes if p.get('status') not in FINAIS]
        if abertos:
            p = sorted(abertos, key=lambda x: x.get('envio', ''))[-1]
            if m['data'] > p.get('envio', ''):
                rv = revisao(m['assunto'])
                self._reenvio(p, m, f'Revisão REV{rv:02d} substitui o envio anterior' if rv else 'Reenviado')
                v = extrair_valor(m['corpo'])
                if v:
                    p['valor'] = v
                p['assunto'] = limpar_assunto(m['assunto'])
                self.s.put_proc(p)
            return
        ciclo = m['data'] if existentes else ''
        conta_sol = self.contas.get(solicitante)
        etapas = ([{'quem': primeira, 'status': 'pendente'}] if primeira in self.iniciais else []) + \
                 [{'quem': n, 'status': 'pendente'} for n in self.etapas_base]
        assunto = limpar_assunto(m['assunto'])
        tipo = detectar_tipo(assunto, self.cfg.get('tiposRegex'))
        obra = detectar_obra(assunto, self.obras)
        p = {
            'id': pid(k, solicitante, ciclo), 'chave': k, 'assunto': assunto, 'tipo': tipo,
            'obra': obra or 'SEM_OBRA', 'rh': eh_rh(assunto, tipo),
            'solicitanteEmail': solicitante, 'por': self._quem_nome(solicitante, m['de'][1]),
            'dono': conta_sol['uid'] if conta_sol else None, 'copias': [],
            'envio': m['data'], 'etapas': etapas, 'status': 'pendente', 'direto': False,
            'valor': extrair_valor(m['corpo']), 'obs': [], 'historico': [{'tipo': 'envio', 'em': m['data']}],
            'fonte': 'robo', 'atualizadoEm': agora_iso(),
        }
        self._visiveis(p)
        if not obra:
            p['obs'].append('Obra não identificada no assunto — escolha a obra no app')
            for adm in self.s.admins():
                self.s.aviso(adm, 'Obra não identificada', assunto, p['id'])
        self.s.put_proc(p)

    def _reenvio(self, p, m, motivo):
        primeira_idx = 0
        for i, e in enumerate(p['etapas']):
            if e['status'] == 'devolvido':
                primeira_idx = i
                break
        else:
            primeira_idx = 0 if p.get('status') != 'pendente' else None
        if primeira_idx is not None:
            for e in p['etapas'][primeira_idx:]:
                e['status'] = 'pendente'
                e.pop('em', None)
        p['status'] = 'pendente'
        p['direto'] = False
        p.setdefault('historico', []).append({'tipo': 'reenvio', 'em': m['data']})
        p.setdefault('obs', []).append(f'{motivo} em {m["data"][8:10]}/{m["data"][5:7]} {m["data"][11:]}')
        p['reenviadoEm'] = m['data']
        p['atualizadoEm'] = agora_iso()
        self._visiveis(p)
        self.s.put_proc(p)

    # ----- respostas dos aprovadores
    def _alvo(self, k, m):
        cand = [p for p in self.s.procs_por_chave(k) if p.get('envio', '') <= m['data']]
        if not cand:
            return None
        meus = [p for p in cand if p.get('dono') == self.conta['uid'] or self.conta['uid'] in (p.get('copias') or [])]
        cand = meus or cand
        abertos = [p for p in cand if p.get('status') not in FINAIS]
        return sorted(abertos or cand, key=lambda x: x.get('envio', ''))[-1]

    def _resposta_aprovador(self, m, de, dest, k):
        p = self._alvo(k, m)
        if not p:
            return
        quem = self.etapa_de(de)
        i = self._idx(p, quem)
        if i < 0:
            if quem in self.iniciais:  # ex.: Matheus entrou no meio
                p['etapas'].insert(0, {'quem': quem, 'status': 'pendente'})
                i = 0
            else:
                return
        e = p['etapas'][i]
        if e['status'] == 'ok' and p.get('status') in FINAIS:
            return
        if e.get('em') == m['data'] and e['status'] in ('ok', 'devolvido'):
            return  # mesmo e-mail já visto por outra conta
        texto_topo = topo(m['corpo'])
        cls = classificar(texto_topo, self.cfg)
        etapas_dest = {self.etapa_de(d) for d in dest} - {None}
        proximas = {x['quem'] for x in p['etapas'][i + 1:]}
        encaminhou = bool(etapas_dest & proximas)
        # horários citados das etapas anteriores (ex.: Fwd final do UICF)
        for quem_txt, email, data in cabecalhos_citados(m['corpo']):
            nome = self.etapa_de(email) if email else None
            if not nome:
                for a in self.cfg.get('aprovadores', []) + self.cfg.get('etapasIniciais', []):
                    if norm(a['nome']) in norm(quem_txt):
                        nome = a['nome']
                        break
            if nome and nome != quem:
                j = self._idx(p, nome)
                if 0 <= j < i and p['etapas'][j]['status'] in ('pendente', 'ok') and not p['etapas'][j].get('em'):
                    p['etapas'][j].update({'status': 'ok', 'em': data})
        mudou = False
        if cls == 'devolvido' and not encaminhou:
            e.update({'status': 'devolvido', 'em': m['data']})
            p['status'] = 'devolvido'
            msg = recado(m['corpo'], 300)
            p.setdefault('obs', []).append(f'{quem} devolveu: {msg}')
            p.setdefault('historico', []).append({'tipo': 'devolucao', 'quem': quem, 'em': m['data'], 'texto': msg})
            self._avisar(p, f'Devolvido por {quem}', f'{p["assunto"]} — “{msg[:140]}”')
            mudou = True
        elif cls == 'aprovado' or encaminhou:
            e.update({'status': 'ok', 'em': m['data']})
            for anterior in p['etapas'][:i]:
                if anterior['status'] == 'pendente':
                    anterior['status'] = 'ok'
            ultima = (i == len(p['etapas']) - 1)
            direto = (not encaminhou and cls == 'aprovado' and i == self._primeira_base(p) and not ultima
                      and self.cfg.get('permitirAprovacaoDireta', True))
            if ultima or direto:
                p['status'] = 'aprovado'
                p['aprovadoEm'] = m['data']
                p['aprovacao'] = recado(m['corpo'], 300) or 'Autorizado'
                p['aprovadoPor'] = quem
                p['direto'] = bool(direto)
                if direto:
                    p.setdefault('obs', []).append(f'Aprovado diretamente por {quem}')
                self.novos_aprovados.append(p['id'])
                self._avisar(p, f'{quem} aprovou', f'{p["assunto"]}' + (f' — {p["valor"]}' if p.get('valor') else ''))
            else:
                if p.get('direto'):
                    p['direto'] = False
                    p['status'] = 'pendente'
                    p.pop('aprovadoEm', None)
                    p.setdefault('obs', []).append(f'Seguiu para {", ".join(sorted(etapas_dest & proximas)) or "as próximas etapas"}')
                elif p.get('status') in ('devolvido', 'conferir'):
                    p['status'] = 'pendente'
            mudou = True
        else:
            # resposta sem palavra de aprovação nem de devolução
            if not encaminhou and texto_topo:
                msg = recado(m['corpo'], 300)
                p['status'] = 'conferir'
                p.setdefault('obs', []).append(f'Conferir — {quem} respondeu: {msg}')
                self._avisar(p, 'Precisa conferir', f'{p["assunto"]} — {quem}: “{msg[:120]}”')
                mudou = True
        if mudou:
            self._visiveis(p)
            p['atualizadoEm'] = agora_iso()
            self.s.put_proc(p)

    def _primeira_base(self, p):
        return self._idx(p, self.etapas_base[0]) if self.etapas_base else 0

    # ----- documentos do DP / RH
    def _doc_dp(self, m, de, k, tipos):
        assunto = limpar_assunto(m['assunto'])
        d_id = did(m.get('mid'), de, m['data'], m['assunto'])
        d = self.s.get_doc(d_id)
        if d:
            antes = list(d.get('copias') or [])
            self._visiveis(d)
            if d['copias'] != antes:
                self.s.put_doc(d)
        else:
            obra = detectar_obra(assunto, self.obras)
            dest = [x.lower() for x in m.get('para', []) + m.get('cc', [])]
            d = {'id': d_id, 'assunto': assunto, 'chave': k, 'tipos': tipos, 'de': de,
                 'deNome': self._quem_nome(de, m['de'][1]), 'para': dest[:6], 'data': m['data'],
                 'pasta': m['pasta'], 'obra': obra or 'SEM_OBRA', 'competencia': competencia(assunto, m['corpo']),
                 'anexos': list(dict.fromkeys(m.get('anexos') or []))[:30], 'trecho': recado(m['corpo'], 240),
                 'rh': True, 'dono': self.conta['uid'], 'copias': [], 'criadoEm': agora_iso()}
            self.s.put_doc(d)
            if not m.get('soDP'):
                self.s.aviso(self.conta['uid'], f'{" e ".join(tipos)} chegou', assunto, d_id)
        # se já tinha entrado em "A responder", sai de lá
        if m['pasta'] == 'in':
            r = self.s.get_resp(rid(self.conta['uid'], k, de))
            if r and r.get('status') == 'aguardando':
                r.update({'status': 'arquivado', 'resolvidoEm': m['data'], 'atualizadoEm': agora_iso(),
                          'motivo': 'Documento do DP: está na aba Contracheques'})
                r.setdefault('historico', []).append({'tipo': 'arquivado', 'em': m['data']})
                self.s.put_resp(r)

    # ----- "A responder"
    def _responder_entrada(self, m, de, k):
        corpo_topo = topo(m['corpo']) or m['corpo']
        if self.modo_resp == 'pedidos' and not tem_palavra(norm(corpo_topo), self.palavras_resp) and '?' not in corpo_topo:
            return
        r_id = rid(self.conta['uid'], k, de)
        r = self.s.get_resp(r_id)
        if r and r.get('status') == 'aguardando':
            r['ultimaMensagem'] = m['data']
            r['trecho'] = recado(m['corpo'], 280) or r.get('trecho')
        elif r and r.get('status') in ('respondido', 'resolvido') and m['data'] > (r.get('respondidoEm') or r.get('resolvidoEm') or ''):
            r.update({'status': 'aguardando', 'recebidoEm': m['data'], 'ultimaMensagem': m['data'], 'trecho': recado(m['corpo'], 280)})
            r.setdefault('historico', []).append({'tipo': 'reaberto', 'em': m['data']})
            self.s.aviso(self.conta['uid'], f'Novo e-mail de {self._quem_nome(de, m["de"][1])}', limpar_assunto(m['assunto']), r_id)
        elif r and r.get('status') == 'arquivado':
            return
        elif not r:
            assunto = limpar_assunto(m['assunto'])
            r = {'id': r_id, 'dono': self.conta['uid'], 'chave': k, 'assunto': assunto, 'de': de,
                 'deNome': m['de'][1] or de.split('@')[0], 'recebidoEm': m['data'], 'ultimaMensagem': m['data'],
                 'trecho': recado(m['corpo'], 280), 'status': 'aguardando', 'obra': detectar_obra(assunto, self.obras),
                 'historico': [{'tipo': 'recebido', 'em': m['data']}]}
            self.s.aviso(self.conta['uid'], f'{r["deNome"]} aguarda sua resposta', assunto, r_id)
        else:
            return
        r['atualizadoEm'] = agora_iso()
        self.s.put_resp(r)

    def _responder_saida(self, m, k, dest):
        for r in self.s.resp_por_chave(self.conta['uid'], k):
            if r.get('status') == 'aguardando' and r.get('de') in dest and m['data'] >= r.get('recebidoEm', ''):
                r['status'] = 'respondido'
                r['respondidoEm'] = m['data']
                r.setdefault('historico', []).append({'tipo': 'respondido', 'em': m['data']})
                r['atualizadoEm'] = agora_iso()
                self.s.put_resp(r)


# ---------------------------------------------------------------- máquinas

PERIODO = re.compile(r'(\d{2})/(\d{2})(?:/(\d{4}))?\s*a\s*(\d{2})/(\d{2})/(\d{4})')


def proximo_periodo(assunto, periodicidade):
    m = PERIODO.search(assunto or '')
    if not m:
        return None
    fim = datetime(int(m.group(6)), int(m.group(5)), int(m.group(4)))
    ini = fim + timedelta(days=1)
    if (periodicidade or '').lower().startswith('quinz'):
        if ini.day <= 15:
            f2 = ini.replace(day=15)
        else:
            nxt = (ini.replace(day=28) + timedelta(days=4)).replace(day=1)
            f2 = nxt - timedelta(days=1)
    else:
        nxt = (ini.replace(day=28) + timedelta(days=4)).replace(day=1)
        f2 = nxt - timedelta(days=1)
    return {'periodo': f'{ini:%d/%m} a {f2:%d/%m/%Y}', 'fim': f'{f2:%d/%m/%Y}'}


def periodo_texto(assunto):
    m = PERIODO.search(assunto or '')
    return f'{m.group(1)}/{m.group(2)} a {m.group(4)}/{m.group(5)}/{m.group(6)}' if m else ''


def numero_bm(assunto):
    m = re.search(r'\b(BM|medi[cç][aã]o)\s*n?º?\s*(\d{1,3})', assunto or '', re.I)
    return f'BM {int(m.group(2)):02d}' if m else 'BM'


def casar_maquina(assunto, maquinas):
    t = ' ' + re.sub(r'[^a-z0-9]+', ' ', norm(assunto)) + ' '
    melhor, pontos = None, 0
    for mq in maquinas:
        if mq.get('status') == 'encerrado':
            continue
        pts = 0
        for a in mq.get('aliases') or []:
            a2 = re.sub(r'[^a-z0-9]+', ' ', norm(a)).strip()
            if a2 and (' ' + a2 + ' ') in t:
                pts += len(a2)
        if pts > pontos:
            melhor, pontos = mq, pts
    return melhor if pontos >= 4 else None
