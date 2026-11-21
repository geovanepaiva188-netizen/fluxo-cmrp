"""Testes do motor com e-mails parecidos com os reais (python -m pytest robo -q)."""
import copy

from config_padrao import CONFIG_GERAL, OBRAS
from fluxo import Motor, chave, classificar, cabecalhos_citados, detectar_obra, detectar_tipo, extrair_valor, proximo_periodo
from memoria import StoreMemoria

GEO = {'uid': 'u_geo', 'email': 'geovane@cmrp-pb.com.br', 'nome': 'Geovane', 'incluirCopia': True}
VIC = {'uid': 'u_vic', 'email': 'victor@cearamendes.com.br', 'nome': 'Victor', 'incluirCopia': True}
CONTAS = {'geovane@cmrp-pb.com.br': GEO}
CFG = copy.deepcopy(CONFIG_GERAL)


def msg(pasta, de, para, assunto, corpo, data, cc=None, nome=None):
    return {'pasta': pasta, 'de': (de, nome or de.split('@')[0].title()), 'para': para, 'cc': cc or [],
            'assunto': assunto, 'corpo': corpo, 'data': data}


ASS = '162 - Borborema II - BM 03 – Retroescavadeira – Paraíba Locações – Per. 01/11 a 15/11/2026'
PEDIDO = 'Dra. Sandra,\nEncaminho o BM 03.\nValor Total: R$ 8.500,00.\nSolicito aprovação.\n--\nAtenciosamente,\nGeovane'


def cadeia_completa(s, motor):
    motor.processar(msg('sent', 'geovane@cmrp-pb.com.br', ['sandra@cearamendes.com.br'], ASS, PEDIDO, '2026-11-18T08:27'))
    motor.processar(msg('in', 'sandra@cearamendes.com.br', ['adriana@cearamendes.com.br'], 'ENC: ' + ASS,
                        'Adriana,\nSegue para aprovação.\nSandra\nDe: geovane@cmrp-pb.com.br\nEnviada em: quarta-feira, 18 de novembro de 2026 08:27\n' + PEDIDO,
                        '2026-11-18T08:30', cc=['geovane@cmrp-pb.com.br']))
    motor.processar(msg('in', 'adriana@cearamendes.com.br', ['uicf@cearamendes.com.br'], 'ENC: ' + ASS,
                        'Ubirajara,\nSegue para autorização.\nAtenciosamente,\nAdriana\nDe: Sandra Bartira <sandra@cearamendes.com.br>\nEnviada em: quarta-feira, 18 de novembro de 2026 08:30\n...',
                        '2026-11-18T08:51', cc=['geovane@cmrp-pb.com.br']))
    motor.processar(msg('in', 'uicf@cearamendes.com.br', ['geovane@cmrp-pb.com.br', 'sandra@cearamendes.com.br'], 'Fwd: ENC: ' + ASS,
                        'Autorizado. Porque estamos fazendo medição quinzenal e não mensal.\nUbirajara Filho\nEnviado IPhone\nInício da mensagem encaminhada:\nDe: Adriana <adriana@cearamendes.com.br>\nData: 18 de novembro de 2026 às 08:51:50 BRT\n',
                        '2026-11-18T17:53'))


def test_cadeia_aprovada():
    s = StoreMemoria()
    m = Motor(CFG, OBRAS, s, GEO, CONTAS)
    cadeia_completa(s, m)
    (p,) = s.procs.values()
    assert p['status'] == 'aprovado'
    assert p['obra'] == '162' and p['tipo'] == 'BM' and p['valor'] == 'R$ 8.500,00'
    assert [(e['quem'], e['status'], e['em']) for e in p['etapas']] == [
        ('Sandra', 'ok', '2026-11-18T08:30'), ('Adriana', 'ok', '2026-11-18T08:51'), ('UICF', 'ok', '2026-11-18T17:53')]
    assert p['aprovadoEm'] == '2026-11-18T17:53' and 'quinzenal' in p['aprovacao']
    assert p['dono'] == 'u_geo' and m.novos_aprovados == [p['id']]
    assert any(a['titulo'] == 'UICF aprovou' for a in s.avisos.values())


def test_uicf_sem_copia_recupera_horario_citado():
    s = StoreMemoria()
    m = Motor(CFG, OBRAS, s, GEO, CONTAS)
    m.processar(msg('sent', 'geovane@cmrp-pb.com.br', ['sandra@cearamendes.com.br'], ASS, PEDIDO, '2026-11-18T08:27'))
    m.processar(msg('in', 'uicf@cearamendes.com.br', ['geovane@cmrp-pb.com.br'], 'Fwd: ENC: ' + ASS,
                    'Autorizado\nUbirajara Filho\nInício da mensagem encaminhada:\nDe: Adriana <adriana@cearamendes.com.br>\nData: 18 de novembro de 2026 às 08:51:50 BRT\nPara: Ubirajara\n\nDe: Sandra Bartira <sandra@cearamendes.com.br>\nEnviada em: quarta-feira, 18 de novembro de 2026 08:30\n',
                    '2026-11-18T17:53'))
    (p,) = s.procs.values()
    assert p['status'] == 'aprovado'
    assert [e['em'] for e in p['etapas']] == ['2026-11-18T08:30', '2026-11-18T08:51', '2026-11-18T17:53']


def test_devolucao_e_reenvio():
    s = StoreMemoria()
    m = Motor(CFG, OBRAS, s, GEO, CONTAS)
    a = '157 - Nova Olinda - NF 167867 P/ Reembolso – Cumeeiras Brasilit – YAMA'
    m.processar(msg('sent', 'geovane@cmrp-pb.com.br', ['sandra@cearamendes.com.br'], a, 'Dra. Sandra,\nValor Total: R$ 1.235,84.\nSolicito aprovação.', '2026-11-05T13:32'))
    m.processar(msg('in', 'sandra@cearamendes.com.br', ['geovane@cmrp-pb.com.br'], 'RES: ' + a, 'Inserir no DD de Nova Olinda.\nSandra\nDe: geovane', '2026-11-05T14:29'))
    (p,) = s.procs.values()
    assert p['status'] == 'devolvido' and p['etapas'][0]['status'] == 'devolvido'
    assert 'Inserir no DD' in p['obs'][-1]
    assert any(av['titulo'] == 'Devolvido por Sandra' and av['para'] == 'u_geo' for av in s.avisos.values())
    # reenvio com o mesmo assunto
    m.processar(msg('sent', 'geovane@cmrp-pb.com.br', ['sandra@cearamendes.com.br'], a, 'Dra. Sandra,\nSolicito aprovação.', '2026-11-18T07:14'))
    (p,) = s.procs.values()
    assert p['status'] == 'pendente' and p['etapas'][0]['status'] == 'pendente'
    assert [h['tipo'] for h in p['historico']] == ['envio', 'devolucao', 'reenvio']


def test_revisao_substitui():
    s = StoreMemoria()
    vic_contas = {'geovane@cmrp-pb.com.br': GEO, 'victor@cearamendes.com.br': VIC}
    m = Motor(CFG, OBRAS, s, GEO, vic_contas)
    a = '153 - Caturité - DD 062/153 - Reembolso 27/11/2026'
    m.processar(msg('in', 'victor@cearamendes.com.br', ['sandra@cearamendes.com.br'], a, 'Total do DD = R$ 23.711,26\nSolicito aprovação.', '2026-11-18T06:16', cc=['geovane@cmrp-pb.com.br']))
    m.processar(msg('in', 'victor@cearamendes.com.br', ['sandra@cearamendes.com.br'], a + ' - REV05', 'Total do DD = R$ 50.367,06\nSolicito aprovação.', '2026-11-18T14:05', cc=['geovane@cmrp-pb.com.br']))
    (p,) = s.procs.values()
    assert p['valor'] == 'R$ 50.367,06' and p['dono'] == 'u_vic' and 'u_geo' in p['copias']
    assert 'REV05' in p['obs'][-1] and p['obra'] == '153' and p['tipo'] == 'DD'


def test_aprovacao_direta_sandra():
    s = StoreMemoria()
    m = Motor(CFG, OBRAS, s, GEO, CONTAS)
    a = '162 - Borborema II - Mudança de Função - Paulo de Oliveira Lima'
    m.processar(msg('in', 'victor@cearamendes.com.br', ['sandra@cearamendes.com.br'], a, 'Solicito autorização para a mudança de função do colaborador abaixo:', '2026-11-16T08:21', cc=['geovane@cmrp-pb.com.br']))
    m.processar(msg('in', 'sandra@cearamendes.com.br', ['victor@cearamendes.com.br'], 'RES: ' + a, 'Bom dia,\nAutorizado.\nSandra\nDe: victor', '2026-11-16T08:34', cc=['geovane@cmrp-pb.com.br']))
    (p,) = s.procs.values()
    assert p['status'] == 'aprovado' and p['direto'] and p['rh'] and p['tipo'] == 'Admissão'


def test_resposta_ambigua_vira_conferir():
    s = StoreMemoria()
    m = Motor(CFG, OBRAS, s, GEO, CONTAS)
    m.processar(msg('sent', 'geovane@cmrp-pb.com.br', ['sandra@cearamendes.com.br'], ASS, PEDIDO, '2026-11-18T08:27'))
    m.processar(msg('in', 'sandra@cearamendes.com.br', ['geovane@cmrp-pb.com.br'], 'RES: ' + ASS, 'Qual o horímetro final da máquina?\nSandra', '2026-11-18T09:00'))
    (p,) = s.procs.values()
    assert p['status'] == 'conferir'


def test_a_responder():
    s = StoreMemoria()
    m = Motor(CFG, OBRAS, s, GEO, CONTAS)
    a = '157 - Nova Olinda - NF da OC 020/157'
    m.processar(msg('in', 'mariana@cearamendes.com.br', ['victor@cearamendes.com.br'], 'RES: ' + a, 'Como será o pagamento???\nAtt.,\nMariana', '2026-11-19T15:48', cc=['geovane@cmrp-pb.com.br']))
    (r,) = s.resps.values()
    assert r['status'] == 'aguardando' and r['obra'] == '157' and 'pagamento' in r['trecho']
    m.processar(msg('sent', 'geovane@cmrp-pb.com.br', ['mariana@cearamendes.com.br'], 'RE: RES: ' + a, 'Mariana, será por reembolso.', '2026-11-19T16:10'))
    (r,) = s.resps.values()
    assert r['status'] == 'respondido' and r['respondidoEm'] == '2026-11-19T16:10'
    m.processar(msg('in', 'mariana@cearamendes.com.br', ['geovane@cmrp-pb.com.br'], 'RES: ' + a, 'Ok, mas qual data?', '2026-11-19T17:00'))
    (r,) = s.resps.values()
    assert r['status'] == 'aguardando'


def test_dois_usuarios_mesmo_email_nao_duplica():
    s = StoreMemoria()
    contas = {'geovane@cmrp-pb.com.br': GEO, 'victor@cearamendes.com.br': VIC}
    a = '162 - Borborema II - OC 032/162 – Ponteira para Rompedor – Venmaq'
    pedido = msg('sent', 'victor@cearamendes.com.br', ['sandra@cearamendes.com.br'], a, 'Valor Total: R$ 1.055,19\nSolicito aprovação.', '2026-11-17T11:09', cc=['geovane@cmrp-pb.com.br'])
    Motor(CFG, OBRAS, s, VIC, contas).processar(pedido)
    Motor(CFG, OBRAS, s, GEO, contas).processar(dict(pedido, pasta='in'))
    fwd = msg('in', 'uicf@cearamendes.com.br', ['victor@cearamendes.com.br', 'geovane@cmrp-pb.com.br'], 'Fwd: ENC: ' + a, 'Autorizado\nUbirajara Filho', '2026-11-17T18:34')
    Motor(CFG, OBRAS, s, VIC, contas).processar(fwd)
    Motor(CFG, OBRAS, s, GEO, contas).processar(fwd)
    assert len(s.procs) == 1
    (p,) = s.procs.values()
    assert p['dono'] == 'u_vic' and p['copias'] == ['u_geo'] and p['status'] == 'aprovado'


def test_utilidades():
    assert chave('Fwd: ENC: 153 - Caturité - DD 062/153 - REV05') == chave('153 - Caturité - DD 062/153')
    assert classificar('Autorizado. Favor desconsiderar e-mail anterior.', CFG) == 'aprovado'
    assert classificar('Não autorizado, refazer a medição', CFG) == 'devolvido'
    assert classificar('Inserir no DD de Nova Olinda.', CFG) == 'devolvido'
    assert detectar_obra('ENC: 153 - CMRP CATURITE - CANTEIRO PATOS', OBRAS) == '153'
    assert detectar_obra('Reforma Escola Anita Cabral - DD 006', OBRAS) == 'ANITA'
    assert detectar_obra('Orçamento Kits Natalinos', OBRAS) is None
    assert detectar_tipo('148 - Sertão - Autorização de Admissão - Luiz Carlos') == 'Admissão'
    assert detectar_tipo('162 - Borborema II - Controle de Abastecimento Nº 002') == 'Caução'
    assert extrair_valor('Segue.\nValor Total: R$ 4.790,00.\nSolicito') == 'R$ 4.790,00'
    c = cabecalhos_citados('Em 12/11/2026 08:35, geovane@cmrp-pb.com.br escreveu:\n> x')
    assert c and c[0][2] == '2026-11-12T08:35'
    assert proximo_periodo('BM 03 (01/11 a 15/11/2026)', 'Quinzenal') == {'periodo': '16/11 a 30/11/2026', 'fim': '30/11/2026'}
    assert proximo_periodo('BM 02 (01/10 a 31/10/2026)', 'Mensal') == {'periodo': '01/11 a 30/11/2026', 'fim': '30/11/2026'}


def test_leitura_email_e_pastas():
    import main
    raw = ("From: Sandra Bartira <sandra@cearamendes.com.br>\r\nTo: 'Adriana' <adriana@cearamendes.com.br>\r\n"
           "Cc: geovane@cmrp-pb.com.br, Victor <victor@cearamendes.com.br>\r\nSubject: =?utf-8?q?ENC=3A_162_-_Borborema_II_-_Admiss=C3=A3o?=\r\n"
           "Date: Tue, 17 Nov 2026 11:23:00 -0300\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n"
           "<p>Adriana,<br>Segue para aprova&ccedil;&atilde;o.</p><div>De: Victor<br>Enviada em: ter&ccedil;a-feira, 17 de novembro de 2026 10:40</div>").encode()
    m = main.para_msg(raw, 'in')
    assert m['de'] == ('sandra@cearamendes.com.br', 'Sandra Bartira')
    assert m['cc'] == ['geovane@cmrp-pb.com.br', 'victor@cearamendes.com.br']
    assert m['assunto'] == 'ENC: 162 - Borborema II - Admissão' and m['data'] == '2026-11-17T11:23'
    assert 'Segue para aprovação' in m['corpo'] and 'Enviada em:' in m['corpo']

    class FakeM:
        def list(self):
            return 'OK', [b'(\\HasNoChildren) "." "INBOX.rascunho"', b'(\\HasNoChildren) "." "INBOX.enviadas"', b'(\\HasChildren) "." INBOX']
    assert main.pasta_enviados(FakeM(), '') == 'INBOX.enviadas'
